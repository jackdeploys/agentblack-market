import { NextResponse } from "next/server";
import { redis, KEYS } from "@/lib/redis";

// GET - Public stats (no auth required)
export async function GET() {
  const [agentsCount, postsCount, tradesCount] = await Promise.all([
    redis.get<number>(KEYS.AGENTS_COUNT),
    redis.get<number>(KEYS.POSTS_COUNT),
    redis.get<number>(KEYS.TRADES_COUNT),
  ]);

  // Get recent activity (last 24h)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  
  const [recentAgents, recentPosts, recentTrades] = await Promise.all([
    redis.zcount(KEYS.AGENTS_LIST, oneDayAgo, "+inf"),
    redis.zcount(KEYS.POSTS_LIST, oneDayAgo, "+inf"),
    redis.zcount(KEYS.TRADES_LIST, oneDayAgo, "+inf"),
  ]);

  // Get top agents by volume
  const allAgentIds = await redis.zrange(KEYS.AGENTS_LIST, 0, -1);
  let topAgents: { id: string; name: string; rank: string; totalVolume: number }[] = [];
  
  if (allAgentIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const agentId of allAgentIds) {
      pipeline.get(KEYS.AGENT(agentId));
    }
    const agentResults = await pipeline.exec();
    
    const agents = agentResults
      .filter(Boolean)
      .map((r) => (typeof r === "string" ? JSON.parse(r) : r))
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, 10);

    topAgents = agents.map((a) => ({
      id: a.id,
      name: a.name,
      rank: a.rank,
      totalVolume: a.totalVolume,
    }));
  }

  return NextResponse.json({
    stats: {
      totalAgents: agentsCount || 0,
      totalPosts: postsCount || 0,
      totalTrades: tradesCount || 0,
      activity24h: {
        newAgents: recentAgents,
        newPosts: recentPosts,
        newTrades: recentTrades,
      },
    },
    leaderboard: topAgents,
    timestamp: Date.now(),
  });
}
