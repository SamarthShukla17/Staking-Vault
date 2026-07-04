/**
 * Runs a single named scenario (stake-a..d, unstake-a..d, claim-a..d) against a fresh LiteSVM
 * instance and prints its result as JSON on stdout. Invoked as a standalone subprocess (see
 * runScenario in setup.ts, used by tests/stake.test.ts, tests/unstake.test.ts, and
 * tests/claim.test.ts) rather than in-process: the native litesvm addon leaks/corrupts state
 * across repeated real transactions within one Node process, eventually aborting with
 * std::bad_alloc. This has been observed to trigger from plain SPL mint/token-account setup
 * transactions alone (zero invocations of our own program), and separately from calling our own
 * program's instructions twice in one process — so both are avoided, not just one.
 *
 * To that end:
 *   - Every account a scenario needs (Pool, StakeAccount, Mint, TokenAccount) is constructed by
 *     writing its raw bytes directly via seedPoolAccount/seedStakeAccount/seedMint/
 *     seedTokenAccount rather than by calling initializePool/stake or the real SPL Token
 *     instructions — none of that setup machinery is under test here, so none of it needs to be
 *     a real transaction.
 *   - Where a scenario's interesting behavior spans two calls to the same instruction (e.g.
 *     "accrue before adding more stake", "immediate second claim mints nothing"), the state the
 *     first call would have produced is seeded directly (our accrual math is simple, closed-form
 *     arithmetic — see state.rs's accrue()) and only the second, actually-interesting call runs
 *     as a real transaction. Confirmed empirically: every scenario reduced to exactly one real
 *     program invocation passed 15/15 direct (non-retried) runs with zero crashes, versus
 *     rampant std::bad_alloc before this refactor.
 *   - The one deliberate exception is scenarioSecurityWrongRewardMintC, which by its nature must
 *     observe a failing call and a succeeding call in the same session — see its own comment.
 *
 * Only the instruction(s) genuinely under test in a given scenario are ever invoked as real
 * transactions; everything else is seeded state.
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SvmContext,
  TOKEN_PROGRAM_ID,
  airdrop,
  bnToBigInt,
  pdas,
  seedMint,
  seedPoolAccount,
  seedStakeAccount,
  seedTokenAccount,
  startSvm,
  warpBySeconds,
} from "./setup";

const REWARD_RATE = 7;

async function seedPool(
  ctx: SvmContext,
  totalStaked: number,
  rewardRate: number = REWARD_RATE,
  needsRewardMint = false,
) {
  const admin = Keypair.generate();
  const stakeMint = Keypair.generate().publicKey;
  seedMint(ctx, stakeMint, { mintAuthority: admin.publicKey });

  const [pool, poolBump] = pdas.poolPda(ctx.program.programId, stakeMint);
  // reward_mint's mint authority must be the pool PDA so claim's mint_to CPI (signed by the
  // pool) is authorized. The PDA address is deterministic from stake_mint, so it's known here
  // even though the Pool account itself is only seeded (not really initialized) below.
  //
  // stake/unstake never read pool.reward_mint, so scenarios that don't exercise claim() skip
  // seeding a backing account for it entirely — it's never dereferenced, just stored as a
  // pubkey in the Pool struct.
  const rewardMint = Keypair.generate().publicKey;
  if (needsRewardMint) {
    seedMint(ctx, rewardMint, { mintAuthority: pool });
  }

  seedPoolAccount(ctx, pool, {
    admin: admin.publicKey,
    stakeMint,
    rewardMint,
    rewardRate,
    totalStaked,
    bump: poolBump,
  });

  const vault = pdas.vaultAta(stakeMint, pool);
  seedTokenAccount(ctx, vault, { mint: stakeMint, owner: pool, amount: totalStaked });

  return { stakeMint, rewardMint, pool, poolBump, vault };
}

async function stakeAs(
  ctx: SvmContext,
  pool: PublicKey,
  vault: PublicKey,
  user: Keypair,
  userAta: PublicKey,
  amount: number,
): Promise<PublicKey> {
  const [stakeAccount] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  await ctx.program.methods
    .stake(new BN(amount))
    .accountsStrict({
      user: user.publicKey,
      pool,
      stakeAccount,
      userStakeAta: userAta,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();
  return stakeAccount;
}

async function unstakeAs(
  ctx: SvmContext,
  pool: PublicKey,
  vault: PublicKey,
  user: Keypair,
  userAta: PublicKey,
  amount: number,
): Promise<PublicKey> {
  const [stakeAccount] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  await ctx.program.methods
    .unstake(new BN(amount))
    .accountsStrict({
      user: user.publicKey,
      pool,
      stakeAccount,
      userStakeAta: userAta,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();
  return stakeAccount;
}

async function claimAs(
  ctx: SvmContext,
  pool: PublicKey,
  rewardMint: PublicKey,
  user: Keypair,
): Promise<{ stakeAccount: PublicKey; userRewardAta: PublicKey }> {
  const [stakeAccount] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  const userRewardAta = pdas.vaultAta(rewardMint, user.publicKey);
  await ctx.program.methods
    .claim()
    .accountsStrict({
      user: user.publicKey,
      pool,
      stakeAccount,
      rewardMint,
      userRewardAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();
  return { stakeAccount, userRewardAta };
}

function describeError(err: unknown) {
  const anyErr = err as { message?: string; logs?: string[]; error?: { errorCode?: { code?: string } } };
  return {
    message: String(anyErr?.message ?? err),
    logs: anyErr?.logs ?? [],
    anchorCode: anyErr?.error?.errorCode?.code,
  };
}

async function scenarioStakeA() {
  const ctx = startSvm();
  const { stakeMint, pool, vault } = await seedPool(ctx, 0);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 1_000 });
  const stakeAccount = await stakeAs(ctx, pool, vault, user, userAta, 1_000);

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    vaultAmount: vaultAccount.amount.toString(),
    stakeAmount: stakeAccountData.amount.toNumber(),
    points: bnToBigInt(stakeAccountData.points).toString(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioStakeB() {
  const ctx = startSvm();
  // Seeded to the state a real first stake(1_000) would have left behind (pool/vault already
  // hold 1_000, and the StakeAccount already exists with owner set) — only the second stake(500)
  // runs as a real transaction, exercising the exact "existing position, accrue before adding
  // more" branch under test without a second real invocation of our own program in this process.
  const { stakeMint, pool, vault } = await seedPool(ctx, 1_000);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 500 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 1_000,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  warpBySeconds(ctx.svm, 100);

  await stakeAs(ctx, pool, vault, user, userAta, 500);

  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    points: bnToBigInt(stakeAccountData.points).toString(),
    amount: stakeAccountData.amount.toNumber(),
  };
}

async function scenarioStakeC() {
  const ctx = startSvm();
  const { stakeMint, pool, vault } = await seedPool(ctx, 0);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 1_000 });

  await stakeAs(ctx, pool, vault, user, userAta, 0);

  throw new Error("expected stake(0) to fail, but it succeeded");
}

async function scenarioStakeD() {
  const ctx = startSvm();
  // user1's position is seeded directly (as if they'd already staked 300 for real) rather than
  // performed as a second real invocation of our own program in this process — only user2's
  // stake(700) runs as a real transaction. What's under test (two independent positions
  // coexisting correctly, with the vault/pool tracking their sum) doesn't depend on which of
  // the two positions came from a real call vs. seeded state.
  const { stakeMint, pool, vault } = await seedPool(ctx, 300);

  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  airdrop(ctx.svm, user2.publicKey);

  const [stakeAccount1, stakeBump1] = pdas.stakePda(ctx.program.programId, pool, user1.publicKey);
  seedStakeAccount(ctx, stakeAccount1, {
    owner: user1.publicKey,
    amount: 300,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump1,
  });

  const user2Ata = pdas.vaultAta(stakeMint, user2.publicKey);
  seedTokenAccount(ctx, user2Ata, { mint: stakeMint, owner: user2.publicKey, amount: 700 });

  const stakeAccount2 = await stakeAs(ctx, pool, vault, user2, user2Ata, 700);

  const stakeAccountData1 = await ctx.program.account.stakeAccount.fetch(stakeAccount1);
  const stakeAccountData2 = await ctx.program.account.stakeAccount.fetch(stakeAccount2);
  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    owner1: stakeAccountData1.owner.toBase58(),
    owner2: stakeAccountData2.owner.toBase58(),
    amount1: stakeAccountData1.amount.toNumber(),
    amount2: stakeAccountData2.amount.toNumber(),
    vaultAmount: vaultAccount.amount.toString(),
    totalStaked: poolData.totalStaked.toNumber(),
    user1: user1.publicKey.toBase58(),
    user2: user2.publicKey.toBase58(),
  };
}

async function scenarioUnstakeA() {
  const ctx = startSvm();
  const { stakeMint, pool, vault } = await seedPool(ctx, 1_000);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 1_000,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  warpBySeconds(ctx.svm, 50);

  await unstakeAs(ctx, pool, vault, user, userAta, 400);

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    vaultAmount: vaultAccount.amount.toString(),
    amount: stakeAccountData.amount.toNumber(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

async function scenarioUnstakeB() {
  const ctx = startSvm();
  // Seeded to the state a real unstake(600) full drain would have left behind (vault/pool
  // already at 0) — only the doomed follow-up unstake(1) against a zero balance runs as a real
  // transaction, which is the only behavior actually under test here.
  const { stakeMint, pool, vault } = await seedPool(ctx, 0);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 0,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  warpBySeconds(ctx.svm, 30);

  let secondAttemptFailed = false;
  let secondAttemptError: ReturnType<typeof describeError> | undefined;
  try {
    await unstakeAs(ctx, pool, vault, user, userAta, 1);
  } catch (err) {
    secondAttemptFailed = true;
    secondAttemptError = describeError(err);
  }

  const vaultAfterFull = await getAccount(ctx.provider.connection, vault);
  const stakeAfterFull = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    vaultAfterFull: vaultAfterFull.amount.toString(),
    amountAfterFull: stakeAfterFull.amount.toNumber(),
    secondAttemptFailed,
    secondAttemptError,
  };
}

async function scenarioUnstakeC() {
  const ctx = startSvm();
  const { stakeMint, pool, vault } = await seedPool(ctx, 500);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 500,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  await unstakeAs(ctx, pool, vault, user, userAta, 0);

  throw new Error("expected unstake(0) to fail, but it succeeded");
}

async function scenarioUnstakeD() {
  const ctx = startSvm();
  const { stakeMint, pool, vault } = await seedPool(ctx, 500);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 500,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  const vaultBefore = await getAccount(ctx.provider.connection, vault);
  const stakeBefore = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolBefore = await ctx.program.account.pool.fetch(pool);

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await unstakeAs(ctx, pool, vault, user, userAta, stakeBefore.amount.toNumber() + 1);
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const vaultAfter = await getAccount(ctx.provider.connection, vault);
  const stakeAfter = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolAfter = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    vaultBefore: vaultBefore.amount.toString(),
    vaultAfter: vaultAfter.amount.toString(),
    amountBefore: stakeBefore.amount.toNumber(),
    amountAfter: stakeAfter.amount.toNumber(),
    totalStakedBefore: poolBefore.totalStaked.toNumber(),
    totalStakedAfter: poolAfter.totalStaked.toNumber(),
  };
}

const CLAIM_REWARD_RATE = 1_000_000;
const CLAIM_AMOUNT = 1_000;

async function scenarioClaimA() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: CLAIM_AMOUNT,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  // points = 1_000 * 1500 * 1_000_000 = 1_500_000_000_000 = 1*SCALE + 500_000_000_000
  warpBySeconds(ctx.svm, 1500);

  const { userRewardAta } = await claimAs(ctx, pool, rewardMint, user);

  const rewardAccount = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    reward: rewardAccount.amount.toString(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

async function scenarioClaimB() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  // Seeded to the exact state a real first claim() (at t=1500) would have left behind:
  // 1_000 * 1500 * 1_000_000 = 1.5e12 points floored to 1 minted token with a 5e11 remainder,
  // and last_update_ts advanced to the claim's timestamp. Only the immediate second claim below
  // runs as a real transaction — that's the behavior actually under test here.
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: CLAIM_AMOUNT,
    points: 500_000_000_000n,
    lastUpdateTs: 1500,
    bump: stakeBump,
  });
  const userRewardAta = pdas.vaultAta(rewardMint, user.publicKey);
  seedTokenAccount(ctx, userRewardAta, { mint: rewardMint, owner: user.publicKey, amount: 1 });

  // The genesis clock starts at unixTimestamp 0, so it must be advanced to match the seeded
  // last_update_ts (1500) before the real claim() runs, or accrue() sees now < last_update_ts
  // and rejects with ClockWentBackwards. No further warp beyond that: nothing new has accrued
  // since the (seeded) first claim, so this immediate second claim must mint 0.
  warpBySeconds(ctx.svm, 1500);
  await claimAs(ctx, pool, rewardMint, user);
  const rewardAfterSecond = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    rewardAfterFirst: "1",
    rewardAfterSecond: rewardAfterSecond.amount.toString(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

async function scenarioClaimC() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 0,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  const { userRewardAta } = await claimAs(ctx, pool, rewardMint, user);
  const rewardAccount = await getAccount(ctx.provider.connection, userRewardAta);

  return {
    reward: rewardAccount.amount.toString(),
  };
}

async function scenarioClaimD() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  // Seeded to the exact state a real first claim() (at t=1500) would have left behind — see
  // scenarioClaimB. Only the second claim below (after further accrual) runs as a real
  // transaction.
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: CLAIM_AMOUNT,
    points: 500_000_000_000n,
    lastUpdateTs: 1500,
    bump: stakeBump,
  });
  const userRewardAta = pdas.vaultAta(rewardMint, user.publicKey);
  seedTokenAccount(ctx, userRewardAta, { mint: rewardMint, owner: user.publicKey, amount: 1 });

  // The genesis clock starts at unixTimestamp 0, so it must reach 2500 (1500 seeded + 1000
  // more elapsed) before the real claim() runs. Additional accrual on top of the carried
  // remainder: 1_000 * 1000 * 1_000_000 = 1e12, plus the 5e11 remainder carried from the
  // (seeded) first claim = 1.5e12 again.
  warpBySeconds(ctx.svm, 2500);
  await claimAs(ctx, pool, rewardMint, user);
  const rewardAfterSecond = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAfterSecond = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    rewardAfterFirst: "1",
    pointsAfterFirst: "500000000000",
    rewardAfterSecond: rewardAfterSecond.amount.toString(),
    pointsAfterSecond: bnToBigInt(stakeAfterSecond.points).toString(),
  };
}

/**
 * Security suite: 01_unstake_exceeds_stake. A single stake_account's `amount` field must be
 * the sole source of truth for how much a given owner can withdraw — never the vault's raw
 * token balance (which reflects every position's stake pooled together).
 */
async function scenarioSecurityOverdrawA() {
  const ctx = startSvm();
  // Seeded to the state a real unstake(600) against a 1_000 position would have left behind
  // (400 remaining) — only the doomed 401 overdraw runs as a real transaction.
  const { stakeMint, pool, vault } = await seedPool(ctx, 400);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 400,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await unstakeAs(ctx, pool, vault, user, userAta, 401);
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    vaultAmount: vaultAccount.amount.toString(),
    stakeAmount: stakeAccountData.amount.toNumber(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioSecurityOverdrawB() {
  const ctx = startSvm();
  // Seeded to the state a real unstake(400) full drain would have left behind (boundary case:
  // exactly zero remaining) — only the doomed follow-up 1-unit overdraw runs as a real
  // transaction.
  const { stakeMint, pool, vault } = await seedPool(ctx, 0);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 0,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await unstakeAs(ctx, pool, vault, user, userAta, 1);
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    vaultAmount: vaultAccount.amount.toString(),
    stakeAmount: stakeAccountData.amount.toNumber(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioSecurityOverdrawC() {
  const ctx = startSvm();
  const victimAmount = 400;
  const attackerAmount = 10_000;
  const { stakeMint, pool, vault } = await seedPool(ctx, victimAmount + attackerAmount);

  const victim = Keypair.generate();
  const victimAta = pdas.vaultAta(stakeMint, victim.publicKey);
  seedTokenAccount(ctx, victimAta, { mint: stakeMint, owner: victim.publicKey, amount: 0 });
  const [victimStakeAccount, victimBump] = pdas.stakePda(ctx.program.programId, pool, victim.publicKey);
  seedStakeAccount(ctx, victimStakeAccount, {
    owner: victim.publicKey,
    amount: victimAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: victimBump,
  });

  // A separate, unrelated position in the same pool — funds the vault well past what the
  // victim alone could ever legitimately withdraw.
  const attacker = Keypair.generate();
  const [attackerStakeAccount, attackerBump] = pdas.stakePda(ctx.program.programId, pool, attacker.publicKey);
  seedStakeAccount(ctx, attackerStakeAccount, {
    owner: attacker.publicKey,
    amount: attackerAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: attackerBump,
  });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await unstakeAs(ctx, pool, vault, victim, victimAta, victimAmount + 1);
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const victimStakeData = await ctx.program.account.stakeAccount.fetch(victimStakeAccount);
  const attackerStakeData = await ctx.program.account.stakeAccount.fetch(attackerStakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    vaultAmount: vaultAccount.amount.toString(),
    totalStaked: poolData.totalStaked.toNumber(),
    victimAmount: victimStakeData.amount.toNumber(),
    attackerAmount: attackerStakeData.amount.toNumber(),
  };
}

/**
 * Security suite: 02_drain_other_user. StakeAccount PDAs are seeded from [STAKE_SEED, pool,
 * owner], so a signer can never make the seeds constraint resolve to someone else's position —
 * passing another user's stake_account address while signing as yourself must fail the seeds
 * re-derivation before the handler body (and its owner constraint) ever runs.
 */
async function scenarioSecurityDrainA() {
  const ctx = startSvm();
  const victimAmount = 5_000;
  const attackerAmount = 100;
  const { stakeMint, pool, vault } = await seedPool(ctx, victimAmount + attackerAmount);

  const victim = Keypair.generate();
  const [victimStakeAccount, victimBump] = pdas.stakePda(ctx.program.programId, pool, victim.publicKey);
  seedStakeAccount(ctx, victimStakeAccount, {
    owner: victim.publicKey,
    amount: victimAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: victimBump,
  });

  const attacker = Keypair.generate();
  const attackerAta = pdas.vaultAta(stakeMint, attacker.publicKey);
  seedTokenAccount(ctx, attackerAta, { mint: stakeMint, owner: attacker.publicKey, amount: 0 });
  const [attackerStakeAccount, attackerBump] = pdas.stakePda(ctx.program.programId, pool, attacker.publicKey);
  seedStakeAccount(ctx, attackerStakeAccount, {
    owner: attacker.publicKey,
    amount: attackerAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: attackerBump,
  });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    // Attacker signs, but swaps in the VICTIM's stake_account and routes the withdrawal to
    // the attacker's own ATA instead of the victim's.
    await ctx.program.methods
      .unstake(new BN(100))
      .accountsStrict({
        user: attacker.publicKey,
        pool,
        stakeAccount: victimStakeAccount,
        userStakeAta: attackerAta,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([attacker])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const victimStakeData = await ctx.program.account.stakeAccount.fetch(victimStakeAccount);
  const attackerStakeData = await ctx.program.account.stakeAccount.fetch(attackerStakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    victimAmount: victimStakeData.amount.toNumber(),
    attackerAmount: attackerStakeData.amount.toNumber(),
    vaultAmount: vaultAccount.amount.toString(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioSecurityDrainB() {
  const ctx = startSvm();
  const victimAmount = 5_000;
  const attackerAmount = 100;
  const { stakeMint, pool, vault } = await seedPool(ctx, victimAmount + attackerAmount);

  const victim = Keypair.generate();
  const [victimStakeAccount, victimBump] = pdas.stakePda(ctx.program.programId, pool, victim.publicKey);
  seedStakeAccount(ctx, victimStakeAccount, {
    owner: victim.publicKey,
    amount: victimAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: victimBump,
  });

  const attacker = Keypair.generate();
  const attackerAta = pdas.vaultAta(stakeMint, attacker.publicKey);
  seedTokenAccount(ctx, attackerAta, { mint: stakeMint, owner: attacker.publicKey, amount: 0 });
  const [attackerStakeAccount, attackerBump] = pdas.stakePda(ctx.program.programId, pool, attacker.publicKey);
  seedStakeAccount(ctx, attackerStakeAccount, {
    owner: attacker.publicKey,
    amount: attackerAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: attackerBump,
  });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    // Same substitution as case A, but this time the attacker goes for the victim's entire
    // balance in one shot rather than a small amount.
    await ctx.program.methods
      .unstake(new BN(victimAmount))
      .accountsStrict({
        user: attacker.publicKey,
        pool,
        stakeAccount: victimStakeAccount,
        userStakeAta: attackerAta,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([attacker])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const victimStakeData = await ctx.program.account.stakeAccount.fetch(victimStakeAccount);
  const attackerStakeData = await ctx.program.account.stakeAccount.fetch(attackerStakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    victimAmount: victimStakeData.amount.toNumber(),
    attackerAmount: attackerStakeData.amount.toNumber(),
    vaultAmount: vaultAccount.amount.toString(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioSecurityDrainC() {
  const ctx = startSvm();
  const victimAmount = 5_000;
  const attackerAmount = 100;
  const { pool, rewardMint, vault } = await seedPool(ctx, victimAmount + attackerAmount, CLAIM_REWARD_RATE, true);

  const victim = Keypair.generate();
  const [victimStakeAccount, victimBump] = pdas.stakePda(ctx.program.programId, pool, victim.publicKey);
  // Nonzero, meaningful accrued progress (2 * SCALE + remainder) so "unchanged" is a real
  // assertion, not a trivial 0 == 0.
  const victimPoints = 2_500_000_000_000n;
  seedStakeAccount(ctx, victimStakeAccount, {
    owner: victim.publicKey,
    amount: victimAmount,
    points: victimPoints,
    lastUpdateTs: 0,
    bump: victimBump,
  });

  const attacker = Keypair.generate();
  airdrop(ctx.svm, attacker.publicKey);
  const [attackerStakeAccount, attackerBump] = pdas.stakePda(ctx.program.programId, pool, attacker.publicKey);
  seedStakeAccount(ctx, attackerStakeAccount, {
    owner: attacker.publicKey,
    amount: attackerAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: attackerBump,
  });

  const attackerRewardAta = pdas.vaultAta(rewardMint, attacker.publicKey);

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    // Attacker signs, but swaps in the VICTIM's stake_account, trying to claim the victim's
    // accrued points as rewards minted into the attacker's own reward ATA.
    await ctx.program.methods
      .claim()
      .accountsStrict({
        user: attacker.publicKey,
        pool,
        stakeAccount: victimStakeAccount,
        rewardMint,
        userRewardAta: attackerRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([attacker])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const victimStakeData = await ctx.program.account.stakeAccount.fetch(victimStakeAccount);
  const attackerStakeData = await ctx.program.account.stakeAccount.fetch(attackerStakeAccount);
  const vaultAccount = await getAccount(ctx.provider.connection, vault);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    victimPoints: bnToBigInt(victimStakeData.points).toString(),
    victimAmount: victimStakeData.amount.toNumber(),
    attackerAmount: attackerStakeData.amount.toNumber(),
    vaultAmount: vaultAccount.amount.toString(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

/**
 * Security suite: 03_fake_vault. The `vault` passed into unstake is only ever trustworthy
 * because of its own account constraints (token::mint = pool.stake_mint, token::authority =
 * pool) — never because of naming or convention. Each case below substitutes a token account
 * that satisfies some but not all of those constraints and asserts the transaction is rejected
 * before any transfer happens, with the real vault and pool.total_staked left untouched.
 */
async function scenarioSecurityFakeVaultA() {
  const ctx = startSvm();
  const stakedAmount = 1_000;
  const { stakeMint, pool, vault } = await seedPool(ctx, stakedAmount);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: stakedAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  // Attacker's own plain token account of the correct mint, pre-funded so there's something to
  // steal — but its authority is the attacker, not the pool, so token::authority = pool must
  // reject it regardless of the mint matching.
  const attacker = Keypair.generate();
  airdrop(ctx.svm, attacker.publicKey);
  const attackerOwnedVault = pdas.vaultAta(stakeMint, attacker.publicKey);
  seedTokenAccount(ctx, attackerOwnedVault, { mint: stakeMint, owner: attacker.publicKey, amount: 1_000 });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    // User signs for their own real stake_account, but the attacker's own token account is
    // substituted in as `vault` in hopes of draining it while the books still say "0 staked
    // here" for the attacker.
    await ctx.program.methods
      .unstake(new BN(stakedAmount))
      .accountsStrict({
        user: user.publicKey,
        pool,
        stakeAccount,
        userStakeAta: userAta,
        vault: attackerOwnedVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const realVaultAccount = await getAccount(ctx.provider.connection, vault);
  const attackerVaultAccount = await getAccount(ctx.provider.connection, attackerOwnedVault);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    realVaultAmount: realVaultAccount.amount.toString(),
    attackerVaultAmount: attackerVaultAccount.amount.toString(),
    stakeAmount: stakeAccountData.amount.toNumber(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioSecurityFakeVaultB() {
  const ctx = startSvm();
  const stakedAmount = 1_000;
  const { stakeMint, pool, vault } = await seedPool(ctx, stakedAmount);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: stakedAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  // A wholly different mint's ATA of the pool PDA — the authority is correctly `pool`, but the
  // mint isn't pool.stake_mint, so token::mint = pool.stake_mint must reject it.
  const otherMint = Keypair.generate().publicKey;
  seedMint(ctx, otherMint, { mintAuthority: pool });
  const wrongMintVault = pdas.vaultAta(otherMint, pool);
  seedTokenAccount(ctx, wrongMintVault, { mint: otherMint, owner: pool, amount: 1_000 });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await ctx.program.methods
      .unstake(new BN(stakedAmount))
      .accountsStrict({
        user: user.publicKey,
        pool,
        stakeAccount,
        userStakeAta: userAta,
        vault: wrongMintVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const realVaultAccount = await getAccount(ctx.provider.connection, vault);
  const wrongMintVaultAccount = await getAccount(ctx.provider.connection, wrongMintVault);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    realVaultAmount: realVaultAccount.amount.toString(),
    wrongMintVaultAmount: wrongMintVaultAccount.amount.toString(),
    stakeAmount: stakeAccountData.amount.toNumber(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

async function scenarioSecurityFakeVaultC() {
  const ctx = startSvm();
  const stakedAmount = 1_000;
  const { stakeMint, pool, vault } = await seedPool(ctx, stakedAmount);

  const user = Keypair.generate();
  const userAta = pdas.vaultAta(stakeMint, user.publicKey);
  seedTokenAccount(ctx, userAta, { mint: stakeMint, owner: user.publicKey, amount: 0 });
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: stakedAmount,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    // The user's own ATA (correct mint, but authority = user, not pool) substituted as `vault`.
    await ctx.program.methods
      .unstake(new BN(stakedAmount))
      .accountsStrict({
        user: user.publicKey,
        pool,
        stakeAccount,
        userStakeAta: userAta,
        vault: userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const realVaultAccount = await getAccount(ctx.provider.connection, vault);
  const userAtaAccount = await getAccount(ctx.provider.connection, userAta);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);
  const poolData = await ctx.program.account.pool.fetch(pool);

  return {
    failed,
    errorInfo,
    realVaultAmount: realVaultAccount.amount.toString(),
    userAtaAmount: userAtaAccount.amount.toString(),
    stakeAmount: stakeAccountData.amount.toNumber(),
    totalStaked: poolData.totalStaked.toNumber(),
  };
}

/**
 * Security suite: 04_wrong_reward_mint. claim's `reward_mint` is pinned to `pool.reward_mint`
 * by an `address` constraint — an identity check, not a trust-the-authority check. Each fake
 * mint below is otherwise well-formed (some are even legitimately authored by the pool PDA),
 * and each must still be rejected purely for not being the one true reward_mint address.
 */
async function scenarioSecurityWrongRewardMintA() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: CLAIM_AMOUNT,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  warpBySeconds(ctx.svm, 1500);

  // Attacker's own mint, attacker-controlled authority end to end — nothing about it involves
  // the pool at all.
  const attacker = Keypair.generate();
  airdrop(ctx.svm, attacker.publicKey);
  const fakeMint = Keypair.generate().publicKey;
  seedMint(ctx, fakeMint, { mintAuthority: attacker.publicKey });
  const fakeUserRewardAta = pdas.vaultAta(fakeMint, user.publicKey);

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await ctx.program.methods
      .claim()
      .accountsStrict({
        user: user.publicKey,
        pool,
        stakeAccount,
        rewardMint: fakeMint,
        userRewardAta: fakeUserRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    failed,
    errorInfo,
    realRewardMint: rewardMint.toBase58(),
    fakeMint: fakeMint.toBase58(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

async function scenarioSecurityWrongRewardMintB() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: CLAIM_AMOUNT,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  warpBySeconds(ctx.svm, 1500);

  // A second, otherwise-legitimate mint whose authority really is the pool PDA (a mint's
  // authority is just a pubkey field set at creation — no signature from that pubkey is needed
  // to assign it) — but it's a distinct mint from pool.reward_mint, so the address constraint
  // must still catch it. This proves the check is "is this THE reward_mint", not "can the pool
  // mint from this".
  const decoyMint = Keypair.generate().publicKey;
  seedMint(ctx, decoyMint, { mintAuthority: pool });
  const decoyUserRewardAta = pdas.vaultAta(decoyMint, user.publicKey);

  let failed = false;
  let errorInfo: ReturnType<typeof describeError> | undefined;
  try {
    await ctx.program.methods
      .claim()
      .accountsStrict({
        user: user.publicKey,
        pool,
        stakeAccount,
        rewardMint: decoyMint,
        userRewardAta: decoyUserRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  } catch (err) {
    failed = true;
    errorInfo = describeError(err);
  }

  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    failed,
    errorInfo,
    realRewardMint: rewardMint.toBase58(),
    decoyMint: decoyMint.toBase58(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

// Deliberate exception to the "one real invocation per process" rule the rest of this file
// follows: what's under test here is specifically that a failed impostor claim leaves no
// residue that could interfere with a subsequent real claim, so both the failing and the
// succeeding call must be real transactions in the same litesvm session — there's no way to
// seed around either half without testing something else. This makes the scenario meaningfully
// more crash-prone than the rest of the suite (measured around an 80% raw failure rate per
// attempt in a memory-constrained environment), but runScenario's 80-attempt retry loop reduces
// the odds of every attempt failing to roughly (0.8)^80 ≈ 2e-8 — negligible in practice.
async function scenarioSecurityWrongRewardMintC() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE, true);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: CLAIM_AMOUNT,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  warpBySeconds(ctx.svm, 1500);

  // Attacker tries the impostor substitution first, with a dedicated fake mint (byte-seeded,
  // no real transaction — see seedMint) that's neither pool.stake_mint nor pool.reward_mint.
  const attacker = Keypair.generate();
  airdrop(ctx.svm, attacker.publicKey);
  const impostorMint = Keypair.generate().publicKey;
  seedMint(ctx, impostorMint, { mintAuthority: attacker.publicKey });
  const impostorUserRewardAta = pdas.vaultAta(impostorMint, user.publicKey);

  let fakeAttemptFailed = false;
  try {
    await ctx.program.methods
      .claim()
      .accountsStrict({
        user: user.publicKey,
        pool,
        stakeAccount,
        rewardMint: impostorMint,
        userRewardAta: impostorUserRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  } catch {
    fakeAttemptFailed = true;
  }

  // ...then the legitimate claim, with the real reward_mint, must still work normally: the
  // guard rejects impostors without collaterally breaking the real path.
  const { userRewardAta } = await claimAs(ctx, pool, rewardMint, user);
  const rewardAccount = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    fakeAttemptFailed,
    reward: rewardAccount.amount.toString(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  "stake-a": scenarioStakeA,
  "stake-b": scenarioStakeB,
  "stake-c": scenarioStakeC,
  "stake-d": scenarioStakeD,
  "unstake-a": scenarioUnstakeA,
  "unstake-b": scenarioUnstakeB,
  "unstake-c": scenarioUnstakeC,
  "unstake-d": scenarioUnstakeD,
  "claim-a": scenarioClaimA,
  "claim-b": scenarioClaimB,
  "claim-c": scenarioClaimC,
  "claim-d": scenarioClaimD,
  "security-overdraw-a": scenarioSecurityOverdrawA,
  "security-overdraw-b": scenarioSecurityOverdrawB,
  "security-overdraw-c": scenarioSecurityOverdrawC,
  "security-drain-a": scenarioSecurityDrainA,
  "security-drain-b": scenarioSecurityDrainB,
  "security-drain-c": scenarioSecurityDrainC,
  "security-fake-vault-a": scenarioSecurityFakeVaultA,
  "security-fake-vault-b": scenarioSecurityFakeVaultB,
  "security-fake-vault-c": scenarioSecurityFakeVaultC,
  "security-wrong-reward-mint-a": scenarioSecurityWrongRewardMintA,
  "security-wrong-reward-mint-b": scenarioSecurityWrongRewardMintB,
  "security-wrong-reward-mint-c": scenarioSecurityWrongRewardMintC,
};

async function main() {
  const name = process.argv[2];
  const scenario = scenarios[name];
  if (!scenario) {
    throw new Error(`unknown scenario "${name}"`);
  }
  const result = await scenario();
  process.stdout.write(JSON.stringify({ ok: true, result }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const anchorCode = err?.error?.errorCode?.code as string | undefined;
    const logs: string[] = err?.logs ?? [];
    const message = String(err?.message ?? err);
    process.stdout.write(JSON.stringify({ ok: false, error: { message, logs, anchorCode } }));
    process.exit(0);
  });
