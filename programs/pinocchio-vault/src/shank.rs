//! Shank annotations used *only* to generate `idl/pinocchio_vault.json` via
//! `shank idl` (see `scripts/generate-idl.sh`).
//!
//! This module is not part of the on-chain program: it is gated behind the
//! `idl` feature (off by default), so `cargo build-sbf` never sees it and the
//! deployed binary stays free of the `shank` dependency. `shank`'s IDL
//! extraction works by statically parsing this crate's source with `syn` (it
//! never invokes `rustc`), so it discovers these annotations regardless of
//! the `cfg` gate on the `mod shank;` declaration in `lib.rs` — the gate only
//! controls whether *this file* actually gets compiled when someone runs
//! `cargo check --features idl` as a sanity check.
//!
//! The enum/struct shapes below are IDL-only mirrors of the real account
//! orders (documented in `instructions/*.rs`) and the real zero-copy layouts
//! (`state.rs`) — they carry no runtime behavior of their own.

use shank::{ShankAccount, ShankInstruction};

/// Minimal stand-in for `solana_program::pubkey::Pubkey`. Shank's IDL
/// extractor matches on the bare type name `Pubkey` syntactically, so this
/// local definition is enough to produce a `publicKey` IDL field — no need to
/// pull the (std-only) `solana-program` crate into this `no_std` program.
#[allow(dead_code)]
pub struct Pubkey(pub [u8; 32]);

/// IDL mirror of `state::Pool` (tag 1, 114 bytes):
/// `tag(1) | admin(32) | stake_mint(32) | reward_mint(32) | reward_rate(8) | total_staked(8) | bump(1)`.
#[derive(ShankAccount)]
#[allow(dead_code)]
pub struct Pool {
    pub admin: Pubkey,
    pub stake_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_rate: u64,
    pub total_staked: u64,
    pub bump: u8,
}

/// IDL mirror of `state::StakeAccount` (tag 2, 66 bytes):
/// `tag(1) | owner(32) | amount(8) | points(16) | last_update_ts(8) | bump(1)`.
#[derive(ShankAccount)]
#[allow(dead_code)]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub amount: u64,
    pub points: u128,
    pub last_update_ts: i64,
    pub bump: u8,
}

/// IDL mirror of the instruction dispatch in `lib.rs::process_instruction`.
/// Variant order matches the real discriminators exactly (`Initialize` = 0,
/// `Stake` = 1, `Unstake` = 2), and each `#[account]` entry mirrors the real
/// account order documented at the top of the corresponding
/// `instructions/*.rs::process` function, byte for byte.
#[derive(ShankInstruction)]
#[allow(dead_code)]
pub enum VaultInstruction {
    /// Discriminator 0. Initializes a `Pool` and its vault token account.
    /// Instruction data: `[0, reward_rate: u64 le]`.
    #[account(0, writable, signer, name = "admin", desc = "Pays for account creation; recorded as the pool admin")]
    #[account(1, writable, name = "pool", desc = "Pool PDA, seeds [\"pool\", stake_mint]")]
    #[account(2, writable, name = "vault", desc = "Vault SPL token account PDA, seeds [\"vault\", pool]")]
    #[account(3, name = "stake_mint", desc = "Mint that may be staked into this pool")]
    #[account(4, name = "reward_mint", desc = "Mint recorded for future reward claims")]
    #[account(5, name = "system_program", desc = "System program")]
    #[account(6, name = "token_program", desc = "SPL Token program")]
    Initialize { reward_rate: u64 },

    /// Discriminator 1. Stakes `amount` tokens into a pool, creating the
    /// caller's `StakeAccount` on first stake.
    /// Instruction data: `[1, amount: u64 le]`.
    #[account(0, writable, signer, name = "user", desc = "Staker; pays for StakeAccount creation")]
    #[account(1, writable, name = "pool", desc = "Pool PDA, seeds [\"pool\", stake_mint]")]
    #[account(2, writable, name = "stake_account", desc = "StakeAccount PDA, seeds [\"stake\", pool, user]")]
    #[account(3, writable, name = "user_token_account", desc = "Source SPL token account, owned by user")]
    #[account(4, writable, name = "vault", desc = "Pool's vault token account, seeds [\"vault\", pool]")]
    #[account(5, name = "stake_mint", desc = "Mint staked into this pool")]
    #[account(6, name = "token_program", desc = "SPL Token program")]
    #[account(7, name = "system_program", desc = "System program")]
    Stake { amount: u64 },

    /// Discriminator 2. Unstakes `amount` tokens from a pool, paying out from
    /// the vault under the pool PDA's signing authority.
    /// Instruction data: `[2, amount: u64 le]`.
    #[account(0, writable, signer, name = "user", desc = "Staker; must own stake_account")]
    #[account(1, writable, name = "pool", desc = "Pool PDA, seeds [\"pool\", stake_mint]")]
    #[account(2, writable, name = "stake_account", desc = "StakeAccount PDA, seeds [\"stake\", pool, user]")]
    #[account(3, writable, name = "user_token_account", desc = "Destination SPL token account")]
    #[account(4, writable, name = "vault", desc = "Pool's vault token account, seeds [\"vault\", pool]")]
    #[account(5, name = "stake_mint", desc = "Mint staked into this pool")]
    #[account(6, name = "token_program", desc = "SPL Token program")]
    Unstake { amount: u64 },
}
