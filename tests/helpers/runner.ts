/**
 * Runs a single named scenario (stake-a..d, unstake-a..d, claim-a..d) against a fresh LiteSVM
 * instance and prints its result as JSON on stdout. Invoked as a standalone subprocess (see
 * runScenario in setup.ts, used by tests/stake.test.ts, tests/unstake.test.ts, and
 * tests/claim.test.ts) rather than in-process: the native litesvm addon leaks/corrupts state
 * across repeated BPF program invocations within one Node process, eventually aborting with
 * std::bad_alloc. Keeping each scenario's invocations confined to their own short-lived
 * process, AND keeping the invocation count within each process as low as possible, both
 * reduce how often that happens.
 *
 * To that end, scenarios seed the Pool and StakeAccount directly via
 * seedPoolAccount/seedStakeAccount rather than calling initializePool/stake for setup —
 * those instructions aren't under test in stake.test.ts/unstake.test.ts/claim.test.ts, so only
 * the instruction actually being tested (stake, unstake, or claim) is invoked as a real
 * transaction.
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
  createAtaAndMint,
  createMint,
  pdas,
  seedPoolAccount,
  seedStakeAccount,
  startSvm,
  warpBySeconds,
} from "./setup";

const REWARD_RATE = 7;

async function seedPool(ctx: SvmContext, totalStaked: number, rewardRate: number = REWARD_RATE) {
  const admin = Keypair.generate();
  const stakeMint = await createMint(ctx);
  const [pool, poolBump] = pdas.poolPda(ctx.program.programId, stakeMint);
  // reward_mint's mint authority must be the pool PDA so claim's mint_to CPI (signed by the
  // pool) is authorized. The PDA address is deterministic from stake_mint, so it's known here
  // even though the Pool account itself is only seeded (not really initialized) below.
  const rewardMint = await createMint(ctx, 6, pool);

  seedPoolAccount(ctx, pool, {
    admin: admin.publicKey,
    stakeMint,
    rewardMint,
    rewardRate,
    totalStaked,
    bump: poolBump,
  });

  const vault = await createAtaAndMint(ctx, stakeMint, pool, totalStaked);

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
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 1_000);
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
  const { stakeMint, pool, vault } = await seedPool(ctx, 0);

  const user = Keypair.generate();
  airdrop(ctx.svm, user.publicKey);
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 1_500);
  const stakeAccount = await stakeAs(ctx, pool, vault, user, userAta, 1_000);

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
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 1_000);

  await stakeAs(ctx, pool, vault, user, userAta, 0);

  throw new Error("expected stake(0) to fail, but it succeeded");
}

async function scenarioStakeD() {
  const ctx = startSvm();
  const { stakeMint, pool, vault } = await seedPool(ctx, 0);

  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  airdrop(ctx.svm, user1.publicKey);
  airdrop(ctx.svm, user2.publicKey);

  const user1Ata = await createAtaAndMint(ctx, stakeMint, user1.publicKey, 1_000);
  const user2Ata = await createAtaAndMint(ctx, stakeMint, user2.publicKey, 2_000);

  const stakeAccount1 = await stakeAs(ctx, pool, vault, user1, user1Ata, 300);
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
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 0);
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
  const { stakeMint, pool, vault } = await seedPool(ctx, 600);

  const user = Keypair.generate();
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 0);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 600,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  await unstakeAs(ctx, pool, vault, user, userAta, 600);

  const vaultAfterFull = await getAccount(ctx.provider.connection, vault);
  const stakeAfterFull = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  warpBySeconds(ctx.svm, 30);

  let secondAttemptFailed = false;
  let secondAttemptError: ReturnType<typeof describeError> | undefined;
  try {
    await unstakeAs(ctx, pool, vault, user, userAta, 1);
  } catch (err) {
    secondAttemptFailed = true;
    secondAttemptError = describeError(err);
  }

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
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 0);
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
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 0);
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
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE);

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
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE);

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

  const { userRewardAta } = await claimAs(ctx, pool, rewardMint, user);
  const rewardAfterFirst = await getAccount(ctx.provider.connection, userRewardAta);

  // Immediate second claim, no further warp: nothing new has accrued, so this must mint 0.
  // claim() takes no arguments, so without a fresh blockhash this would be byte-identical to
  // the first call and get rejected as a duplicate transaction rather than actually re-running.
  ctx.svm.expireBlockhash();
  await claimAs(ctx, pool, rewardMint, user);
  const rewardAfterSecond = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAccountData = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    rewardAfterFirst: rewardAfterFirst.amount.toString(),
    rewardAfterSecond: rewardAfterSecond.amount.toString(),
    points: bnToBigInt(stakeAccountData.points).toString(),
  };
}

async function scenarioClaimC() {
  const ctx = startSvm();
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE);

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
  const { pool, rewardMint } = await seedPool(ctx, 0, CLAIM_REWARD_RATE);

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
  const { userRewardAta } = await claimAs(ctx, pool, rewardMint, user);
  const rewardAfterFirst = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAfterFirst = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  // Additional accrual on top of the carried remainder: 1_000 * 1000 * 1_000_000 = 1e12,
  // plus the 5e11 remainder left over from the first claim = 1.5e12 again.
  warpBySeconds(ctx.svm, 1000);
  // claim() takes no arguments; without a fresh blockhash this call would be byte-identical
  // to the first and get rejected as a duplicate transaction instead of actually re-running.
  ctx.svm.expireBlockhash();
  await claimAs(ctx, pool, rewardMint, user);
  const rewardAfterSecond = await getAccount(ctx.provider.connection, userRewardAta);
  const stakeAfterSecond = await ctx.program.account.stakeAccount.fetch(stakeAccount);

  return {
    rewardAfterFirst: rewardAfterFirst.amount.toString(),
    pointsAfterFirst: bnToBigInt(stakeAfterFirst.points).toString(),
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
  const { stakeMint, pool, vault } = await seedPool(ctx, 1_000);

  const user = Keypair.generate();
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 0);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 1_000,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  await unstakeAs(ctx, pool, vault, user, userAta, 600);

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
  const { stakeMint, pool, vault } = await seedPool(ctx, 400);

  const user = Keypair.generate();
  const userAta = await createAtaAndMint(ctx, stakeMint, user.publicKey, 0);
  const [stakeAccount, stakeBump] = pdas.stakePda(ctx.program.programId, pool, user.publicKey);
  seedStakeAccount(ctx, stakeAccount, {
    owner: user.publicKey,
    amount: 400,
    points: 0,
    lastUpdateTs: 0,
    bump: stakeBump,
  });

  // Drain to exactly zero (this is the boundary case: nothing left, not just "less than asked").
  await unstakeAs(ctx, pool, vault, user, userAta, 400);

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
  const victimAta = await createAtaAndMint(ctx, stakeMint, victim.publicKey, 0);
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
