import { expect } from "chai";
import { runScenario } from "./helpers/setup";

const REWARD_RATE = 7;

/**
 * Each scenario below runs in its own subprocess (see runScenario / tests/helpers/runner.ts).
 * This mocha process never touches LiteSVM directly, since accumulating BPF program
 * invocations within one process eventually crashes the native litesvm addon.
 */
describe("unstake", () => {
  it("(a) accrues points before reducing balance, then unstakes a partial amount", () => {
    const res = runScenario<{ vaultAmount: string; amount: number; points: string }>("unstake-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.vaultAmount).to.equal("600");
    expect(r.amount).to.equal(600);
    // accrual used the pre-unstake amount (1_000) over the 50s that elapsed before the
    // withdrawal, proving accrue-before-mutation ordering.
    const expectedPoints = BigInt(1_000) * BigInt(50) * BigInt(REWARD_RATE);
    expect(BigInt(r.points)).to.equal(expectedPoints);
  });

  it("(b) unstaking the full remaining balance zeroes it out, and a later unstake fails with InsufficientStake", () => {
    const res = runScenario<{
      vaultAfterFull: string;
      amountAfterFull: number;
      secondAttemptFailed: boolean;
      secondAttemptError?: { message: string; logs: string[]; anchorCode?: string };
    }>("unstake-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.vaultAfterFull).to.equal("0");
    expect(r.amountAfterFull).to.equal(0);

    expect(r.secondAttemptFailed, "expected a later unstake(1) to fail").to.equal(true);
    const haystack = [r.secondAttemptError?.message, r.secondAttemptError?.anchorCode, ...(r.secondAttemptError?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected error to mention InsufficientStake, got:\n${haystack}`).to.include(
      "InsufficientStake",
    );
  });

  it("(c) unstaking zero amount fails with ZeroAmount", () => {
    const res = runScenario("unstake-c");

    expect(res.ok, "expected scenario (c) to fail, but it succeeded").to.equal(false);
    const haystack = [res.error?.message, res.error?.anchorCode, ...(res.error?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected error to mention ZeroAmount, got:\n${haystack}`).to.include("ZeroAmount");
  });

  it("(d) unstaking more than the staked amount fails with InsufficientStake and leaves balances unchanged", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      vaultBefore: string;
      vaultAfter: string;
      amountBefore: number;
      amountAfter: number;
      totalStakedBefore: number;
      totalStakedAfter: number;
    }>("unstake-d");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected unstake(amount + 1) to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected error to mention InsufficientStake, got:\n${haystack}`).to.include(
      "InsufficientStake",
    );

    // balances must be unchanged by the failed attempt
    expect(r.vaultAfter).to.equal(r.vaultBefore);
    expect(r.amountAfter).to.equal(r.amountBefore);
    expect(r.totalStakedAfter).to.equal(r.totalStakedBefore);
  });
});
