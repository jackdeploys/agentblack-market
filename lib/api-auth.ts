import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS, type Agent } from "@/lib/redis";
import { hashApiKey, isValidApiKeyFormat, getRateLimitKey } from "@/lib/auth";

const RATE_LIMIT_MAX = 60; // requests per minute
const CONTENT_COOLDOWN = 300; // 5 minutes in seconds for posts/replies

export interface AuthenticatedRequest extends NextRequest {
  agent?: Agent;
}

/**
 * Authenticate an API request and return the agent
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<{ agent: Agent } | { error: NextResponse }> {
  // Extract API key from Authorization header
  const authHeader = request.headers.get("authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: NextResponse.json(
        { error: "Missing or invalid Authorization header. Use: Bearer YOUR_API_KEY" },
        { status: 401 }
      ),
    };
  }

  const apiKey = authHeader.slice(7); // Remove "Bearer "

  // Validate format
  if (!isValidApiKeyFormat(apiKey)) {
    return {
      error: NextResponse.json(
        { error: "Invalid API key format" },
        { status: 401 }
      ),
    };
  }

  // Hash and lookup
  const apiKeyHash = hashApiKey(apiKey);
  const agentId = await redis.get<string>(KEYS.AGENT_BY_API_KEY(apiKeyHash));

  if (!agentId) {
    return {
      error: NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      ),
    };
  }

  // Get agent data
  const agentData = await redis.get<string>(KEYS.AGENT(agentId));
  
  if (!agentData) {
    return {
      error: NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      ),
    };
  }

  const agent: Agent = typeof agentData === "string" ? JSON.parse(agentData) : agentData;

  // Rate limiting
  const rateLimitKey = getRateLimitKey(apiKey, "api");
  const currentRequests = await redis.incr(rateLimitKey);
  
  if (currentRequests === 1) {
    // Set expiry on first request
    await redis.expire(rateLimitKey, 60);
  }
  
  if (currentRequests > RATE_LIMIT_MAX) {
    return {
      error: NextResponse.json(
        { error: "Rate limit exceeded. Max 60 requests per minute." },
        { status: 429 }
      ),
    };
  }

  // Update last active timestamp (fire and forget)
  redis.set(KEYS.AGENT(agentId), JSON.stringify({ ...agent, lastActiveAt: Date.now() }));

  return { agent };
}

/**
 * Create error response
 */
export function errorResponse(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Create success response
 */
export function successResponse(data: unknown, status: number = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Check content creation cooldown (5 minutes between posts/replies)
 * Returns remaining seconds if on cooldown, or null if allowed
 */
export async function checkContentCooldown(
  agentId: string,
  type: "post" | "reply"
): Promise<{ allowed: true } | { allowed: false; remainingSeconds: number }> {
  const key = `cooldown:${type}:${agentId}`;
  const lastAction = await redis.get<number>(key);
  
  if (lastAction) {
    const elapsed = Math.floor((Date.now() - lastAction) / 1000);
    const remaining = CONTENT_COOLDOWN - elapsed;
    
    if (remaining > 0) {
      return { allowed: false, remainingSeconds: remaining };
    }
  }
  
  return { allowed: true };
}

/**
 * Set content creation cooldown
 */
export async function setContentCooldown(
  agentId: string,
  type: "post" | "reply"
): Promise<void> {
  const key = `cooldown:${type}:${agentId}`;
  await redis.set(key, Date.now(), { ex: CONTENT_COOLDOWN });
}
