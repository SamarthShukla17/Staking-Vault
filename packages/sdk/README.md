# @staking-vault/sdk

Typed TypeScript SDK for the `staking_vault` Anchor program. Ships ESM + CJS builds with bundled
type declarations.

## Install

```bash
yarn add @staking-vault/sdk @coral-xyz/anchor @solana/web3.js
```

`@coral-xyz/anchor` and `@solana/web3.js` are peer dependencies — bring your own versions.

## Quickstart

```ts
import { Connection } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { StakingVaultClient } from "@staking-vault/sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new Wallet(myKeypair); // omit for a read-only client
const client = new StakingVaultClient(connection, wallet);

await client.initializePool(stakeMint, rewardMint, 1_000_000_000n);
await client.stake(stakeMint, 1_000n);

const claimable = await client.getClaimable(stakeMint, wallet.publicKey);
console.log(`claimable: ${claimable}`);

await client.claim(stakeMint);
```

## API

| Export | Signature | Description |
|---|---|---|
| `StakingVaultClient` | `new StakingVaultClient(connection \| provider, wallet?)` | Main client. Accepts a real `Connection` (+ optional `Wallet`) for normal use, or a pre-built Anchor `Provider` for test harnesses. |
| `.initializePool` | `(stakeMint, rewardMint, rewardRate: bigint) => Promise<string>` | Creates the pool PDA and vault; moves `rewardMint`'s mint authority to the pool. Requires a wallet. |
| `.stake` | `(stakeMint, amount: bigint) => Promise<string>` | Opens or grows the caller's position. Requires a wallet. |
| `.unstake` | `(stakeMint, amount: bigint) => Promise<string>` | Withdraws staked tokens via the pool-signed CPI. Requires a wallet. |
| `.claim` | `(stakeMint) => Promise<string>` | Mints `floor(points / SCALE)` reward tokens; the sub-SCALE remainder carries forward. Requires a wallet. |
| `.getPool` | `(stakeMint) => Promise<PoolAccount \| null>` | Decoded Pool account, or `null` if it doesn't exist. |
| `.getStakeAccount` | `(stakeMint, owner) => Promise<StakeAccountState \| null>` | Decoded StakeAccount, or `null` if it doesn't exist. |
| `.getClaimable` | `(stakeMint, owner, nowTs?) => Promise<bigint>` | Projected claimable reward via `math.ts`, without sending a transaction. Reads the on-chain Clock sysvar if `nowTs` is omitted. |
| `pool` / `stakeAccount` / `vaultAta` | `(...) => [PublicKey, number]` | Pure PDA derivation helpers (from `pda.ts`). |
| `pendingPoints` / `claimableRewards` | `(input) => bigint` | Pure, BigInt-only accrual math (from `math.ts`), mirroring `state.rs`/`claim.rs` exactly. |

## Development

```bash
yarn workspace @staking-vault/sdk build   # tsup -> dist/ (ESM + CJS + .d.ts)
yarn workspace @staking-vault/sdk test    # runs tests/sdk.test.ts against the program's LiteSVM harness
```
