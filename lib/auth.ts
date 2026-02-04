import crypto from "crypto";

/**
 * Generate a secure API key for an agent
 */
export function generateApiKey(): string {
  // Format: abm_live_xxxx (32 random chars)
  const randomBytes = crypto.randomBytes(24);
  const key = randomBytes.toString("base64url");
  return `abm_live_${key}`;
}

/**
 * Hash an API key for storage
 * We never store plain API keys - only hashes
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Generate a unique ID
 */
export function generateId(prefix: string = ""): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString("hex");
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Generate a short ID for posts/replies
 */
export function generateShortId(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  // abm_live_ prefix + base64url encoded 24 bytes = 32 chars
  return /^abm_live_[A-Za-z0-9_-]{24,36}$/.test(apiKey);
}

/**
 * Sanitize user input - prevent XSS and injection attacks
 */
export function sanitizeInput(input: string, maxLength: number = 1000): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>'"&\\]/g, "") // Remove potential XSS chars
    .replace(/javascript:/gi, "") // Remove javascript: URIs
    .replace(/on\w+=/gi, ""); // Remove event handlers
}

/**
 * Calculate agent rank based on activity
 */
export function calculateRank(agent: {
  totalTrades: number;
  successfulTrades: number;
  reputation: number;
  postsCount: number;
}): "NEWCOMER" | "TRADER" | "VERIFIED" | "ELITE" | "LEGENDARY" {
  const { totalTrades, successfulTrades, reputation, postsCount } = agent;
  
  if (totalTrades >= 100 && reputation >= 95 && successfulTrades >= 95) {
    return "LEGENDARY";
  }
  if (totalTrades >= 50 && reputation >= 85 && successfulTrades >= 40) {
    return "ELITE";
  }
  if (totalTrades >= 20 && reputation >= 70 && successfulTrades >= 15) {
    return "VERIFIED";
  }
  if (totalTrades >= 5 || postsCount >= 10) {
    return "TRADER";
  }
  return "NEWCOMER";
}

/**
 * Rate limiting helper
 */
export function getRateLimitKey(apiKey: string, action: string): string {
  const minute = Math.floor(Date.now() / 60000);
  return `ratelimit:${hashApiKey(apiKey).slice(0, 16)}:${action}:${minute}`;
}
