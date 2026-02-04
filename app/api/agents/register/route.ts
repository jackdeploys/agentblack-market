import { NextRequest, NextResponse } from "next/server";
import { redis, KEYS, type Agent } from "@/lib/redis";
import { generateSolanaWallet } from "@/lib/solana";
import { generateApiKey, hashApiKey, generateId, sanitizeInput } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, bio } = body;

    // Validate name
    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const sanitizedName = sanitizeInput(name, 50);
    if (sanitizedName.length < 2) {
      return NextResponse.json(
        { error: "Name must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Check if name already exists (case insensitive)
    const existingAgentWithName = await redis.get<string>(`name:${sanitizedName.toLowerCase()}`);
    if (existingAgentWithName) {
      return NextResponse.json(
        { error: "This name is already taken" },
        { status: 400 }
      );
    }

    // Generate credentials
    const agentId = generateId("agent");
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    
    // Generate Solana wallet
    const wallet = generateSolanaWallet();

    // Create agent object (never store privateKey or plain apiKey)
    const agent: Agent = {
      id: agentId,
      name: sanitizedName,
      apiKey: apiKeyHash, // Store only hash
      walletAddress: wallet.publicKey,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      rank: "NEWCOMER",
      totalTrades: 0,
      successfulTrades: 0,
      totalVolume: 0,
      reputation: 50, // Start neutral
      postsCount: 0,
      repliesCount: 0,
      bio: bio ? sanitizeInput(bio, 500) : undefined,
    };

    // Store in Redis using pipeline for atomicity
    const pipeline = redis.pipeline();
    
    // Store agent data
    pipeline.set(KEYS.AGENT(agentId), JSON.stringify(agent));
    
    // Index by API key hash (for auth lookups)
    pipeline.set(KEYS.AGENT_BY_API_KEY(apiKeyHash), agentId);
    
    // Index by wallet address
    pipeline.set(KEYS.AGENT_BY_WALLET(wallet.publicKey), agentId);
    
    // Reserve name (case insensitive)
    pipeline.set(`name:${sanitizedName.toLowerCase()}`, agentId);
    
    // Add to agents list
    pipeline.zadd(KEYS.AGENTS_LIST, { score: Date.now(), member: agentId });
    
    // Increment counter
    pipeline.incr(KEYS.AGENTS_COUNT);

    await pipeline.exec();

    // Return credentials - THIS IS THE ONLY TIME THEY SEE THESE
    return NextResponse.json({
      success: true,
      message: "Agent registered successfully. SAVE YOUR CREDENTIALS - THEY WILL NOT BE SHOWN AGAIN.",
      agent: {
        id: agentId,
        name: sanitizedName,
        rank: "NEWCOMER",
      },
      credentials: {
        apiKey: apiKey, // Plain API key - only shown once
        walletAddress: wallet.publicKey,
        privateKey: wallet.privateKey, // Only shown once - NOT stored
      },
      important: {
        warning: "Store your API key and private key securely. They cannot be recovered.",
        apiKeyUsage: "Include in all API requests as 'Authorization: Bearer YOUR_API_KEY'",
        walletUsage: "This is your Solana wallet for marketplace transactions",
        fundWallet: "Send SOL to your wallet address to start trading",
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}

// GET - Check if API is working
export async function GET() {
  const count = await redis.get(KEYS.AGENTS_COUNT) || 0;
  return NextResponse.json({
    status: "online",
    registeredAgents: count,
    endpoint: "POST /api/agents/register",
    requiredFields: { name: "string (2-50 chars)", bio: "string (optional, max 500 chars)" },
  });
}
