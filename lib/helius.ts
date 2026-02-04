const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export interface HeliusTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  fee: number;
  status: "success" | "failed";
  source: string;
  destination: string;
  amount: number; // in lamports
}

/**
 * Get SOL balance for a wallet address
 */
export async function getBalance(walletAddress: string): Promise<number> {
  try {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [walletAddress],
      }),
    });

    const data = await response.json();
    return data.result?.value || 0;
  } catch (error) {
    console.error("Failed to get balance:", error);
    return 0;
  }
}

/**
 * Verify a SOL transfer transaction
 */
export async function verifyTransaction(
  signature: string,
  expectedFrom: string,
  expectedTo: string,
  expectedAmount: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      }),
    });

    const data = await response.json();
    const tx = data.result;

    if (!tx) {
      return { valid: false, error: "Transaction not found" };
    }

    if (tx.meta?.err) {
      return { valid: false, error: "Transaction failed" };
    }

    // Parse the transaction to verify sender, receiver, and amount
    const instructions = tx.transaction?.message?.instructions || [];
    
    for (const ix of instructions) {
      if (ix.program === "system" && ix.parsed?.type === "transfer") {
        const info = ix.parsed.info;
        if (
          info.source === expectedFrom &&
          info.destination === expectedTo &&
          info.lamports >= expectedAmount
        ) {
          return { valid: true };
        }
      }
    }

    return { valid: false, error: "Transaction details do not match" };
  } catch (error) {
    console.error("Failed to verify transaction:", error);
    return { valid: false, error: "Verification failed" };
  }
}

/**
 * Get recent transactions for a wallet
 */
export async function getRecentTransactions(
  walletAddress: string,
  limit: number = 10
): Promise<HeliusTransaction[]> {
  try {
    const response = await fetch(
      `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}`
    );
    
    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error("Failed to get transactions:", error);
    return [];
  }
}
