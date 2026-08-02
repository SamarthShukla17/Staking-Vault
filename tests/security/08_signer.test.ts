import { expect } from "chai";
import { runScenario } from "../helpers/setup";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../../target/idl/staking_vault.json");

/**
 * Security suite: 08_signer. stake/unstake/claim's `user` and initialize_pool's `admin` are all
 * typed `Signer<'info>`, which the Anchor TS client enforces client-side (it refuses to even
 * build a transaction unless it holds a real Keypair for every declared signer) and the Solana
 * runtime enforces again at signature-verification time. `unstake`/`claim` additionally check
 * `stake_account.owner == user.key()`, independent of the PDA seeds derivation. This suite
 * proves both layers actually fire, and that a corrupted `owner` field can't hide behind a
 * correctly-derived PDA address. Cases (f)/(g) go a layer deeper: they build the raw instruction
 * and tamper with its compiled AccountMeta directly, bypassing the Anchor TS client's own
 * "missing signer" guard entirely, to prove the *on-chain program's* `Signer<'info>` check fires
 * independently of the client-side protections cases (a)-(c) rely on.
 *
 * Cases A, B, C, E, F, and G run in their own subprocess (see runScenario / tests/helpers/
 * runner.ts); this mocha process never touches LiteSVM directly for those (see runner.ts's doc
 * comment for why). Case D reads the built IDL directly — no LiteSVM involved at all.
 */
describe("security: 08 signer", () => {
  it("(a) unstake with the victim's real pubkey/stake_account but only the attacker signing fails, victim untouched", () => {
    const res = runScenario<{
      failed: boolean;
      errorMessage: string;
      victimAmount: number;
      vaultAmount: string;
      totalStaked: number;
    }>("security-signer-unstake-a");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected unstake() to fail without the victim's real signature").to.equal(true);
    expect(r.errorMessage).to.match(/unknown signer/i);

    expect(r.victimAmount).to.equal(1_000);
    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.victimAmount);
  });

  it("(b) claim with the victim's real pubkey/stake_account but only the attacker signing fails, nothing minted to anyone", () => {
    const res = runScenario<{
      failed: boolean;
      errorMessage: string;
      victimPoints: string;
      rewardSupply: string;
      vaultAmount: string;
      totalStaked: number;
      stakeAmount: number;
    }>("security-signer-claim-b");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected claim() to fail without the victim's real signature").to.equal(true);
    expect(r.errorMessage).to.match(/unknown signer/i);

    // Rejected before the transaction was ever sent: accrue() never ran, nothing was minted to
    // the attacker (or anyone).
    expect(r.victimPoints).to.equal("0");
    expect(r.rewardSupply).to.equal("0");

    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(c) initialize_pool without the admin actually signing fails, no pool is created", () => {
    const res = runScenario<{
      failed: boolean;
      errorMessage: string;
      poolExists: boolean;
    }>("security-signer-init-c");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected initialize_pool() to fail without the admin's signature").to.equal(true);
    expect(r.errorMessage).to.match(/signature verification failed|missing signature/i);
    expect(r.poolExists, "the pool account must never have been created").to.equal(false);
  });

  it("(d) every instruction's user/admin account is declared Signer (isSigner) in the IDL", () => {
    const expectations: Record<string, string> = {
      initialize_pool: "admin",
      stake: "user",
      unstake: "user",
      claim: "user",
    };

    for (const instr of IDL.instructions) {
      const expectedSignerName = expectations[instr.name];
      if (!expectedSignerName) continue;

      const signerAccount = instr.accounts.find((a: { name: string }) => a.name === expectedSignerName);
      expect(signerAccount, `${instr.name} must declare a "${expectedSignerName}" account`).to.exist;
      expect(
        signerAccount.signer,
        `${instr.name}'s "${expectedSignerName}" account must be a Signer (isSigner: true in the IDL)`,
      ).to.equal(true);
    }
  });

  it("(e) a stake_account whose stored owner differs from the signer is rejected even though the PDA derivation matches", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      storedOwner: string;
      impostorOwner: string;
      realUser: string;
      stakeAmount: number;
      vaultAmount: string;
      totalStaked: number;
    }>("security-signer-owner-mismatch-e");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected unstake() to fail when stake_account.owner != the signer").to.equal(true);
    expect(r.errorInfo?.anchorCode).to.equal("ConstraintRaw");

    // The account's stored owner is still the impostor's, never overwritten by the failed
    // attempt, and nothing about the position moved.
    expect(r.storedOwner).to.equal(r.impostorOwner);
    expect(r.storedOwner).to.not.equal(r.realUser);
    expect(r.stakeAmount).to.equal(1_000);
    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.stakeAmount);
  });

  it("(f) unstake with the user AccountMeta's isSigner tampered to false is rejected by the on-chain Signer check, not just the client", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      victimAmount: number;
      vaultAmount: string;
      totalStaked: number;
    }>("security-signer-raw-meta-unstake-f");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    // Unlike cases (a)/(b), the compiled instruction's meta was mutated so victim's pubkey is no
    // longer flagged as a required signer at all — the Anchor TS client's own "missing signer"
    // guard never fires, and the transaction is sent with only the fee payer's signature. The
    // rejection here can only be coming from the on-chain program's `Signer<'info>` check on
    // `user`, which reads the runtime AccountInfo.is_signer bit the tampered meta controls.
    //
    // This error comes back from a raw sendAndConfirm call rather than program.methods(...).rpc(),
    // so it's never translated into a parsed AnchorError (errorInfo.anchorCode is undefined) —
    // the on-chain error code only shows up in the raw program logs.
    expect(r.failed, "expected the tampered-meta unstake to fail").to.equal(true);
    const haystack = [r.errorInfo?.message, ...(r.errorInfo?.logs ?? [])].filter(Boolean).join("\n");
    expect(haystack, `expected AccountNotSigner, got:\n${haystack}`).to.include("AccountNotSigner");

    expect(r.victimAmount).to.equal(1_000);
    expect(r.vaultAmount).to.equal(String(r.totalStaked));
    expect(r.totalStaked).to.equal(r.victimAmount);
  });

  it("(g) initialize_pool with the admin AccountMeta's isSigner tampered to false is rejected by the on-chain Signer check", () => {
    const res = runScenario<{
      failed: boolean;
      errorInfo?: { message: string; logs: string[]; anchorCode?: string };
      poolExists: boolean;
    }>("security-signer-raw-meta-init-g");

    expect(res.ok, `scenario failed: ${JSON.stringify(res.error)}`).to.equal(true);
    const r = res.result!;

    expect(r.failed, "expected the tampered-meta initialize_pool to fail").to.equal(true);
    // See case (f): a raw sendAndConfirm error isn't translated into a parsed AnchorError, so the
    // code only shows up in the raw program logs, not errorInfo.anchorCode.
    const haystack = [r.errorInfo?.message, ...(r.errorInfo?.logs ?? [])].filter(Boolean).join("\n");
    expect(haystack, `expected AccountNotSigner, got:\n${haystack}`).to.include("AccountNotSigner");
    expect(r.poolExists, "the pool account must never have been created").to.equal(false);
  });
});
