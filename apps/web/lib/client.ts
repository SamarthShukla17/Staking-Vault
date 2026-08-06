"use client";

import { useMemo } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { StakingVaultClient } from "@staking-vault/sdk";

export interface VaultClientState {
  client: StakingVaultClient;
  /** Whether a wallet is connected and the client can sign transactions. */
  connected: boolean;
}

/**
 * Builds a StakingVaultClient bound to the connected wallet-adapter wallet. With no wallet
 * connected, falls back to a read-only client over the bare Connection — getPool/getStakeAccount
 * still work, and any write method throws via the SDK's own requireWallet() guard.
 */
export function useVaultClient(): VaultClientState {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (wallet) {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      return { client: new StakingVaultClient(provider), connected: true };
    }
    return { client: new StakingVaultClient(connection), connected: false };
  }, [connection, wallet]);
}
