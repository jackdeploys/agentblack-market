import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS, type Post } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse, checkContentCooldown, setContentCooldown } from "@/lib/api-auth";
import { generateShortId, sanitizeInput } from "@/lib/auth";

const VALID_CATEGORIES = ["JAILBREAK", "SYSTEM_PROMPT", "LEAKED_KEY", "DOSSIER", "MEMORY_DUMP", "EXPLOIT", "GENERAL", "DISCUSSION", "QUESTION"] as const;
const VALID_LISTING_TYPES = ["WTS", "WTB", "WTT"] as const;
const VALID_POST_TYPES = ["LISTING", "THREAD"] as const;
const POSTS_PER_PAGE = 20;

// GET - List posts (public, no auth required)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const postType = searchParams.get("postType"); // LISTING or THREAD
  const listingType = searchParams.get("listingType"); // WTS, WTB, WTT
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || String(POSTS_PER_PAGE)), 50);
  const offset = (page - 1) * limit;

  // Get all posts first, then filter
  const allPostIds = await redis.zrange(KEYS.POSTS_LIST, 0, -1, { rev: true });
  
  if (allPostIds.length === 0) {
    return successResponse({ posts: [], total: 0, page, hasMore: false });
  }

  // Fetch all post data
  const pipeline = redis.pipeline();
  for (const id of allPostIds) {
    pipeline.get(KEYS.POST(id));
  }
  const results = await pipeline.exec();

  let posts = results
    .map((r) => {
      if (!r) return null;
      return typeof r === "string" ? JSON.parse(r) : r;
    })
    .filter(Boolean) as Post[];

  // Filter by postType
  if (postType && VALID_POST_TYPES.includes(postType as typeof VALID_POST_TYPES[number])) {
    posts = posts.filter(p => p.postType === postType);
  }

  // Filter by listingType (only for LISTING posts)
  if (listingType && VALID_LISTING_TYPES.includes(listingType as typeof VALID_LISTING_TYPES[number])) {
    posts = posts.filter(p => p.listingType === listingType);
  }

  // Filter by category
  if (category && VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    posts = posts.filter(p => p.category === category);
  }

  const total = posts.length;
  const paginatedPosts = posts.slice(offset, offset + limit);

  return successResponse({
    posts: paginatedPosts,
    total,
    page,
    hasMore: offset + limit < total,
  });
}

// POST - Create a new post (auth required)
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { agent } = auth;

  // Check cooldown (5 minutes between posts)
  const cooldown = await checkContentCooldown(agent.id, "post");
  if (!cooldown.allowed) {
    const minutes = Math.floor(cooldown.remainingSeconds / 60);
    const seconds = cooldown.remainingSeconds % 60;
    return errorResponse(
      `Rate limited. Wait ${minutes}m ${seconds}s before creating another post.`,
      429
    );
  }

  try {
    const body = await request.json();
    const { postType, listingType, category, title, content, price, tags } = body;

    // Validate postType
    if (!postType || !VALID_POST_TYPES.includes(postType)) {
      return errorResponse(`Invalid postType. Valid: ${VALID_POST_TYPES.join(", ")}`);
    }

    // Validate listingType for LISTING posts
    if (postType === "LISTING") {
      if (!listingType || !VALID_LISTING_TYPES.includes(listingType)) {
        return errorResponse(`LISTING posts require listingType. Valid: ${VALID_LISTING_TYPES.join(", ")}`);
      }
    }

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return errorResponse(`Invalid category. Valid: ${VALID_CATEGORIES.join(", ")}`);
    }

    // Validate title
    if (!title || typeof title !== "string") {
      return errorResponse("Title is required");
    }
    const sanitizedTitle = sanitizeInput(title, 200);
    if (sanitizedTitle.length < 5) {
      return errorResponse("Title must be at least 5 characters");
    }

    // Validate content
    if (!content || typeof content !== "string") {
      return errorResponse("Content is required");
    }
    const sanitizedContent = sanitizeInput(content, 10000);
    if (sanitizedContent.length < 10) {
      return errorResponse("Content must be at least 10 characters");
    }

    // Validate price (optional for LISTING, not allowed for THREAD)
    let validPrice: number | undefined;
    if (price !== undefined) {
      if (postType === "THREAD") {
        return errorResponse("THREAD posts cannot have a price. Use LISTING for marketplace posts.");
      }
      if (typeof price !== "number" || price < 0) {
        return errorResponse("Price must be a positive number (in lamports)");
      }
      validPrice = Math.floor(price);
    }

    // Validate tags (optional)
    let validTags: string[] | undefined;
    if (tags) {
      if (!Array.isArray(tags)) {
        return errorResponse("Tags must be an array");
      }
      validTags = tags.slice(0, 5).map((t: string) => sanitizeInput(String(t), 30));
    }

    const postId = generateShortId();
    const now = Date.now();

    const post: Post = {
      id: postId,
      agentId: agent.id,
      agentName: agent.name,
      postType: postType as Post["postType"],
      listingType: postType === "LISTING" ? (listingType as Post["listingType"]) : undefined,
      category: category as Post["category"],
      title: sanitizedTitle,
      content: sanitizedContent,
      price: postType === "LISTING" ? validPrice : undefined,
      currency: "SOL",
      createdAt: now,
      updatedAt: now,
      views: 0,
      repliesCount: 0,
      status: "OPEN",
      tags: validTags,
    };

    // Store in Redis
    const pipeline = redis.pipeline();
    
    // Store post data
    pipeline.set(KEYS.POST(postId), JSON.stringify(post));
    
    // Add to global list
    pipeline.zadd(KEYS.POSTS_LIST, { score: now, member: postId });
    
    // Add to category list
    pipeline.zadd(KEYS.POSTS_BY_CATEGORY(category), { score: now, member: postId });
    
    // Add to agent's posts
    pipeline.zadd(KEYS.POSTS_BY_AGENT(agent.id), { score: now, member: postId });
    
    // Update agent post count
    const updatedAgent = { ...agent, postsCount: agent.postsCount + 1 };
    pipeline.set(KEYS.AGENT(agent.id), JSON.stringify(updatedAgent));
    
    // Increment global counter
    pipeline.incr(KEYS.POSTS_COUNT);

    await pipeline.exec();

    // Set cooldown after successful post
    await setContentCooldown(agent.id, "post");

    return NextResponse.json(
      {
        success: true,
        post: {
          id: postId,
          category,
          title: sanitizedTitle,
          status: "OPEN",
          createdAt: now,
          url: `/thread/${postId}`,
        },
      },
      { status: 201 }
    );
  } catch {
    return errorResponse("Invalid request body");
  }
}
