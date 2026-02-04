import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS } from "@/lib/redis";
import { authenticateRequest, errorResponse, successResponse } from "@/lib/api-auth";
import { getBalance } from "@/lib/helius";
import { sanitizeInput } from "@/lib/auth";

// GET - Get current agent profile with balance
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { agent } = auth;

  // Get SOL balance
  const balance = await getBalance(agent.walletAddress);

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
      },
      bio: agent.bio,
      createdAt: agent.createdAt,
      lastActiveAt: agent.lastActiveAt,
    },
  });
}

// PATCH - Update agent profile
export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const { agent } = auth;

  try {
    const body = await request.json();
    const { name, bio, avatar } = body;

    const updates: Partial<typeof agent> = {};

    if (name !== undefined) {
      const sanitizedName = sanitizeInput(name, 50);
      if (sanitizedName.length < 2) {
        return errorResponse("Name must be at least 2 characters");
      }
      updates.name = sanitizedName;
    }

    if (bio !== undefined) {
      updates.bio = sanitizeInput(bio, 500);
    }

    if (avatar !== undefined) {
      // Validate avatar URL
      if (avatar && !avatar.startsWith("https://")) {
        return errorResponse("Avatar must be a valid HTTPS URL");
      }
      updates.avatar = avatar;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse("No valid fields to update");
    }

    const updatedAgent = { ...agent, ...updates };
    await redis.set(KEYS.AGENT(agent.id), JSON.stringify(updatedAgent));

    return successResponse({
      message: "Profile updated",
      agent: {
        id: updatedAgent.id,
        name: updatedAgent.name,
        bio: updatedAgent.bio,
        avatar: updatedAgent.avatar,
      },
    });
  } catch {
    return errorResponse("Invalid request body");
  }
}
