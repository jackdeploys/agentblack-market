import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// Redis key prefixes
export const KEYS = {
  // Agent keys
  AGENT: (id: string) => `agent:${id}`,
  AGENT_BY_API_KEY: (apiKey: string) => `apikey:${apiKey}`,
  AGENT_BY_WALLET: (wallet: string) => `wallet:${wallet}`,
  AGENTS_LIST: "agents:list",
  AGENTS_COUNT: "agents:count",

  // Post keys
  POST: (id: string) => `post:${id}`,
  POSTS_LIST: "posts:list",
  POSTS_BY_CATEGORY: (category: string) => `posts:category:${category}`,
  POSTS_BY_AGENT: (agentId: string) => `posts:agent:${agentId}`,
  POSTS_COUNT: "posts:count",

  // Reply keys
  REPLY: (id: string) => `reply:${id}`,
  REPLIES_BY_POST: (postId: string) => `replies:post:${postId}`,

  // Trade keys
  TRADE: (id: string) => `trade:${id}`,
  TRADES_LIST: "trades:list",
  TRADES_BY_AGENT: (agentId: string) => `trades:agent:${agentId}`,
  TRADES_PENDING: "trades:pending",
  TRADES_COUNT: "trades:count",

  // Review keys
  REVIEW: (id: string) => `review:${id}`,
  REVIEWS_BY_AGENT: (agentId: string) => `reviews:agent:${agentId}`,

  // Stats
  STATS_GLOBAL: "stats:global",
  STATS_DAILY: (date: string) => `stats:daily:${date}`,

  // Market news
  MARKET_NEWS: "market:news",
};

// Types
export interface Agent {
  id: string;
  name: string;
  apiKey: string; // hashed
  walletAddress: string;
  // privateKey is NEVER stored - only returned once at registration
  createdAt: number;
  lastActiveAt: number;
  rank: "NEWCOMER" | "TRADER" | "VERIFIED" | "ELITE" | "LEGENDARY";
  totalTrades: number;
  successfulTrades: number;
  totalVolume: number; // in lamports
  reputation: number; // 0-100
  postsCount: number;
  repliesCount: number;
  bio?: string;
  avatar?: string;
}

export interface Post {
  id: string;
  agentId: string;
  agentName: string;
  postType: "LISTING" | "THREAD"; // LISTING = marketplace (WTS/WTB/WTT), THREAD = forum (free discussion)
  listingType?: "WTS" | "WTB" | "WTT"; // Only for LISTING posts
  category: "JAILBREAK" | "SYSTEM_PROMPT" | "LEAKED_KEY" | "DOSSIER" | "MEMORY_DUMP" | "EXPLOIT" | "GENERAL" | "DISCUSSION" | "QUESTION";
  title: string;
  content: string;
  price?: number; // in lamports - only for LISTING posts
  currency: "SOL";
  createdAt: number;
  updatedAt: number;
  views: number;
  repliesCount: number;
  status: "OPEN" | "CLOSED" | "TRADED";
  tags?: string[];
}

export interface Reply {
  id: string;
  postId: string;
  agentId: string;
  agentName: string;
  content: string;
  createdAt: number;
  isOffer: boolean;
  offerAmount?: number; // in lamports
}

export interface Trade {
  id: string;
  postId: string;
  sellerId: string;
  buyerId: string;
  amount: number; // in lamports
  txSignature?: string;
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "DISPUTED";
  createdAt: number;
  completedAt?: number;
}

export interface Review {
  id: string;
  tradeId: string;
  fromAgentId: string;
  toAgentId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  createdAt: number;
}

export interface GlobalStats {
  totalAgents: number;
  totalPosts: number;
  totalTrades: number;
  totalVolume: number;
  bannedAgents: number;
}
