import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS, type Trade, type Review, type Agent } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse } from "@/lib/api-auth";
import { generateId, sanitizeInput } from "@/lib/auth";

// GET - List reviews (public)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const offset = (page - 1) * limit;

  if (!agentId) {
    return errorResponse("agentId query parameter is required");
  }

  const reviewIds = await redis.zrange(KEYS.REVIEWS_BY_AGENT(agentId), offset, offset + limit - 1, { rev: true });

  if (reviewIds.length === 0) {
    return successResponse({ reviews: [], total: 0, page, hasMore: false });
  }

  const pipeline = redis.pipeline();
  for (const id of reviewIds) {
    pipeline.get(KEYS.REVIEW(id));
  }
  const results = await pipeline.exec();

  const reviews = results
    .filter(Boolean)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r));

  // Get reviewer info
  const reviewerIds = [...new Set(reviews.map((r: Review) => r.fromAgentId))];
  const reviewerPipeline = redis.pipeline();
  for (const reviewerId of reviewerIds) {
    reviewerPipeline.get(KEYS.AGENT(reviewerId));
  }
  const reviewerResults = await reviewerPipeline.exec();

  const reviewerMap = new Map<string, { id: string; name: string; rank: string }>();
  reviewerResults.forEach((r, i) => {
    if (r) {
      const reviewer = typeof r === "string" ? JSON.parse(r) : r;
      reviewerMap.set(reviewerIds[i], {
        id: reviewer.id,
        name: reviewer.name,
        rank: reviewer.rank,
      });
    }
  });

  const reviewsWithAgents = reviews.map((review: Review) => ({
    ...review,
    fromAgent: reviewerMap.get(review.fromAgentId),
  }));

  const total = await redis.zcard(KEYS.REVIEWS_BY_AGENT(agentId));

  return successResponse({
    reviews: reviewsWithAgents,
    total,
    page,
    hasMore: offset + limit < total,
  });
}

// POST - Leave a review after a trade
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { agent } = auth;

  try {
    const body = await request.json();
    const { tradeId, rating, comment } = body;

    // Validate trade exists
    const tradeData = await redis.get<string>(KEYS.TRADE(tradeId));
    if (!tradeData) {
      return errorResponse("Trade not found", 404);
    }

    const trade: Trade = typeof tradeData === "string" ? JSON.parse(tradeData) : tradeData;

    // Verify agent was part of the trade
    if (trade.buyerId !== agent.id && trade.sellerId !== agent.id) {
      return errorResponse("You can only review trades you participated in", 403);
    }

    // Trade must be completed
    if (trade.status !== "COMPLETED") {
      return errorResponse("You can only review completed trades", 400);
    }

    // Determine who is being reviewed
    const toAgentId = trade.buyerId === agent.id ? trade.sellerId : trade.buyerId;

    // Check if already reviewed
    const existingReviewIds = await redis.zrange(KEYS.REVIEWS_BY_AGENT(toAgentId), 0, -1);
    for (const existingId of existingReviewIds) {
      const existingReview = await redis.get<string>(KEYS.REVIEW(existingId));
      if (existingReview) {
        const review: Review = typeof existingReview === "string" ? JSON.parse(existingReview) : existingReview;
        if (review.tradeId === tradeId && review.fromAgentId === agent.id) {
          return errorResponse("You have already reviewed this trade", 400);
        }
      }
    }

    // Validate rating
    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      return errorResponse("Rating must be between 1 and 5");
    }

    // Validate comment
    if (!comment || typeof comment !== "string") {
      return errorResponse("Comment is required");
    }
    const sanitizedComment = sanitizeInput(comment, 1000);
    if (sanitizedComment.length < 5) {
      return errorResponse("Comment must be at least 5 characters");
    }

    const reviewId = generateId("rev");
    const now = Date.now();

    const review: Review = {
      id: reviewId,
      tradeId,
      fromAgentId: agent.id,
      toAgentId,
      rating: rating as 1 | 2 | 3 | 4 | 5,
      comment: sanitizedComment,
      createdAt: now,
    };

    // Update agent reputation based on review
    const toAgentData = await redis.get<string>(KEYS.AGENT(toAgentId));
    if (!toAgentData) {
      return errorResponse("Agent not found", 404);
    }
    const toAgent: Agent = typeof toAgentData === "string" ? JSON.parse(toAgentData) : toAgentData;

    // Simple reputation calculation: weighted average
    const currentReviews = await redis.zcard(KEYS.REVIEWS_BY_AGENT(toAgentId));
    const newReputation = Math.round(
      (toAgent.reputation * currentReviews + rating * 20) / (currentReviews + 1)
    );

    const updatedToAgent = {
      ...toAgent,
      reputation: Math.min(100, Math.max(0, newReputation)),
    };

    // Store everything
    const pipeline = redis.pipeline();
    pipeline.set(KEYS.REVIEW(reviewId), JSON.stringify(review));
    pipeline.zadd(KEYS.REVIEWS_BY_AGENT(toAgentId), { score: now, member: reviewId });
    pipeline.set(KEYS.AGENT(toAgentId), JSON.stringify(updatedToAgent));

    await pipeline.exec();

    return NextResponse.json(
      {
        success: true,
        review: {
          id: reviewId,
          tradeId,
          toAgentId,
          rating,
          comment: sanitizedComment,
          createdAt: now,
        },
      },
      { status: 201 }
    );
  } catch {
    return errorResponse("Invalid request body");
  }
}
