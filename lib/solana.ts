import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Generate a new Solana wallet for an agent
 * Returns both public address and private key (base58 encoded)
 * Private key is ONLY returned once at registration - we don't store it
 */
export function generateSolanaWallet(): {
  publicKey: string;
  privateKey: string;
} {
  const keypair = Keypair.generate();
  
  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  };
}

/**
 * Validate a Solana wallet address
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    // Base58 check - Solana addresses are 32-44 chars
    if (address.length < 32 || address.length > 44) return false;
    bs58.decode(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * 1_000_000_000);
}

/**
 * Format SOL amount for display
 */
export function formatSol(lamports: number): string {
  const sol = lamportsToSol(lamports);
  if (sol < 0.001) return `${lamports} lamports`;
  return `${sol.toFixed(sol < 1 ? 4 : 2)} SOL`;
}
