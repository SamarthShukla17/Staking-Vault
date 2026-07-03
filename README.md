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

Chapter 1 in progress.
