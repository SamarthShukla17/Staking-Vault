import { expect } from "chai";
import { runScenario } from "./helpers/setup";

/**
 * Each scenario below runs in its own subprocess (see runScenario / tests/helpers/runner.ts).
 * This mocha process never touches LiteSVM directly, since accumulating BPF program
 * invocations within one process eventually crashes the native litesvm addon.
 */
describe("stake", () => {
  it("(a) first stake records vault balance, stake amount, zero points, and pool total_staked", () => {
    const res = runScenario<{
      vaultAmount: string;
      stakeAmount: number;
      points: string;
      totalStaked: number;
    }>("stake-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    expect(res.result!.vaultAmount).to.equal("1000");
    expect(res.result!.stakeAmount).to.equal(1_000);
    expect(res.result!.points).to.equal("0");
    expect(res.result!.totalStaked).to.equal(1_000);
  });

  it("(b) accrues points exactly as amount * elapsed * rate before adding more stake", () => {
    const REWARD_RATE = 7;
    const res = runScenario<{ points: string; amount: number }>("stake-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const expectedPoints = BigInt(1_000) * BigInt(100) * BigInt(REWARD_RATE);
    expect(BigInt(res.result!.points)).to.equal(expectedPoints);
    expect(res.result!.amount).to.equal(1_500);
  });

  it("(c) staking zero amount fails with ZeroAmount", () => {
    const res = runScenario("stake-c");

    expect(res.ok, "expected scenario (c) to fail, but it succeeded").to.equal(false);
    const haystack = [res.error?.message, res.error?.anchorCode, ...(res.error?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected error to mention ZeroAmount, got:\n${haystack}`).to.include("ZeroAmount");
  });

  it("(d) two different users staking into the same pool stay independent while the vault tracks the sum", () => {
    const res = runScenario<{
      owner1: string;
      owner2: string;
      amount1: number;
      amount2: number;
      vaultAmount: string;
      totalStaked: number;
      user1: string;
      user2: string;
    }>("stake-d");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.owner1).to.equal(r.user1);
    expect(r.owner2).to.equal(r.user2);
    expect(r.amount1).to.equal(300);
    expect(r.amount2).to.equal(700);

    const sumOfStakes = r.amount1 + r.amount2;

    // explicit invariant: vault balance == pool.total_staked == sum of individual stake amounts
    expect(r.vaultAmount).to.equal("1000");
    expect(r.totalStaked).to.equal(1_000);
    expect(sumOfStakes).to.equal(1_000);
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(sumOfStakes);
  });
});
