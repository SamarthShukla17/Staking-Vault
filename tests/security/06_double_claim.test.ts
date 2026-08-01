import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Security suite: 06_double_claim. claim() accrues points from last_update_ts, mints
 * floor(points/SCALE) reward tokens, and keeps the remainder (points %= SCALE). This suite
 * checks that: a second claim over zero elapsed time mints nothing; a claim against a
 * StakeAccount PDA that was never initialized is rejected outright; a full unstake down to a
 * zero balance still lets a genuine pre-existing remainder be claimed exactly once; and
 * splitting one claim into many can never mint more than a single claim over the same elapsed
 * time (the floor always favors the protocol, never the user).
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 06 double claim", () => {
  it("(a) stake, warp 100s, claim mints floor(points/SCALE) and keeps the remainder (not zeroed)", () => {
    const res = runScenario<{
      reward: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-double-claim-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.reward).to.equal("1");
    expect(r.points).to.equal("500000000000");
    expect(r.points).to.not.equal("0");

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(b) an immediate second claim with zero elapsed time mints 0 and leaves points unchanged", () => {
    const res = runScenario<{
      rewardAfterFirst: string;
      rewardAfterSecond: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-double-claim-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    // No free tokens: the second claim's reward ATA balance is unchanged from the first.
    expect(r.rewardAfterSecond).to.equal(r.rewardAfterFirst);
    expect(r.points).to.equal("500000000000");

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(c) claim against a never-initialized StakeAccount fails, mints nothing, supply unchanged", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      rewardSupply: string;
      vaultAmount: string;
      totalStaked: number;
    }>("security-double-claim-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected claim() with no stake account to fail").to.equal(true);
    expect(r.errorInfo?.anchorCode).to.equal("AccountNotInitialized");

    expect(r.rewardSupply).to.equal("0");
    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(0);
  });

  it("(d) claiming after a full unstake to zero still pays out the pre-existing remainder exactly once", () => {
    const res = runScenario<{
      reward: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-double-claim-d");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    // 2.5 * SCALE pre-existing remainder, zero new accrual over a zero balance: floor(2.5) = 2.
    expect(r.reward).to.equal("2");
    expect(r.points).to.equal("500000000000");

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
    expect(r.totalStaked).to.equal(0);
  });

  it("(e) N small claims over the same total elapsed time never mint more than one large claim", () => {
    const small = runScenario<{
      totalReward: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-double-claim-e-small");
    const large = runScenario<{
      totalReward: string;
      points: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-double-claim-e-large");

    expect(small.ok, `small scenario failed: ${JSON.stringify(small.error)}`).to.equal(true);
    expect(large.ok, `large scenario failed: ${JSON.stringify(large.error)}`).to.equal(true);
    const rs = small.result!;
    const rl = large.result!;

    expect(BigInt(rs.totalReward) <= BigInt(rl.totalReward), "sum of small claims must not exceed a single claim")
      .to.equal(true);
    // With the remainder correctly carried across claims, splitting doesn't lose or gain
    // anything: both paths mint exactly the same total over the same elapsed time.
    expect(rs.totalReward).to.equal(rl.totalReward);
    expect(rs.points).to.equal(rl.points);

    for (const r of [rs, rl]) {
      expect(r.vaultAmount).to.equal(String(r.totalStaked));
      expect(r.totalStaked).to.equal(r.stakeAmount);
    }
  });
});
