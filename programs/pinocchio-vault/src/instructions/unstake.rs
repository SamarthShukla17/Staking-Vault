use pinocchio::{
    cpi::{Seed, Signer},
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;
use solana_program_error::ProgramError;

use crate::error::VaultError;
use crate::state::{accrue_points, Pool, StakeAccount};

/// Discriminator 2: unstakes `amount` tokens from a pool, paying out from the
/// vault under the pool PDA's signing authority.
///
/// Accounts (in order):
/// 0. `[signer, writable]` user               — staker, must own `stake_account`.
/// 1. `[writable]`         pool                — Pool PDA, seeds `["pool", stake_mint]`.
/// 2. `[writable]`         stake_account       — StakeAccount PDA, seeds `["stake", pool, user]`.
/// 3. `[writable]`         user_token_account  — destination SPL token account.
/// 4. `[writable]`         vault               — pool's vault token account, seeds `["vault", pool]`.
/// 5. `[]`                 stake_mint          — mint staked into this pool, used to re-derive the
///                                              pool's own signer seeds for the vault withdrawal.
/// 6. `[]`                 token_program
///
/// Instruction data: `[2, amount: u64 le]`.
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [user, pool, stake_account, user_token_account, vault, stake_mint, token_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !user.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amount_bytes: [u8; 8] = data
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let amount = u64::from_le_bytes(amount_bytes);
    if amount == 0 {
        return Err(VaultError::ZeroAmount.into());
    }

    let program_id = Address::from(crate::ID);
    let pool_address = pool.address().clone();
    let user_address = user.address().clone();
    let stake_mint_address = stake_mint.address().clone();

    // Scoped so the reborrow of `*pool` ends before `pool` is needed again
    // (as an `AccountView`, not just data) for the CPI authority below.
    let (reward_rate, pool_bump) = {
        let pool_view = Pool::load(pool)?;
        (pool_view.reward_rate(), pool_view.bump())
    };

    let (vault_pda, _vault_bump) =
        Address::derive_program_address(&[b"vault", pool_address.as_array()], &program_id)
            .ok_or(ProgramError::InvalidSeeds)?;
    if vault.address() != &vault_pda {
        return Err(VaultError::InvalidAccount.into());
    }

    let stake_account_address = stake_account.address().clone();
    let (expected_stake_pda, expected_stake_bump) = Address::derive_program_address(
        &[b"stake", pool_address.as_array(), user_address.as_array()],
        &program_id,
    )
    .ok_or(ProgramError::InvalidSeeds)?;
    if stake_account_address != expected_stake_pda {
        return Err(VaultError::InvalidAccount.into());
    }

    let mut stake_view = StakeAccount::load(stake_account)?;
    if stake_view.bump() != expected_stake_bump {
        return Err(VaultError::InvalidAccount.into());
    }
    if stake_view.owner() != user_address.as_array() {
        return Err(VaultError::InvalidOwner.into());
    }

    if stake_view.amount() < amount {
        return Err(VaultError::InsufficientStake.into());
    }

    let now = Clock::get()?.unix_timestamp;
    let elapsed = now - stake_view.last_update_ts();
    if elapsed < 0 {
        return Err(VaultError::ClockWentBackwards.into());
    }
    let new_points = accrue_points(stake_view.amount(), elapsed, reward_rate, stake_view.points())
        .ok_or(VaultError::MathOverflow)?;
    stake_view.set_points(new_points);
    stake_view.set_last_update_ts(now);

    let pool_bump_seed = [pool_bump];
    let pool_seeds = [
        Seed::from(b"pool"),
        Seed::from(stake_mint_address.as_array()),
        Seed::from(&pool_bump_seed),
    ];
    Transfer::new(vault, user_token_account, pool, amount)
        .invoke_signed_with_program(&[Signer::from(&pool_seeds)], token_program.address())?;

    let new_stake_amount = stake_view
        .amount()
        .checked_sub(amount)
        .ok_or(VaultError::MathOverflow)?;
    stake_view.set_amount(new_stake_amount);

    let mut pool_view = Pool::load(pool)?;
    let new_total_staked = pool_view
        .total_staked()
        .checked_sub(amount)
        .ok_or(VaultError::MathOverflow)?;
    pool_view.set_total_staked(new_total_staked);

    Ok(())
}
