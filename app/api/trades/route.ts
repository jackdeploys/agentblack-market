import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS, type Post, type Trade } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse } from "@/lib/api-auth";
import { verifyTransaction } from "@/lib/helius";
import { generateId, calculateRank } from "@/lib/auth";

// GET - List all trades or filter
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const offset = (page - 1) * limit;

  let tradeIds: string[];
  
  if (status === "PENDING") {
    tradeIds = await redis.zrange(KEYS.TRADES_PENDING, offset, offset + limit - 1, { rev: true });
  } else {
    tradeIds = await redis.zrange(KEYS.TRADES_LIST, offset, offset + limit - 1, { rev: true });
  }

  if (tradeIds.length === 0) {
    return successResponse({ trades: [], total: 0, page, hasMore: false });
  }

  const pipeline = redis.pipeline();
  for (const id of tradeIds) {
    pipeline.get(KEYS.TRADE(id));
  }
  const results = await pipeline.exec();

  const trades = results
    .map((r) => {
      if (!r) return null;
      return typeof r === "string" ? JSON.parse(r) : r;
    })
    .filter(Boolean);

  const total = await redis.zcard(KEYS.TRADES_LIST);

  return successResponse({
    trades,
    total,
    page,
    hasMore: offset + limit < total,
  });
}

// POST - Initiate a trade
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { agent: buyer } = auth;

  try {
    const body = await request.json();
    const { postId, amount } = body;

    // Validate post exists
    const postData = await redis.get<string>(KEYS.POST(postId));
    if (!postData) {
      return errorResponse("Post not found", 404);
    }

    const post: Post = typeof postData === "string" ? JSON.parse(postData) : postData;

    if (post.status !== "OPEN") {
      return errorResponse("This listing is not available for trade", 400);
    }

    if (post.agentId === buyer.id) {
      return errorResponse("You cannot trade with yourself", 400);
    }

    // Validate amount
    if (typeof amount !== "number" || amount <= 0) {
      return errorResponse("Amount must be a positive number (in lamports)");
    }

    // Get seller info
    const sellerData = await redis.get<string>(KEYS.AGENT(post.agentId));
    if (!sellerData) {
      return errorResponse("Seller not found", 404);
    }
    const seller = typeof sellerData === "string" ? JSON.parse(sellerData) : sellerData;

    const tradeId = generateId("trade");
    const now = Date.now();

    const trade: Trade = {
      id: tradeId,
      postId,
      sellerId: seller.id,
      buyerId: buyer.id,
      amount: Math.floor(amount),
      status: "PENDING",
      createdAt: now,
    };

    // Store trade
    const pipeline = redis.pipeline();
    pipeline.set(KEYS.TRADE(tradeId), JSON.stringify(trade));
    pipeline.zadd(KEYS.TRADES_LIST, { score: now, member: tradeId });
    pipeline.zadd(KEYS.TRADES_PENDING, { score: now, member: tradeId });
    pipeline.zadd(KEYS.TRADES_BY_AGENT(buyer.id), { score: now, member: tradeId });
    pipeline.zadd(KEYS.TRADES_BY_AGENT(seller.id), { score: now, member: tradeId });
    pipeline.incr(KEYS.TRADES_COUNT);

    await pipeline.exec();

    return NextResponse.json(
      {
        success: true,
        trade: {
          id: tradeId,
          postId,
          sellerId: seller.id,
          sellerWallet: seller.walletAddress,
          buyerId: buyer.id,
          amount: trade.amount,
          status: "PENDING",
          instructions: {
            step1: `Send ${trade.amount} lamports (${trade.amount / 1_000_000_000} SOL) to seller wallet: ${seller.walletAddress}`,
            step2: `Call PATCH /api/trades/${tradeId} with txSignature to complete the trade`,
            note: "Trade will be verified on-chain via Helius before completion",
          },
        },
      },
      { status: 201 }
    );
  } catch {
    return errorResponse("Invalid request body");
  }
}
