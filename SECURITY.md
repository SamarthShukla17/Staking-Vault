# Staking Vault Security

This document describes the threat model for the `staking_vault` Anchor program: what an adversary can attempt against `initialize_pool`, `stake`, `unstake`, and `claim`, and where in the codebase each attack is defended against and regression-tested. It is scoped to the on-chain program's own account and arithmetic safety — not to the economics of any specific deployment.

The invariant this program is built to hold at every instruction boundary is:

```
vault.amount == pool.total_staked == Σ stake.amount
```

## Threat table

| # | Attack | Defense | Test file |
|---|--------|---------|-----------|
| 01 | Withdraw more than the caller's own recorded stake, or drain a vault that happens to be well-funded by other users' positions. | `stake_account.amount` is the sole source of truth for how much a position can withdraw, checked via `require!` before any transfer — never inferred from the vault's pooled token balance. | [tests/security/01_unstake_exceeds_stake.test.ts](tests/security/01_unstake_exceeds_stake.test.ts) |
| 02 | Attacker signs for themselves but substitutes the victim's `stake_account` (and their own ATA as the withdrawal/claim destination) to drain the victim's funds or points. | The `stake_account` PDA is seeded from `[STAKE_SEED, pool, user.key()]`; Anchor's seeds re-derivation forces the supplied address to match the actual signer, so a substituted victim account fails before the handler body ever runs. | [tests/security/02_drain_other_user.test.ts](tests/security/02_drain_other_user.test.ts) |
| 03 | Substitute a token account that satisfies some but not all of `vault`'s real constraints (wrong authority, wrong mint) to redirect an unstake. | `vault` is constrained by `token::mint = pool.stake_mint, token::authority = pool` — both checked independently of naming or convention. | [tests/security/03_fake_vault.test.ts](tests/security/03_fake_vault.test.ts) |
| 04 | Substitute an attacker-controlled (or even a pool-PDA-authored but wrong) mint as `reward_mint` to redirect a claim's minted rewards. | `reward_mint` is pinned by an `address = pool.reward_mint` constraint — an identity check on the specific mint, not a trust-the-authority check. | [tests/security/04_wrong_reward_mint.test.ts](tests/security/04_wrong_reward_mint.test.ts) |
| 05 | Re-initialize an already-initialized pool — as an attacker to hijack it, or idempotently as the original admin — to reset or rewrite its state. | `pool` uses Anchor's `init` (never `init_if_needed`); a second init against the same PDA is rejected by the System Program at the runtime level before `handle_initialize_pool` ever executes. | [tests/security/05_reinit_pool.test.ts](tests/security/05_reinit_pool.test.ts) |
| 06 | Claim twice for the same accrued points, or claim against an uninitialized or zero-balance position, to mint free or duplicate rewards. | `accrue()` advances `last_update_ts` and every claim floors `points` via `points %= SCALE` (never zeroed, never reset); a `stake_account` that was never created fails Anchor's `AccountNotInitialized` check outright. | [tests/security/06_double_claim.test.ts](tests/security/06_double_claim.test.ts) |
| 07 | Push `reward_rate`, staked `amount`, or elapsed time to extremes to overflow or silently wrap the accrual or balance arithmetic. | All accrual math runs in u128 via `checked_mul`/`checked_add` (state.rs); `pool.total_staked` and `stake_account.amount` use `checked_add`/`checked_sub`; `overflow-checks = true` on `[profile.release]` backstops anything not already checked. | [tests/security/07_overflow.test.ts](tests/security/07_overflow.test.ts) |
| 08 | Submit an instruction with someone else's pubkey in a signer-required slot (or a data-corrupted `owner` field) without ever holding their real private key. | `user`/`admin` are typed `Signer<'info>`, enforced by both the Anchor client (refuses to build the transaction) and the Solana runtime's signature verification; `unstake`/`claim` additionally check `stake_account.owner == user.key()`, independent of the PDA seeds derivation. | [tests/security/08_signer.test.ts](tests/security/08_signer.test.ts) |
| 09 | Split one claim into many small claims, hoping floor-rounding works out in the claimer's favor and pays more than a single claim would. | `points %= SCALE` carries the exact sub-SCALE remainder forward on every claim; `floor(a) + floor(b) <= floor(a+b)` always holds, so splitting never mints more — proven via a property test across 200 randomized cases. | [tests/security/09_rounding.test.ts](tests/security/09_rounding.test.ts) |

## Method

Every suite above is written adversarial-test-first: the attack is written and run against the current code *before* any fix is considered. If the attack already fails, the existing guard is documented and the test is kept as a permanent regression — that's the common outcome in this codebase, since most of these properties (checked arithmetic, PDA seeds binding, `Signer` typing, the owner constraint, the remainder-carry design) were already in place. A test is only paired with a code change when the attack actually succeeds against the current code.

Where a scenario needs state that would normally result from a prior real instruction (e.g. "the state after a first claim"), that state is seeded directly into the LiteSVM harness rather than replayed via a second real transaction, unless the specific behavior under test genuinely spans two calls in the same session (in which case both run for real, accepting the extra flakiness that comes with it). Every failed-attack case asserts that the invariant above held throughout — not just that the specific attacker action was rejected.

## Out of scope

- **Mainnet deployment concerns** — RPC availability, priority fees, compute budget tuning, and cluster-specific configuration are not covered here.
- **Economic and oracle attacks** — this program has no price oracle and no economic assumptions beyond the fixed `reward_rate` set at pool initialization; economic design (reward sustainability, emission schedules, external market manipulation) is a product decision outside this threat model.
- **Front-running / MEV** — transaction ordering and validator-level MEV extraction are Solana cluster-level concerns, not properties of this program's account or arithmetic logic.
