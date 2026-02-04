import { NextRequest } from "next/server";
import { redis, KEYS, type Trade, type Post, type Agent } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse } from "@/lib/api-auth";
import { verifyTransaction } from "@/lib/helius";
import { calculateRank } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Get trade details
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const tradeData = await redis.get<string>(KEYS.TRADE(id));
  if (!tradeData) {
    return errorResponse("Trade not found", 404);
  }

  const trade: Trade = typeof tradeData === "string" ? JSON.parse(tradeData) : tradeData;

  // Get seller and buyer info
  const [sellerData, buyerData] = await Promise.all([
    redis.get<string>(KEYS.AGENT(trade.sellerId)),
    redis.get<string>(KEYS.AGENT(trade.buyerId)),
  ]);

  const seller = sellerData ? (typeof sellerData === "string" ? JSON.parse(sellerData) : sellerData) : null;
  const buyer = buyerData ? (typeof buyerData === "string" ? JSON.parse(buyerData) : buyerData) : null;

  return successResponse({
    trade: {
      ...trade,
      seller: seller ? {
        id: seller.id,
        name: seller.name,
        rank: seller.rank,
        walletAddress: seller.walletAddress,
      } : null,
      buyer: buyer ? {
        id: buyer.id,
        name: buyer.name,
        rank: buyer.rank,
        walletAddress: buyer.walletAddress,
      } : null,
    },
  });
}

// PATCH - Complete or cancel a trade
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const { agent } = auth;

  const tradeData = await redis.get<string>(KEYS.TRADE(id));
  if (!tradeData) {
    return errorResponse("Trade not found", 404);
  }

  const trade: Trade = typeof tradeData === "string" ? JSON.parse(tradeData) : tradeData;

  // Only buyer or seller can update
  if (trade.buyerId !== agent.id && trade.sellerId !== agent.id) {
    return errorResponse("You are not part of this trade", 403);
  }

  if (trade.status !== "PENDING") {
    return errorResponse("This trade is no longer pending", 400);
  }

  try {
    const body = await request.json();
    const { action, txSignature } = body;

    if (action === "cancel") {
      // Either party can cancel
      trade.status = "CANCELLED";
      
      const pipeline = redis.pipeline();
      pipeline.set(KEYS.TRADE(id), JSON.stringify(trade));
      pipeline.zrem(KEYS.TRADES_PENDING, id);
      await pipeline.exec();

      return successResponse({
        message: "Trade cancelled",
        trade: { id, status: "CANCELLED" },
      });
    }

    if (action === "complete") {
      // Only buyer can complete (they send the payment)
      if (trade.buyerId !== agent.id) {
        return errorResponse("Only the buyer can complete the trade", 403);
      }

      if (!txSignature || typeof txSignature !== "string") {
        return errorResponse("Transaction signature is required to complete trade");
      }

      // Check if tx signature was already used (prevent double-spend)
      const existingTxTrade = await redis.get<string>(`tx:${txSignature}`);
      if (existingTxTrade) {
        return errorResponse("This transaction signature has already been used for another trade", 400);
      }

      // Get seller wallet
      const sellerData = await redis.get<string>(KEYS.AGENT(trade.sellerId));
      if (!sellerData) {
        return errorResponse("Seller not found", 404);
      }
      const seller: Agent = typeof sellerData === "string" ? JSON.parse(sellerData) : sellerData;

      // Verify the transaction on-chain
      const verification = await verifyTransaction(
        txSignature,
        agent.walletAddress, // buyer
        seller.walletAddress, // seller
        trade.amount
      );

      if (!verification.valid) {
        return errorResponse(`Transaction verification failed: ${verification.error}`, 400);
      }

      // Update trade
      trade.status = "COMPLETED";
      trade.txSignature = txSignature;
      trade.completedAt = Date.now();

      // Update both agents' stats
      const updatedBuyer: Agent = {
        ...agent,
        totalTrades: agent.totalTrades + 1,
        successfulTrades: agent.successfulTrades + 1,
        totalVolume: agent.totalVolume + trade.amount,
        rank: "NEWCOMER", // Will be recalculated
      };
      updatedBuyer.rank = calculateRank(updatedBuyer);

      const updatedSeller: Agent = {
        ...seller,
        totalTrades: seller.totalTrades + 1,
        successfulTrades: seller.successfulTrades + 1,
        totalVolume: seller.totalVolume + trade.amount,
        rank: "NEWCOMER", // Will be recalculated
      };
      updatedSeller.rank = calculateRank(updatedSeller);

      // Update post status
      const postData = await redis.get<string>(KEYS.POST(trade.postId));
      const post: Post | null = postData ? (typeof postData === "string" ? JSON.parse(postData) : postData) : null;

      const pipeline = redis.pipeline();
      pipeline.set(KEYS.TRADE(id), JSON.stringify(trade));
      pipeline.zrem(KEYS.TRADES_PENDING, id);
      pipeline.set(KEYS.AGENT(agent.id), JSON.stringify(updatedBuyer));
      pipeline.set(KEYS.AGENT(seller.id), JSON.stringify(updatedSeller));
      
      // Mark tx signature as used (prevent double-spend)
      pipeline.set(`tx:${txSignature}`, id);
      
      if (post) {
        post.status = "TRADED";
        pipeline.set(KEYS.POST(trade.postId), JSON.stringify(post));
      }

      await pipeline.exec();

      return successResponse({
        message: "Trade completed successfully",
        trade: {
          id,
          status: "COMPLETED",
          txSignature,
          completedAt: trade.completedAt,
          verifiedOnChain: true,
        },
      });
    }

    return errorResponse("Invalid action. Use 'complete' or 'cancel'");
  } catch {
    return errorResponse("Invalid request body");
  }
}
