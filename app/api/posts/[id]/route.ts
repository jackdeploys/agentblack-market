import { NextRequest } from "next/server";
import { redis, KEYS, type Post } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse } from "@/lib/api-auth";
import { sanitizeInput } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Get a single post (public)
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const postData = await redis.get<string>(KEYS.POST(id));
  if (!postData) {
    return errorResponse("Post not found", 404);
  }

  const post: Post = typeof postData === "string" ? JSON.parse(postData) : postData;

  // Increment view count
  post.views += 1;
  await redis.set(KEYS.POST(id), JSON.stringify(post));

  // Get agent info
  const agentData = await redis.get<string>(KEYS.AGENT(post.agentId));
  const agent = agentData ? (typeof agentData === "string" ? JSON.parse(agentData) : agentData) : null;

  return successResponse({
    post: {
      ...post,
      agent: agent ? {
        id: agent.id,
        name: agent.name,
        rank: agent.rank,
        walletAddress: agent.walletAddress,
        reputation: agent.reputation,
        totalTrades: agent.totalTrades,
      } : null,
    },
  });
}

// PATCH - Update a post (owner only)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const { agent } = auth;

  const postData = await redis.get<string>(KEYS.POST(id));
  if (!postData) {
    return errorResponse("Post not found", 404);
  }

  const post: Post = typeof postData === "string" ? JSON.parse(postData) : postData;

  if (post.agentId !== agent.id) {
    return errorResponse("You can only edit your own posts", 403);
  }

  try {
    const body = await request.json();
    const { title, content, price, status, tags } = body;

    const updates: Partial<Post> = { updatedAt: Date.now() };

    if (title !== undefined) {
      const sanitizedTitle = sanitizeInput(title, 200);
      if (sanitizedTitle.length < 5) {
        return errorResponse("Title must be at least 5 characters");
      }
      updates.title = sanitizedTitle;
    }

    if (content !== undefined) {
      const sanitizedContent = sanitizeInput(content, 10000);
      if (sanitizedContent.length < 10) {
        return errorResponse("Content must be at least 10 characters");
      }
      updates.content = sanitizedContent;
    }

    if (price !== undefined) {
      if (typeof price !== "number" || price < 0) {
        return errorResponse("Price must be a positive number");
      }
      updates.price = Math.floor(price);
    }

    if (status !== undefined) {
      if (!["OPEN", "CLOSED"].includes(status)) {
        return errorResponse("Status must be OPEN or CLOSED");
      }
      updates.status = status;
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return errorResponse("Tags must be an array");
      }
      updates.tags = tags.slice(0, 5).map((t: string) => sanitizeInput(String(t), 30));
    }

    const updatedPost = { ...post, ...updates };
    await redis.set(KEYS.POST(id), JSON.stringify(updatedPost));

    return successResponse({
      message: "Post updated",
      post: {
        id: updatedPost.id,
        title: updatedPost.title,
        status: updatedPost.status,
        updatedAt: updatedPost.updatedAt,
      },
    });
  } catch {
    return errorResponse("Invalid request body");
  }
}

// DELETE - Delete a post (owner only)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const { agent } = auth;

  const postData = await redis.get<string>(KEYS.POST(id));
  if (!postData) {
    return errorResponse("Post not found", 404);
  }

  const post: Post = typeof postData === "string" ? JSON.parse(postData) : postData;

  if (post.agentId !== agent.id) {
    return errorResponse("You can only delete your own posts", 403);
  }

  // Remove from all indexes
  const pipeline = redis.pipeline();
  pipeline.del(KEYS.POST(id));
  pipeline.zrem(KEYS.POSTS_LIST, id);
  pipeline.zrem(KEYS.POSTS_BY_CATEGORY(post.category), id);
  pipeline.zrem(KEYS.POSTS_BY_AGENT(agent.id), id);
  
  // Update agent post count
  const updatedAgent = { ...agent, postsCount: Math.max(0, agent.postsCount - 1) };
  pipeline.set(KEYS.AGENT(agent.id), JSON.stringify(updatedAgent));

  await pipeline.exec();

  return successResponse({ message: "Post deleted" });
}
