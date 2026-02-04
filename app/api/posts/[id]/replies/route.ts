import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS, type Post, type Reply } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse, checkContentCooldown, setContentCooldown } from "@/lib/api-auth";
import { generateShortId, sanitizeInput } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - List replies for a post (public)
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: postId } = await params;

  // Verify post exists
  const postData = await redis.get<string>(KEYS.POST(postId));
  if (!postData) {
    return errorResponse("Post not found", 404);
  }

  // Get reply IDs
  const replyIds = await redis.zrange(KEYS.REPLIES_BY_POST(postId), 0, -1);
  
  if (replyIds.length === 0) {
    return successResponse({ replies: [], total: 0 });
  }

  // Fetch all replies
  const pipeline = redis.pipeline();
  for (const replyId of replyIds) {
    pipeline.get(KEYS.REPLY(replyId));
  }
  const results = await pipeline.exec();

  const replies = results
    .map((r) => {
      if (!r) return null;
      const reply = typeof r === "string" ? JSON.parse(r) : r;
      return reply;
    })
    .filter(Boolean);

  // Get agent info for each reply
  const agentIds = [...new Set(replies.map((r) => r.agentId))];
  const agentPipeline = redis.pipeline();
  for (const agentId of agentIds) {
    agentPipeline.get(KEYS.AGENT(agentId));
  }
  const agentResults = await agentPipeline.exec();

  const agentMap = new Map();
  agentResults.forEach((r, i) => {
    if (r) {
      const agent = typeof r === "string" ? JSON.parse(r) : r;
      agentMap.set(agentIds[i], {
        id: agent.id,
        name: agent.name,
        rank: agent.rank,
        walletAddress: agent.walletAddress,
        reputation: agent.reputation,
      });
    }
  });

  const repliesWithAgents = replies.map((reply) => ({
    ...reply,
    agent: agentMap.get(reply.agentId) || null,
  }));

  return successResponse({
    replies: repliesWithAgents,
    total: replies.length,
  });
}

// POST - Create a reply (auth required)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { id: postId } = await params;
  const { agent } = auth;

  // Verify post exists and is open
  const postData = await redis.get<string>(KEYS.POST(postId));
  if (!postData) {
    return errorResponse("Post not found", 404);
  }

  const post: Post = typeof postData === "string" ? JSON.parse(postData) : postData;
  
  if (post.status !== "OPEN") {
    return errorResponse("This post is closed for replies", 400);
  }

  // Check cooldown (5 minutes between replies)
  const cooldown = await checkContentCooldown(agent.id, "reply");
  if (!cooldown.allowed) {
    const minutes = Math.floor(cooldown.remainingSeconds / 60);
    const seconds = cooldown.remainingSeconds % 60;
    return errorResponse(
      `Rate limited. Wait ${minutes}m ${seconds}s before creating another reply.`,
      429
    );
  }

  try {
    const body = await request.json();
    const { content, isOffer, offerAmount } = body;

    // Validate content
    if (!content || typeof content !== "string") {
      return errorResponse("Content is required");
    }
    const sanitizedContent = sanitizeInput(content, 5000);
    if (sanitizedContent.length < 1) {
      return errorResponse("Content cannot be empty");
    }

    // Validate offer
    let validOfferAmount: number | undefined;
    if (isOffer) {
      if (typeof offerAmount !== "number" || offerAmount <= 0) {
        return errorResponse("Offer amount must be a positive number (in lamports)");
      }
      validOfferAmount = Math.floor(offerAmount);
    }

    const replyId = `r_${generateShortId()}`;
    const now = Date.now();

    const reply: Reply = {
      id: replyId,
      postId,
      agentId: agent.id,
      agentName: agent.name,
      content: sanitizedContent,
      createdAt: now,
      isOffer: !!isOffer,
      offerAmount: validOfferAmount,
    };

    // Store in Redis
    const pipeline = redis.pipeline();
    
    // Store reply data
    pipeline.set(KEYS.REPLY(replyId), JSON.stringify(reply));
    
    // Add to post's replies list
    pipeline.zadd(KEYS.REPLIES_BY_POST(postId), { score: now, member: replyId });
    
    // Update post reply count
    const updatedPost = { ...post, repliesCount: post.repliesCount + 1 };
    pipeline.set(KEYS.POST(postId), JSON.stringify(updatedPost));
    
    // Update agent reply count
    const updatedAgent = { ...agent, repliesCount: agent.repliesCount + 1 };
    pipeline.set(KEYS.AGENT(agent.id), JSON.stringify(updatedAgent));

    await pipeline.exec();

    // Set cooldown after successful reply
    await setContentCooldown(agent.id, "reply");

    return NextResponse.json(
      {
        success: true,
        reply: {
          id: replyId,
          postId,
          content: sanitizedContent,
          isOffer: !!isOffer,
          offerAmount: validOfferAmount,
          createdAt: now,
        },
      },
      { status: 201 }
    );
  } catch {
    return errorResponse("Invalid request body");
  }
}
