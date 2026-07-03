import { expect } from "chai";
import { runScenario } from "./helpers/setup";

/**
 * Each scenario below runs in its own subprocess (see runScenario / tests/helpers/runner.ts).
 * This mocha process never touches LiteSVM directly, since accumulating BPF program
 * invocations within one process eventually crashes the native litesvm addon.
 */
describe("claim", () => {
  it("(a) mints the floor of points/SCALE and keeps the exact remainder", () => {
    const res = runScenario<{ reward: string; points: string }>("claim-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.reward).to.equal("1");
    expect(r.points).to.equal("500000000000");
  });

  it("(b) an immediate second claim mints nothing (double-claim safe)", () => {
    const res = runScenario<{ rewardAfterFirst: string; rewardAfterSecond: string; points: string }>("claim-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.rewardAfterFirst).to.equal("1");
    // reward ATA balance is unchanged by the second claim: no new tokens minted.
    expect(r.rewardAfterSecond).to.equal(r.rewardAfterFirst);
    expect(r.points).to.equal("500000000000");
  });

  it("(c) claiming with zero stake and zero points mints nothing", () => {
    const res = runScenario<{ reward: string }>("claim-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    expect(res.result!.reward).to.equal("0");
  });

  it("(d) the carried remainder combines with newly accrued points on the next claim, with no dust lost", () => {
    const res = runScenario<{
      rewardAfterFirst: string;
      pointsAfterFirst: string;
      rewardAfterSecond: string;
      pointsAfterSecond: string;
    }>("claim-d");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.rewardAfterFirst).to.equal("1");
    expect(r.pointsAfterFirst).to.equal("500000000000");

    // new mint for the second claim == floor((remainder + newly_accrued) / SCALE) == 1
    const newMint = BigInt(r.rewardAfterSecond) - BigInt(r.rewardAfterFirst);
    expect(newMint).to.equal(1n);
    expect(r.rewardAfterSecond).to.equal("2");
    expect(r.pointsAfterSecond).to.equal("500000000000");
  });
});
