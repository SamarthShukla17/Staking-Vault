import { expect } from "chai";
import { runScenario } from "./helpers/setup";

/**
 * Each scenario below runs in its own subprocess (see runScenario / tests/helpers/runner.ts).
 * This mocha process never touches LiteSVM directly, since accumulating BPF program
 * invocations within one process eventually crashes the native litesvm addon.
 */
describe("initialize_pool", () => {
  it("(a) writes every Pool field, creates an empty vault, and moves the reward mint's authority to the pool PDA", () => {
    const res = runScenario<{
      pool: string;
      admin: string;
      expectedAdmin: string;
      stakeMint: string;
      expectedStakeMint: string;
      rewardMint: string;
      expectedRewardMint: string;
      rewardRate: number;
      totalStaked: number;
      bump: number;
      expectedBump: number;
      vaultAmount: string;
      vaultMint: string;
      vaultOwner: string;
      rewardMintAuthority: string | null;
      expectedRewardMintAuthority: string;
    }>("initialize-pool-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.admin).to.equal(r.expectedAdmin);
    expect(r.stakeMint).to.equal(r.expectedStakeMint);
    expect(r.rewardMint).to.equal(r.expectedRewardMint);
    expect(r.rewardRate).to.equal(7);
    expect(r.totalStaked).to.equal(0);
    expect(r.bump).to.equal(r.expectedBump);

    expect(r.vaultAmount).to.equal("0");
    expect(r.vaultMint).to.equal(r.stakeMint);
    expect(r.vaultOwner).to.equal(r.pool);

    // The reward mint's authority is no longer the admin — it now belongs to the pool PDA,
    // exactly what claim()'s mint_to CPI (signed by the pool) needs later.
    expect(r.rewardMintAuthority).to.equal(r.expectedRewardMintAuthority);
    expect(r.rewardMintAuthority).to.not.equal(r.admin);
  });

  it("(b) a reward mint whose authority is not the signing admin fails with InvalidMintAuthority", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      poolExists: boolean;
      rewardMintAuthorityUnchanged: boolean;
    }>("initialize-pool-wrong-mint-authority-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected initialize_pool() to fail with a reward mint the admin doesn't own").to.equal(true);
    expect(r.errorInfo?.anchorCode).to.equal("InvalidMintAuthority");
    expect(r.poolExists, "the pool account must never have been created").to.equal(false);
    expect(r.rewardMintAuthorityUnchanged, "the reward mint's authority must never have moved").to.equal(true);
  });

  it("(c) a zero reward_rate fails with ZeroAmount", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      poolExists: boolean;
      rewardMintAuthorityUnchanged: boolean;
    }>("initialize-pool-zero-rate-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected initialize_pool() to fail with reward_rate = 0").to.equal(true);
    expect(r.errorInfo?.anchorCode).to.equal("ZeroAmount");
    expect(r.poolExists, "the pool account must never have been created").to.equal(false);
    expect(r.rewardMintAuthorityUnchanged, "the reward mint's authority must never have moved").to.equal(true);
  });
});
