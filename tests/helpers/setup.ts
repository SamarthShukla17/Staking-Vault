import * as path from "path";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { fromWorkspace, LiteSVMProvider } from "anchor-litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { StakingVault } from "../../target/types/staking_vault";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../../target/idl/staking_vault.json");

export type Svm = ReturnType<typeof fromWorkspace>;

export interface SvmContext {
  svm: Svm;
  provider: LiteSVMProvider;
  program: Program<StakingVault>;
}

/** Boots a fresh LiteSVM instance with the staking_vault program loaded from the workspace build output. */
export function startSvm(): SvmContext {
  const workspace = path.resolve(__dirname, "..", "..");
  const svm = fromWorkspace(workspace);
  const provider = new LiteSVMProvider(svm);
  const program = new Program<StakingVault>(IDL, provider);
  return { svm, provider, program };
}

/** Airdrops native SOL to a keypair so it can act as a fee/rent payer in tests. */
export function airdrop(svm: Svm, pubkey: PublicKey, lamports: number = anchor.web3.LAMPORTS_PER_SOL): void {
  svm.airdrop(pubkey, BigInt(lamports));
}

/** Creates a new SPL mint. Defaults the mint authority to the provider's wallet. */
export async function createMint(
  { svm, provider }: SvmContext,
  decimals = 6,
  mintAuthority: PublicKey = provider.wallet.publicKey,
): Promise<PublicKey> {
  const mint = Keypair.generate();
  const rent = svm.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(MINT_SIZE)));

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, decimals, mintAuthority, null, TOKEN_PROGRAM_ID),
  );

  await provider.sendAndConfirm!(tx, [mint]);
  return mint.publicKey;
}

/** Creates `owner`'s associated token account for `mint` (if needed) and mints `amount` base units into it. */
export async function createAtaAndMint(
  { provider }: SvmContext,
  mint: PublicKey,
  owner: PublicKey,
  amount: number | bigint,
  mintAuthority: Keypair = provider.wallet.payer,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(provider.wallet.publicKey, ata, owner, mint),
    createMintToInstruction(mint, ata, mintAuthority.publicKey, amount),
  );

  const signers = mintAuthority.publicKey.equals(provider.wallet.publicKey) ? [] : [mintAuthority];
  await provider.sendAndConfirm!(tx, signers);
  return ata;
}

/** Advances the on-chain clock's unix timestamp by `seconds`, leaving slot/epoch untouched. */
export function warpBySeconds(svm: Svm, seconds: number): void {
  const clock = svm.getClock();
  clock.unixTimestamp = clock.unixTimestamp + BigInt(seconds);
  svm.setClock(clock);
}

/**
 * Awaits `promise`, asserting it rejects with the given Anchor custom error name
 * (matched against the parsed AnchorError when available, falling back to raw logs).
 */
export async function expectAnchorError(promise: Promise<unknown>, errorCode: string): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch (err) {
    threw = true;
    if (err instanceof anchor.AnchorError) {
      expect(err.error.errorCode.code).to.equal(errorCode);
    } else {
      const anyErr = err as { message?: string; logs?: string[] };
      const haystack = [anyErr.message, ...(anyErr.logs ?? [])].filter(Boolean).join("\n");
      expect(haystack, `expected error logs to mention "${errorCode}", got:\n${haystack}`).to.include(errorCode);
    }
  }
  expect(threw, `expected transaction to fail with ${errorCode}, but it succeeded`).to.equal(true);
}

export function poolPda(programId: PublicKey, stakeMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), stakeMint.toBuffer()], programId);
}

export function stakePda(programId: PublicKey, pool: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("stake"), pool.toBuffer(), owner.toBuffer()], programId);
}

export function vaultAta(stakeMint: PublicKey, pool: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(stakeMint, pool, true);
}

export const pdas = { poolPda, stakePda, vaultAta };

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID };

/**
 * Safely converts a fetched u128 BN (e.g. StakeAccount.points) to a bigint via its raw bytes.
 * `BN.prototype.toString(10)` has a real, reproducible bug for BNs decoded from a fixed-width
 * 16-byte buffer with trailing zero words (their `words` array is longer than their effective
 * `length`) — it intermittently renders as e.g. "500000000NaN". Reading the bytes directly
 * sidesteps that entirely.
 */
export function bnToBigInt(bn: { toArray: (endian: "le" | "be", length: number) => number[] }): bigint {
  const bytes = bn.toArray("le", 16);
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function accountDiscriminator(name: string): Buffer {
  return Buffer.from(createHash("sha256").update(`account:${name}`).digest().subarray(0, 8));
}

function u64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function i64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value));
  return buf;
}

function u128LE(value: bigint | number): Buffer {
  const v = BigInt(value);
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(v & 0xffffffffffffffffn, 0);
  buf.writeBigUInt64LE(v >> 64n, 8);
  return buf;
}

export interface PoolSeed {
  admin: PublicKey;
  stakeMint: PublicKey;
  rewardMint: PublicKey;
  rewardRate: bigint | number;
  totalStaked: bigint | number;
  bump: number;
}

/**
 * Writes a Pool account's bytes directly into the LiteSVM instance, bypassing the
 * `initializePool` instruction. Used purely to arrange test state: `initializePool` isn't
 * under test here, and skipping the extra program invocation reduces how many BPF calls pile
 * up in one process (see runScenario's doc comment for why that matters).
 */
export function seedPoolAccount(ctx: SvmContext, pool: PublicKey, seed: PoolSeed): void {
  const data = Buffer.concat([
    accountDiscriminator("Pool"),
    seed.admin.toBuffer(),
    seed.stakeMint.toBuffer(),
    seed.rewardMint.toBuffer(),
    u64LE(seed.rewardRate),
    u64LE(seed.totalStaked),
    Buffer.from([seed.bump]),
  ]);
  const lamports = Number(ctx.svm.getRent().minimumBalance(BigInt(data.length)));
  ctx.svm.setAccount(pool, {
    lamports,
    data,
    owner: ctx.program.programId,
    executable: false,
    rentEpoch: 0,
  });
}

export interface StakeAccountSeed {
  owner: PublicKey;
  amount: bigint | number;
  points: bigint | number;
  lastUpdateTs: bigint | number;
  bump: number;
}

/** Writes a StakeAccount's bytes directly into the LiteSVM instance; see seedPoolAccount. */
export function seedStakeAccount(ctx: SvmContext, stakeAccount: PublicKey, seed: StakeAccountSeed): void {
  const data = Buffer.concat([
    accountDiscriminator("StakeAccount"),
    seed.owner.toBuffer(),
    u64LE(seed.amount),
    u128LE(seed.points),
    i64LE(seed.lastUpdateTs),
    Buffer.from([seed.bump]),
  ]);
  const lamports = Number(ctx.svm.getRent().minimumBalance(BigInt(data.length)));
  ctx.svm.setAccount(stakeAccount, {
    lamports,
    data,
    owner: ctx.program.programId,
    executable: false,
    rentEpoch: 0,
  });
}

export interface ScenarioResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: { message: string; logs: string[]; anchorCode?: string };
}

/**
 * Runs a named scenario from tests/helpers/runner.ts in a fresh subprocess and returns its
 * parsed JSON result. See runner.ts for why: the native litesvm addon leaks/corrupts state
 * across repeated BPF program invocations within one process, eventually aborting with
 * std::bad_alloc, so each scenario gets its own short-lived process. A crashed subprocess
 * (killed by signal, e.g. SIGABRT) is retried a few times before giving up.
 */
export function runScenario<T = unknown>(name: string, retries = 80): ScenarioResult<T> {
  const runnerPath = path.resolve(__dirname, "runner.ts");
  const tsNodeBin = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "ts-node");
  const tsconfigPath = path.resolve(__dirname, "..", "..", "tsconfig.json");

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = execFileSync(tsNodeBin, ["--transpile-only", "-P", tsconfigPath, runnerPath, name], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const trimmed = out.trim();
      if (trimmed.includes("NaN")) {
        // The same native memory corruption that causes std::bad_alloc crashes can, rarely,
        // corrupt a value without actually crashing the process (observed as a stringified
        // BN turning into e.g. "500000000NaN"). Treat that the same as a crash: retry fresh.
        throw new Error(`corrupted scenario output (contains NaN): ${trimmed}`);
      }
      return JSON.parse(trimmed) as ScenarioResult<T>;
    } catch (err) {
      lastErr = err;
      // Subprocess crashed (e.g. native std::bad_alloc/SIGABRT) rather than exiting cleanly
      // with JSON on stdout — retry with a fresh process, after a short pause so a transient
      // system memory dip has a chance to recover.
      execFileSync("sleep", ["0.2"]);
    }
  }
  throw lastErr;
}
