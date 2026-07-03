use anchor_lang::prelude::*;

/// Fixed-point scale for `reward_rate` and accrued `points`.
/// reward_rate is expressed as reward base-units per staked base-unit per second, times SCALE.
pub const SCALE: u128 = 1_000_000_000_000;

#[constant]
pub const POOL_SEED: &[u8] = b"pool";

#[constant]
pub const STAKE_SEED: &[u8] = b"stake";
