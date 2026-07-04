import { expect } from "chai";
import { runScenario } from "../helpers/setup";

/**
 * Threat 3: substitute a fake vault to impersonate the real one.
 *
 * The real vault is ATA(pool, stake_mint), but nothing about unstake trusts that address by
 * convention — it's enforced purely by the account constraints `token::mint = pool.stake_mint`
 * and `token::authority = pool`. Each case below swaps in a token account that satisfies one of
 * those constraints but not the other, and must be rejected before any transfer happens.
 *
 * Each scenario runs in its own subprocess (see runScenario / tests/helpers/runner.ts); this
 * mocha process never touches LiteSVM directly (see runner.ts's doc comment for why).
 */
describe("security: 03 fake vault", () => {
  it("(a) attacker's own token account (correct mint, wrong authority) rejected as vault", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      realVaultAmount: string;
      attackerVaultAmount: string;
      stakeAmount: number;
      totalStaked: number;
    }>("security-fake-vault-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the fake-vault unstake to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    // Mint matches (it's a real stake_mint account) but authority is the attacker, not the pool.
    expect(haystack, `expected ConstraintTokenOwner, got:\n${haystack}`).to.include("ConstraintTokenOwner");

    // The attacker's pre-funded 1_000 sits untouched — no transfer ever happened.
    expect(r.attackerVaultAmount).to.equal("1000");

    // Real vault and books unaffected: 1_000 staked, nothing withdrawn.
    expect(r.realVaultAmount).to.equal("1000");
    expect(r.stakeAmount).to.equal(1_000);
    expect(r.totalStaked).to.equal(1_000);
    expect(Number(r.realVaultAmount)).to.equal(r.totalStaked);
  });

  it("(b) pool-owned ATA of a different mint (correct authority, wrong mint) rejected as vault", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      realVaultAmount: string;
      wrongMintVaultAmount: string;
      stakeAmount: number;
      totalStaked: number;
    }>("security-fake-vault-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the wrong-mint vault unstake to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    // Authority matches (it really is owned by the pool PDA) but the mint isn't pool.stake_mint.
    expect(haystack, `expected ConstraintTokenMint, got:\n${haystack}`).to.include("ConstraintTokenMint");

    // The decoy account's balance is untouched — no transfer ever happened.
    expect(r.wrongMintVaultAmount).to.equal("1000");

    // Real vault and books unaffected: 1_000 staked, nothing withdrawn.
    expect(r.realVaultAmount).to.equal("1000");
    expect(r.stakeAmount).to.equal(1_000);
    expect(r.totalStaked).to.equal(1_000);
    expect(Number(r.realVaultAmount)).to.equal(r.totalStaked);
  });

  it("(c) the user's own ATA (correct mint, wrong authority) rejected as vault", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      realVaultAmount: string;
      userAtaAmount: string;
      stakeAmount: number;
      totalStaked: number;
    }>("security-fake-vault-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected passing the user's own ATA as vault to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, r.errorInfo?.anchorCode, ...(r.errorInfo?.logs ?? [])]
      .filter(Boolean)
      .join("\n");
    // The user's own ATA is already wired in as user_stake_ata, so reusing it as vault trips
    // Anchor's duplicate-mutable-account guard before the authority mismatch (mint matches,
    // authority is the user, not the pool) is even reached — still a hard rejection either way.
    expect(haystack, `expected ConstraintDuplicateMutableAccount, got:\n${haystack}`).to.include(
      "ConstraintDuplicateMutableAccount",
    );

    // The user's own ATA started and stayed at zero — no transfer ever happened.
    expect(r.userAtaAmount).to.equal("0");

    // Real vault and books unaffected: 1_000 staked, nothing withdrawn.
    expect(r.realVaultAmount).to.equal("1000");
    expect(r.stakeAmount).to.equal(1_000);
    expect(r.totalStaked).to.equal(1_000);
    expect(Number(r.realVaultAmount)).to.equal(r.totalStaked);
  });
});
