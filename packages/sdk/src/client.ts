import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, type Provider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";

import IDL from "./idl/staking_vault.json";
import type { StakingVault } from "./idl/staking_vault_type";
import { claimableRewards } from "./math";
import { PROGRAM_ID, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, associatedTokenAddress, pool, stakeAccount, vaultAta } from "./pda";
import type { PoolAccount, StakeAccountState } from "./types";

const SYSVAR_CLOCK_PUBKEY = new PublicKey("SysvarC1ock11111111111111111111111111111111");

/**
 * The wallet shape `AnchorProvider` actually requires: `publicKey` + sign methods, nothing
 * more. Derived from `AnchorProvider`'s own constructor rather than imported as `@coral-xyz/
 * anchor`'s top-level `Wallet` export, which is a *different*, Node-only type (a concrete
 * `NodeWallet` subclass requiring a real `payer: Keypair`) — importing that one as a runtime
 * value breaks any bundler building this SDK for the browser, and even as a type it would
 * wrongly reject browser wallet-adapter objects (which never carry a raw Keypair) from callers
 * of this client's constructor.
 */
export type Wallet = ConstructorParameters<typeof AnchorProvider>[1];

/** True for anything already shaped like an Anchor Provider (e.g. a test-harness LiteSVMProvider). */
function isProviderLike(x: Connection | Provider): x is Provider {
  return typeof (x as Provider).sendAndConfirm === "function";
}

/**
 * BN -> bigint via hex, not `BN.prototype.toString(10)`: decimal toString has a documented bug
 * for BNs decoded from a fixed-width buffer with trailing zero words (can render as e.g.
 * "500000000NaN") for large u64/u128 values. Hex conversion doesn't share that bug.
 */
function bnToBigInt(bn: anchor.BN): bigint {
  return BigInt(`0x${bn.toString(16)}`);
}

function signOne<T extends Transaction | VersionedTransaction>(payer: Keypair, tx: T): T {
  if (tx instanceof VersionedTransaction) {
    tx.sign([payer]);
  } else {
    tx.partialSign(payer);
  }
  return tx;
}

/**
 * A throwaway signer for read-only use (no wallet passed to the constructor): can only ever
 * sign for its own freshly-generated Keypair, which nothing else references or funds, so any
 * actual write call still fails as intended. Built by hand rather than via
 * `@coral-xyz/anchor`'s `Wallet`/`NodeWallet` class, which is Node-only — its browser bundle
 * doesn't export it at all, so importing it as a runtime value (rather than only as the `Wallet`
 * *type*) breaks any bundler building this SDK for the browser, which is exactly where a
 * wallet-less read-only client is most useful (public stats before a wallet connects).
 */
function ephemeralReadOnlyWallet(): Wallet {
  const payer = Keypair.generate();
  return {
    publicKey: payer.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      return signOne(payer, tx);
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      return txs.map((tx) => signOne(payer, tx));
    },
  };
}

/** Typed TypeScript SDK client for the staking_vault Anchor program. */
export class StakingVaultClient {
  readonly provider: Provider;
  readonly program: Program<StakingVault>;
  private readonly hasWallet: boolean;

  /**
   * @param connectionOrProvider A real `Connection` for normal (devnet/mainnet) use, or a
   *   pre-built Anchor `Provider` (e.g. a test harness's `LiteSVMProvider`) for local/simulated
   *   environments that don't route through real JSON-RPC.
   * @param wallet Required for any write method (initializePool/stake/unstake/claim) when the
   *   first argument is a raw `Connection`. Ignored if the first argument is already a Provider.
   */
  constructor(connectionOrProvider: Connection | Provider, wallet?: Wallet) {
    if (isProviderLike(connectionOrProvider)) {
      this.provider = connectionOrProvider;
      this.hasWallet = true;
    } else {
      this.hasWallet = wallet !== undefined;
      const effectiveWallet = wallet ?? ephemeralReadOnlyWallet();
      this.provider = new AnchorProvider(connectionOrProvider, effectiveWallet, { commitment: "confirmed" });
    }
    this.program = new Program(IDL as anchor.Idl, this.provider) as unknown as Program<StakingVault>;
  }

  get programId(): PublicKey {
    return PROGRAM_ID;
  }

  private requireWallet(): PublicKey {
    const publicKey = this.provider.publicKey;
    if (!this.hasWallet || !publicKey) {
      throw new Error(
        "StakingVaultClient was constructed without a wallet — pass one to the constructor to sign transactions",
      );
    }
    return publicKey;
  }

  // ---- writes ----

  async initializePool(stakeMint: PublicKey, rewardMint: PublicKey, rewardRate: bigint): Promise<string> {
    const admin = this.requireWallet();
    const [poolPda] = pool(stakeMint);
    const [vault] = vaultAta(poolPda, stakeMint);

    return this.program.methods
      .initializePool(new BN(rewardRate.toString()))
      .accountsStrict({
        admin,
        pool: poolPda,
        stakeMint,
        rewardMint,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async stake(stakeMint: PublicKey, amount: bigint): Promise<string> {
    const user = this.requireWallet();
    const [poolPda] = pool(stakeMint);
    const [stakeAccountPda] = stakeAccount(poolPda, user);
    const [vault] = vaultAta(poolPda, stakeMint);
    const [userStakeAta] = associatedTokenAddress(stakeMint, user);

    return this.program.methods
      .stake(new BN(amount.toString()))
      .accountsStrict({
        user,
        pool: poolPda,
        stakeAccount: stakeAccountPda,
        userStakeAta,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async unstake(stakeMint: PublicKey, amount: bigint): Promise<string> {
    const user = this.requireWallet();
    const [poolPda] = pool(stakeMint);
    const [stakeAccountPda] = stakeAccount(poolPda, user);
    const [vault] = vaultAta(poolPda, stakeMint);
    const [userStakeAta] = associatedTokenAddress(stakeMint, user);

    return this.program.methods
      .unstake(new BN(amount.toString()))
      .accountsStrict({
        user,
        pool: poolPda,
        stakeAccount: stakeAccountPda,
        userStakeAta,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async claim(stakeMint: PublicKey): Promise<string> {
    const user = this.requireWallet();
    const [poolPda] = pool(stakeMint);
    const [stakeAccountPda] = stakeAccount(poolPda, user);

    const poolData = await this.getPool(stakeMint);
    if (!poolData) {
      throw new Error(`no pool found for stake mint ${stakeMint.toBase58()}`);
    }
    const [userRewardAta] = associatedTokenAddress(poolData.rewardMint, user);

    return this.program.methods
      .claim()
      .accountsStrict({
        user,
        pool: poolPda,
        stakeAccount: stakeAccountPda,
        rewardMint: poolData.rewardMint,
        userRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ---- reads ----

  async getPool(stakeMint: PublicKey): Promise<PoolAccount | null> {
    const [poolPda] = pool(stakeMint);
    try {
      const data = await this.program.account.pool.fetch(poolPda);
      return {
        admin: data.admin,
        stakeMint: data.stakeMint,
        rewardMint: data.rewardMint,
        rewardRate: bnToBigInt(data.rewardRate),
        totalStaked: bnToBigInt(data.totalStaked),
        bump: data.bump,
      };
    } catch {
      return null;
    }
  }

  async getStakeAccount(stakeMint: PublicKey, owner: PublicKey): Promise<StakeAccountState | null> {
    const [poolPda] = pool(stakeMint);
    const [stakeAccountPda] = stakeAccount(poolPda, owner);
    try {
      const data = await this.program.account.stakeAccount.fetch(stakeAccountPda);
      return {
        owner: data.owner,
        amount: bnToBigInt(data.amount),
        points: bnToBigInt(data.points),
        lastUpdateTs: bnToBigInt(data.lastUpdateTs),
        bump: data.bump,
      };
    } catch {
      return null;
    }
  }

  /**
   * Projected claimable reward (base units) as of `nowTs`, computed off-chain via math.ts —
   * without sending a transaction. Falls back to reading the on-chain Clock sysvar directly
   * (rather than `connection.getBlockTime`, which minimal/simulated providers such as a LiteSVM
   * test harness don't implement) when `nowTs` isn't supplied.
   */
  async getClaimable(stakeMint: PublicKey, owner: PublicKey, nowTs?: bigint): Promise<bigint> {
    const [poolData, stakeData] = await Promise.all([this.getPool(stakeMint), this.getStakeAccount(stakeMint, owner)]);
    if (!poolData || !stakeData) return 0n;

    const now = nowTs ?? (await this.currentOnChainTimestamp());
    return claimableRewards({
      amount: stakeData.amount,
      points: stakeData.points,
      lastUpdateTs: stakeData.lastUpdateTs,
      rewardRate: poolData.rewardRate,
      nowTs: now,
    });
  }

  private async currentOnChainTimestamp(): Promise<bigint> {
    const info = await this.provider.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!info) {
      throw new Error("could not read the Clock sysvar account");
    }
    // Clock sysvar layout: slot(u64) | epoch_start_timestamp(i64) | epoch(u64) |
    // leader_schedule_epoch(u64) | unix_timestamp(i64) — unix_timestamp is the last 8 bytes.
    return info.data.readBigInt64LE(32);
  }
}
