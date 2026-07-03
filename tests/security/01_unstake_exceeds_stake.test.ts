import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Threat 1: unstake more than staked.
 *
 * The vault is a single pooled SPL token account shared by every position in a pool. The only
 * thing that may ever authorize a withdrawal is the caller's OWN stake_account.amount — never
 * the vault's raw balance (which reflects everyone's stake combined). Each case below attempts
 * an overdraw and asserts both that it's rejected with InsufficientStake AND that the
 * vault == pool.total_staked == sum(stake.amounts) invariant survives the failed attempt
 * untouched.
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 01 unstake exceeds stake", () => {
  it("(a) unstaking more than the remaining balance fails and leaves all balances untouched", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      vaultAmount: string;
      stakeAmount: number;
      totalStaked: number;
    }>("security-overdraw-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the 401 overdraw to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected InsufficientStake, got:\n${haystack}`).to.include("InsufficientStake");

    // 1_000 staked, 600 withdrawn successfully, the failed 401 attempt changes nothing.
    expect(r.vaultAmount).to.equal("400");
    expect(r.stakeAmount).to.equal(400);
    expect(r.totalStaked).to.equal(400);

    // invariant: vault == pool.total_staked == sum(stake.amounts) (single position here)
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(b) draining to exactly zero then attempting any further withdrawal fails", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      vaultAmount: string;
      stakeAmount: number;
      totalStaked: number;
    }>("security-overdraw-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the 1-unit overdraw against a zero balance to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected InsufficientStake, got:\n${haystack}`).to.include("InsufficientStake");

    expect(r.vaultAmount).to.equal("0");
    expect(r.stakeAmount).to.equal(0);
    expect(r.totalStaked).to.equal(0);

    // invariant: vault == pool.total_staked == sum(stake.amounts)
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(c) a fully-funded vault (from a separate position) still can't be overdrawn by another position", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      vaultAmount: string;
      totalStaked: number;
      victimAmount: number;
      attackerAmount: number;
    }>("security-overdraw-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the victim's overdraw to fail despite the vault holding plenty").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected InsufficientStake, got:\n${haystack}`).to.include("InsufficientStake");

    // The vault physically holds far more than the victim's own 400 (the attacker's 10_000 is
    // still sitting there) — proving the check is per-position, not "does the vault have enough".
    expect(r.victimAmount).to.equal(400);
    expect(r.attackerAmount).to.equal(10_000);
    expect(Number(r.vaultAmount)).to.be.greaterThan(r.victimAmount);

    // invariant: vault == pool.total_staked == sum(stake.amounts), unaffected by the failed attempt
    const sumOfStakes = r.victimAmount + r.attackerAmount;
    expect(r.vaultAmount).to.equal("10400");
    expect(r.totalStaked).to.equal(10_400);
    expect(sumOfStakes).to.equal(10_400);
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(sumOfStakes);
  });
});
