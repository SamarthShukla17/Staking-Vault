/** Fixed-point scale for reward_rate and points — mirrors constants.rs's SCALE exactly. */
export const SCALE = 1_000_000_000_000n;

export interface PendingPointsInput {
  /** stake_account.amount, base units. */
  amount: bigint;
  /** stake_account.points, unscaled u128. */
  points: bigint;
  /** stake_account.last_update_ts, unix seconds. */
  lastUpdateTs: bigint;
  /** pool.reward_rate. */
  rewardRate: bigint;
  /** The timestamp to project forward to. */
  nowTs: bigint;
}

/**
 * Mirrors state.rs's `pending()` exactly: already-accrued `points`, plus
 * `amount * elapsed * rewardRate` for the time since `lastUpdateTs`, projected forward to
 * `nowTs` without mutating anything. BigInt has no fixed width, so unlike the on-chain u128
 * this can never silently overflow — it always computes the exact mathematical value.
 */
export function pendingPoints({ amount, points, lastUpdateTs, rewardRate, nowTs }: PendingPointsInput): bigint {
  const elapsed = nowTs - lastUpdateTs;
  if (elapsed < 0n) {
    throw new Error(`nowTs (${nowTs}) must be >= lastUpdateTs (${lastUpdateTs}); clock cannot go backwards`);
  }
  return points + amount * elapsed * rewardRate;
}

/**
 * floor(pendingPoints / SCALE) — mirrors claim.rs's `reward_u128 = points / SCALE` exactly.
 * BigInt division on non-negative operands already floors, matching the on-chain integer
 * division bit for bit.
 */
export function claimableRewards(input: PendingPointsInput): bigint {
  return pendingPoints(input) / SCALE;
}
