import { PublicKey } from "@solana/web3.js";

import IDL from "./idl/staking_vault.json";

/** The staking_vault program's on-chain address, read from the bundled IDL. */
export const PROGRAM_ID = new PublicKey((IDL as { address: string }).address);

// Well-known, cluster-independent addresses. Hardcoded rather than imported from
// @solana/spl-token so this package's only runtime dependencies are its declared peers
// (@coral-xyz/anchor, @solana/web3.js).
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const POOL_SEED = Buffer.from("pool");
const STAKE_SEED = Buffer.from("stake");

/** Pool PDA: seeds = ["pool", stake_mint]. */
export function pool(stakeMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POOL_SEED, stakeMint.toBuffer()], PROGRAM_ID);
}

/** StakeAccount PDA: seeds = ["stake", pool, owner]. */
export function stakeAccount(pool: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STAKE_SEED, pool.toBuffer(), owner.toBuffer()], PROGRAM_ID);
}

/**
 * Associated token account address for an arbitrary (mint, owner) pair — the same derivation
 * the SPL Associated Token program itself uses, computed here without depending on
 * @solana/spl-token.
 */
export function associatedTokenAddress(mint: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** Vault ATA: ATA(pool, stake_mint) — the pool PDA is the vault's token account authority. */
export function vaultAta(pool: PublicKey, stakeMint: PublicKey): [PublicKey, number] {
  return associatedTokenAddress(stakeMint, pool);
}
