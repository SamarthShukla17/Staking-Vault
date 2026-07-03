# staking-vault

An Anchor-based SPL staking vault program on Solana, with a TypeScript SDK, web app, and supporting services to follow.

## Toolchain

| Tool       | Version                                          |
| ---------- | ------------------------------------------------- |
| rustc      | 1.89.0 (29483883e 2025-08-04)                      |
| cargo      | 1.89.0 (c24e10642 2025-06-23)                      |
| solana-cli | 3.1.10 (src:7bc9c805; feat:1620780344, client:Agave) |
| anchor-cli | 1.1.2                                              |
| node       | v20.17.0                                           |
| yarn       | 1.22.22                                            |

## Monorepo layout

```
staking-vault/
├── programs/
│   └── staking-vault/   # Anchor program (lib name: staking_vault)
├── packages/            # TS SDK and shared packages
├── apps/                # Next.js web app
├── services/            # backend services
├── scripts/             # dev/ops scripts
├── docs/                # documentation
├── tests/               # program integration tests (ts-mocha)
├── Anchor.toml
├── Cargo.toml
└── package.json
```

## Development

```bash
yarn install
anchor build
anchor test
```

## Status

# Chapter 1 - in progress.

 - Phase 1.1 Program core : Complete
 
     - 1.1 — Pool + StakeAccount structs
           (Goal: all on-chain state, errors, events, constants compile — data layer only.)
       
     - 1.2 — initialize_pool + LiteSVM test harness
           (Goal: pool creation works end-to-end and the TS test harness every later test reuses exists.)

     - 1.3 — stake with points accrual
           (Goal: tokens move user → vault, position opens or grows, accrual runs before every balance change.)

     - 1.4 — unstake with balance check
           (Goal: withdrawals via pool-signed CPI, impossible to withdraw more than staked.)

     - 1.5 — claim with reward minting
           (Goal: points convert to minted rewards, floor division, remainder retained.)


 - Phase 1.2 Security suite - in progress

     - 1.6 — Threat 1: unstake more than staked
     - 1.7 — Threat 2: drain another user's stake
     - 1.8 — Threat 3: fake vault substitution
     - 1.9 — Threat 4: wrong reward mint
     - 1.10 — Threat 5: pool re-initialization
     - 1.11 — Threat 6: double claim / claim without stake
     - 1.12 — Threat 7: arithmetic overflow
     - 1.13 — Threat 8: missing or wrong signer
     - 1.14 — Threat 9: rounding theft + SECURITY.md final
   
