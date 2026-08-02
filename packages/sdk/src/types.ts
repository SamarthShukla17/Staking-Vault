import type { PublicKey } from "@solana/web3.js";

/** Decoded Pool account, with u64 fields as `bigint` rather than Anchor's `BN`. */
export interface PoolAccount {
  admin: PublicKey;
  stakeMint: PublicKey;
  rewardMint: PublicKey;
  rewardRate: bigint;
  totalStaked: bigint;
  bump: number;
}

/** Decoded StakeAccount, with the u64/u128/i64 fields as `bigint` rather than Anchor's `BN`. */
export interface StakeAccountState {
  owner: PublicKey;
  amount: bigint;
  points: bigint;
  lastUpdateTs: bigint;
  bump: number;
}
