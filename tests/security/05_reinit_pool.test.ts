import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Threat 5: initialize a pool that already exists.
 *
 * initialize_pool's `pool` account uses Anchor `init` — never `init_if_needed` — on the PDA
 * [POOL_SEED, stake_mint]. A second init attempt against that same address must be rejected at
 * the runtime level (the System Program refuses to allocate an already-in-use account) before
 * handle_initialize_pool ever runs, regardless of who signs or what parameters they pass.
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 05 reinit pool", () => {
  it("(a) an attacker re-initializing an existing pool as themselves fails; every Pool field is unchanged", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      admin: string;
      originalAdmin: string;
      attacker: string;
      stakeMint: string;
      expectedStakeMint: string;
      rewardMint: string;
      expectedRewardMint: string;
      attackerRewardMint: string;
      rewardRate: number;
      originalRate: number;
      totalStaked: number;
    }>("security-reinit-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the attacker's re-init to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    // Anchor's `init` delegates account creation to the System Program, which rejects an
    // already-funded/owned address with its own runtime error — not a custom Anchor error code.
    expect(haystack, `expected an "already in use" runtime error, got:\n${haystack}`).to.match(
      /already in use/i,
    );

    // The attacker's identity never made it into the account at all: not merely "reverted back"
    // to the original, but never touched in the first place (single atomic instruction).
    expect(r.attacker).to.not.equal(r.originalAdmin);
    expect(r.attackerRewardMint).to.not.equal(r.expectedRewardMint);

    // Every single Pool field, explicitly, is exactly as it was before the attack.
    expect(r.admin).to.equal(r.originalAdmin);
    expect(r.stakeMint).to.equal(r.expectedStakeMint);
    expect(r.rewardMint).to.equal(r.expectedRewardMint);
    expect(r.rewardRate).to.equal(r.originalRate);
    expect(r.totalStaked).to.equal(0);
  });

  it("(b) the original admin repeating initialize_pool with identical accounts also fails", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      admin: string;
      originalAdmin: string;
      stakeMint: string;
      expectedStakeMint: string;
      rewardMint: string;
      expectedRewardMint: string;
      rewardRate: number;
      originalRate: number;
      totalStaked: number;
    }>("security-reinit-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the idempotent re-init to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    expect(haystack, `expected an "already in use" runtime error, got:\n${haystack}`).to.match(
      /already in use/i,
    );

    // Identical accounts and rate doesn't make a second init anything other than a re-init.
    expect(r.admin).to.equal(r.originalAdmin);
    expect(r.stakeMint).to.equal(r.expectedStakeMint);
    expect(r.rewardMint).to.equal(r.expectedRewardMint);
    expect(r.rewardRate).to.equal(r.originalRate);
    expect(r.totalStaked).to.equal(0);
  });

  it("(c) a user who staked before the attack can still unstake normally after it, state untouched end-to-end", () => {
    const res = runScenario<{
      reinitFailed: boolean;
      vaultAmount: string;
      userAtaAmount: string;
      stakeAmount: number;
      totalStaked: number;
    }>("security-reinit-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.reinitFailed, "expected the attacker's re-init attempt to fail").to.equal(true);

    // The pre-existing staker's full 1_000 was withdrawn normally, exactly as if the attack had
    // never been attempted at all.
    expect(r.userAtaAmount).to.equal("1000");
    expect(r.vaultAmount).to.equal("0");
    expect(r.stakeAmount).to.equal(0);
    expect(r.totalStaked).to.equal(0);
  });
});
