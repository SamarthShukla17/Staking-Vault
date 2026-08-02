import { expect } from "chai";
import { runScenario } from "../../../tests/helpers/setup";

/**
 * Full lifecycle against the same LiteSVM harness the program's own test suite uses, driven
 * entirely through StakingVaultClient's public API rather than raw `program.methods` calls. The
 * actual scenario (scenarioSdkFullLifecycle) lives in tests/helpers/runner.ts and runs in its own
 * subprocess via runScenario — the native litesvm addon crashes intermittently during cleanup at
 * process exit, and a short-lived subprocess that force-exits right after printing its JSON
 * result (see runner.ts's own doc comment) sidesteps that entirely, matching how the rest of the
 * program's LiteSVM-backed suites are structured. This mocha process never touches LiteSVM
 * directly.
 */
describe("StakingVaultClient (SDK) — full lifecycle against LiteSVM", () => {
  it("init -> stake -> warp -> claimable matches on-chain claim result -> unstake", () => {
    const res = runScenario<{
      programIdMatches: boolean;
      poolRewardRateAfterInit: string;
      poolTotalStakedAfterInit: string;
      stakeAmountAfterStake: string;
      stakePointsAfterStake: string;
      expectedPointsAtClaim: string;
      expectedPointsAtClaimRemainder: string;
      expectedClaimable: string;
      projectedClaimable: string;
      actualRewardMinted: string;
      stakePointsAfterClaim: string;
      stakeLastUpdateTsAfterClaim: string;
      expectedPointsAtUnstake: string;
      stakePointsAfterUnstake: string;
      stakeAmountAfterUnstake: string;
      stakeLastUpdateTsAfterUnstake: string;
      poolTotalStakedAfterUnstake: string;
      expectedAmountAfterUnstake: string;
    }>("sdk-full-lifecycle");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.programIdMatches, "client.programId must match the program actually loaded").to.equal(true);

    // init
    expect(r.poolRewardRateAfterInit).to.equal("1000000000");
    expect(r.poolTotalStakedAfterInit).to.equal("0");

    // stake
    expect(r.stakeAmountAfterStake).to.equal("999");
    expect(r.stakePointsAfterStake).to.equal("0");

    // warp -> claimable matches on-chain claim result
    // Sanity: this scenario is set up to carry a nonzero remainder, not a trivial 0/0 case.
    expect(r.expectedPointsAtClaimRemainder).to.not.equal("0");
    expect(r.projectedClaimable, "client.getClaimable must match math.ts's own claimableRewards").to.equal(
      r.expectedClaimable,
    );
    expect(r.actualRewardMinted, "the real on-chain claim() must mint exactly what math.ts projected").to.equal(
      r.expectedClaimable,
    );
    expect(r.stakePointsAfterClaim).to.equal(r.expectedPointsAtClaimRemainder);

    // unstake ("touch"): math.ts pendingPoints must equal the program's stored points exactly,
    // with zero tolerance — unlike claim(), unstake() doesn't floor/carry a remainder, so the
    // full projected value must match bit for bit.
    expect(r.stakePointsAfterUnstake).to.equal(r.expectedPointsAtUnstake);
    expect(r.stakeAmountAfterUnstake).to.equal(r.expectedAmountAfterUnstake);
    expect(r.poolTotalStakedAfterUnstake).to.equal(r.expectedAmountAfterUnstake);
    expect(r.stakeLastUpdateTsAfterUnstake).to.not.equal(r.stakeLastUpdateTsAfterClaim);
  });
});
