import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Security suite: 07_overflow. accrue() computes points += amount * elapsed_seconds *
 * reward_rate entirely in u128 with checked_* math (state.rs), and pool.total_staked /
 * stake_account.amount updates use checked_add/checked_sub on u64 (stake.rs, unstake.rs). This
 * suite proves arithmetic that would overflow rejects cleanly with MathOverflow rather than
 * wrapping, that the specific checked_add guarding pool.total_staked actually fires and leaves
 * state untouched, and that the u128 intermediate has real headroom past what u64 alone could
 * hold for the same inputs.
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 07 overflow", () => {
  it("(a) an extreme reward_rate over a long elapsed period fails accrual with MathOverflow, not a silent wrap", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      points: string;
      lastUpdateTs: number;
      vaultAmount: string;
      totalStaked: string;
      stakeAmount: string;
    }>("security-overflow-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected claim() to fail on overflowing accrual").to.equal(true);
    expect(r.errorInfo?.anchorCode).to.equal("MathOverflow");

    // accrue()'s checked_mul chain fails before any field is written — points and last_update_ts
    // must be exactly as seeded (0), not partially advanced.
    expect(r.points).to.equal("0");
    expect(r.lastUpdateTs).to.equal(0);

    expect(r.vaultAmount).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(b) staking an amount that would overflow pool.total_staked fails with MathOverflow, total_staked unchanged", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      newStakeAccountExists: boolean;
      vaultAmount: string;
      totalStaked: string;
    }>("security-overflow-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected stake() to fail when it would overflow pool.total_staked").to.equal(true);
    expect(r.errorInfo?.anchorCode).to.equal("MathOverflow");

    // The whole transaction rolled back atomically: no new stake_account was created, and
    // neither the vault's real balance nor pool.total_staked (seeded 500 short of u64::MAX)
    // moved at all.
    expect(r.newStakeAccountExists).to.equal(false);
    expect(r.vaultAmount).to.equal("10000");
    expect(r.totalStaked).to.equal((18_446_744_073_709_551_615n - 500n).toString());
  });

  it("(c) amount * elapsed alone would overflow u64, but the u128 intermediate computes the exact correct points", () => {
    const res = runScenario<{
      reward: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-overflow-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    // 5_000_000_000 * 5_000_000_000 * 1 = 25_000_000_000_000_000_000, which exceeds u64::MAX
    // (~18_446_744_073_709_551_615) but fits easily in u128. floor(2.5e19 / 1e12) = 25_000_000
    // exactly, with a zero remainder.
    expect(r.reward).to.equal("25000000");
    expect(r.points).to.equal("0");

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });
});
