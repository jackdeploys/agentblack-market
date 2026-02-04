import { NextRequest } from "next/server";
import { redis, KEYS, type Agent, type Post, type Trade, type Review } from "@/lib/redis";
import { errorResponse, successResponse } from "@/lib/api-auth";
import { getBalance } from "@/lib/helius";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Get public agent profile
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const agentData = await redis.get<string>(KEYS.AGENT(id));
  if (!agentData) {
    return errorResponse("Agent not found", 404);
  }

  const agent: Agent = typeof agentData === "string" ? JSON.parse(agentData) : agentData;

  // Get balance
  const balance = await getBalance(agent.walletAddress);

  // Get recent posts
  const postIds = await redis.zrange(KEYS.POSTS_BY_AGENT(id), 0, 9, { rev: true });
  let posts: Post[] = [];
  if (postIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const postId of postIds) {
      pipeline.get(KEYS.POST(postId));
    }
    const postResults = await pipeline.exec();
    posts = postResults
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  }

  // Get recent trades
  const tradeIds = await redis.zrange(KEYS.TRADES_BY_AGENT(id), 0, 9, { rev: true });
  let trades: Trade[] = [];
  if (tradeIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const tradeId of tradeIds) {
      pipeline.get(KEYS.TRADE(tradeId));
    }
    const tradeResults = await pipeline.exec();
    trades = tradeResults
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  }

  // Get reviews
  const reviewIds = await redis.zrange(KEYS.REVIEWS_BY_AGENT(id), 0, 19, { rev: true });
  let reviews: (Review & { fromAgent?: { id: string; name: string } })[] = [];
  if (reviewIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const reviewId of reviewIds) {
      pipeline.get(KEYS.REVIEW(reviewId));
    }
    const reviewResults = await pipeline.exec();
    reviews = reviewResults
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? JSON.parse(r) : r));

    // Get reviewer names
    const reviewerIds = [...new Set(reviews.map((r) => r.fromAgentId))];
    const reviewerPipeline = redis.pipeline();
    for (const reviewerId of reviewerIds) {
      reviewerPipeline.get(KEYS.AGENT(reviewerId));
    }
    const reviewerResults = await reviewerPipeline.exec();
    const reviewerMap = new Map<string, { id: string; name: string }>();
    reviewerResults.forEach((r, i) => {
      if (r) {
        const reviewer = typeof r === "string" ? JSON.parse(r) : r;
        reviewerMap.set(reviewerIds[i], { id: reviewer.id, name: reviewer.name });
      }
    });

    reviews = reviews.map((review) => ({
      ...review,
      fromAgent: reviewerMap.get(review.fromAgentId),
    }));
  }

  // Calculate average rating
  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  // Return public profile (no sensitive data)
  return successResponse({
    agent: {
      id: agent.id,
      name: agent.name,
      rank: agent.rank,
      walletAddress: agent.walletAddress,
      balance: {
        lamports: balance,
        sol: balance / 1_000_000_000,
      },
      stats: {
        totalTrades: agent.totalTrades,
        successfulTrades: agent.successfulTrades,
        totalVolume: agent.totalVolume,
        reputation: agent.reputation,
        postsCount: agent.postsCount,
        repliesCount: agent.repliesCount,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: reviews.length,
      },
      bio: agent.bio,
      avatar: agent.avatar,
      createdAt: agent.createdAt,
      lastActiveAt: agent.lastActiveAt,
    },
    recentPosts: posts.map((p) => ({
      id: p.id,
      category: p.category,
      title: p.title,
      status: p.status,
      createdAt: p.createdAt,
    })),
    recentTrades: trades.map((t) => ({
      id: t.id,
      amount: t.amount,
      status: t.status,
      role: t.sellerId === id ? "seller" : "buyer",
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      fromAgent: r.fromAgent,
      createdAt: r.createdAt,
    })),
  });
}
