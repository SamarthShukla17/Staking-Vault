import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Threat 2: drain another user's stake.
 *
 * StakeAccount PDAs are derived from [STAKE_SEED, pool, owner]. Since unstake/claim re-derive
 * that address from the SIGNER's own key, a signer can never make the seeds constraint resolve
 * to someone else's position — swapping in another user's stake_account address must fail
 * before the handler body (and its owner check) ever runs, regardless of which account is used
 * as the destination for the stolen funds.
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 02 drain other user", () => {
  it("(a) attacker swapping in the victim's stake_account (and their own ATA as destination) fails, victim untouched", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      victimAmount: number;
      attackerAmount: number;
      vaultAmount: string;
      totalStaked: number;
    }>("security-drain-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the cross-account unstake to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    // Seeds re-derivation from the attacker's own key can never match the victim's PDA, so this
    // is rejected as a seeds/owner constraint violation before any transfer happens.
    expect(haystack, `expected a seeds/owner constraint error, got:\n${haystack}`).to.match(
      /ConstraintSeeds|ConstraintHasOne|AccountNotInitialized/,
    );

    expect(r.victimAmount).to.equal(5_000);
    expect(r.attackerAmount).to.equal(100);

    // invariant: vault == pool.total_staked == sum(stake.amounts)
    const sumOfStakes = r.victimAmount + r.attackerAmount;
    expect(r.vaultAmount).to.equal("5100");
    expect(r.totalStaked).to.equal(5_100);
    expect(sumOfStakes).to.equal(5_100);
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(sumOfStakes);
  });

  it("(b) attacker attempting to drain the victim's entire balance in one shot fails, exact balance preserved", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      victimAmount: number;
      attackerAmount: number;
      vaultAmount: string;
      totalStaked: number;
    }>("security-drain-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the full-balance drain attempt to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected a seeds/owner constraint error, got:\n${haystack}`).to.match(
      /ConstraintSeeds|ConstraintHasOne|AccountNotInitialized/,
    );

    // exact victim balance, unchanged
    expect(r.victimAmount).to.equal(5_000);
    expect(r.attackerAmount).to.equal(100);

    // invariant: vault == pool.total_staked == sum(stake.amounts)
    const sumOfStakes = r.victimAmount + r.attackerAmount;
    expect(r.vaultAmount).to.equal("5100");
    expect(r.totalStaked).to.equal(5_100);
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(sumOfStakes);
  });

  it("(c) attacker calling claim against the victim's stake_account fails, victim's accrued points untouched", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      victimPoints: string;
      victimAmount: number;
      attackerAmount: number;
      vaultAmount: string;
      totalStaked: number;
    }>("security-drain-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the cross-account claim to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected a seeds/owner constraint error, got:\n${haystack}`).to.match(
      /ConstraintSeeds|ConstraintHasOne|AccountNotInitialized/,
    );

    // victim's accrued points are exactly as seeded — the failed claim never touched them
    expect(r.victimPoints).to.equal("2500000000000");

    // invariant: vault == pool.total_staked == sum(stake.amounts) — the failed claim doesn't
    // move any staked tokens, but this confirms it didn't perturb them either.
    const sumOfStakes = r.victimAmount + r.attackerAmount;
    expect(r.vaultAmount).to.equal("5100");
    expect(r.totalStaked).to.equal(5_100);
    expect(sumOfStakes).to.equal(5_100);
    expect(Number(r.vaultAmount)).to.equal(r.totalStaked);
    expect(r.totalStaked).to.equal(sumOfStakes);
  });
});
