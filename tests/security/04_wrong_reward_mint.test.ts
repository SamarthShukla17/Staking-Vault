import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Threat 4: claim mints from a substituted reward_mint.
 *
 * claim pins `reward_mint` to `pool.reward_mint` via an `address` constraint — a pure identity
 * check on the account's pubkey. Neither a fake mint's authority nor its legitimacy matters:
 * even a mint the pool PDA can genuinely mint from is rejected if it isn't THE reward_mint.
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 04 wrong reward mint", () => {
  it("(a) attacker's own mint (attacker-controlled authority) rejected as reward_mint", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      realRewardMint: string;
      fakeMint: string;
      points: string;
    }>("security-wrong-reward-mint-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the fake-mint claim to fail").to.equal(true);
    expect(r.fakeMint).to.not.equal(r.realRewardMint);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected ConstraintAddress, got:\n${haystack}`).to.include("ConstraintAddress");

    // The address constraint is checked during account validation, before handle_claim's body
    // (and its accrue() call) ever runs — so points are exactly as seeded, not accrued for the
    // 1500s warp. The failed claim touched nothing at all.
    expect(r.points).to.equal("0");
  });

  it("(b) a mint the pool PDA genuinely controls, but isn't pool.reward_mint, still rejected", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      realRewardMint: string;
      decoyMint: string;
      points: string;
    }>("security-wrong-reward-mint-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the decoy-mint claim to fail").to.equal(true);
    expect(r.decoyMint).to.not.equal(r.realRewardMint);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    // Proves the check is identity (== pool.reward_mint), not "can the pool PDA mint this" —
    // the decoy mint's authority really is the pool, and it's still rejected.
    expect(haystack, `expected ConstraintAddress, got:\n${haystack}`).to.include("ConstraintAddress");

    // Same as case (a): rejected during account validation, before accrue() ever runs.
    expect(r.points).to.equal("0");
  });

  it("(c) the legitimate claim with the real reward_mint still succeeds after impostor attempts", () => {
    const res = runScenario<{
      fakeAttemptFailed: boolean;
      reward: string;
      points: string;
    }>("security-wrong-reward-mint-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.fakeAttemptFailed, "expected the fake-mint attempt before it to have failed").to.equal(true);

    // points = 1_000 * 1500 * 1_000_000 = 1_500_000_000_000 = 1 * SCALE + 500_000_000_000
    expect(r.reward).to.equal("1");
    expect(r.points).to.equal("500000000000");
  });
});
