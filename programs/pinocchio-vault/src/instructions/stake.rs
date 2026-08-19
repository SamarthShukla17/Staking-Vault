use pinocchio::{
    cpi::{Seed, Signer},
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;
use solana_program_error::ProgramError;

use crate::error::VaultError;
use crate::state::{accrue_points, Pool, StakeAccount};

/// Discriminator 1: stakes `amount` tokens into a pool, creating the caller's
/// `StakeAccount` on first stake.
///
/// Accounts (in order):
/// 0. `[signer, writable]` user               — staker, pays for `StakeAccount` creation.
/// 1. `[writable]`         pool                — Pool PDA, seeds `["pool", stake_mint]`.
/// 2. `[writable]`         stake_account       — StakeAccount PDA, seeds `["stake", pool, user]`.
/// 3. `[writable]`         user_token_account  — source SPL token account, owned by `user`.
/// 4. `[writable]`         vault               — pool's vault token account, seeds `["vault", pool]`.
/// 5. `[]`                 stake_mint          — mint staked into this pool (unused, kept for symmetry).
/// 6. `[]`                 token_program
/// 7. `[]`                 system_program
///
/// Instruction data: `[1, amount: u64 le]`.
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [user, pool, stake_account, user_token_account, vault, _stake_mint, token_program, _system_program, ..] =
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

    let mut pool_view = Pool::load(pool)?;

    let (vault_pda, _vault_bump) =
        Address::derive_program_address(&[b"vault", pool_address.as_array()], &program_id)
            .ok_or(ProgramError::InvalidSeeds)?;
    if vault.address() != &vault_pda {
        return Err(VaultError::InvalidAccount.into());
    }

    let now = Clock::get()?.unix_timestamp;

    if stake_account.is_data_empty() {
        let (stake_pda, stake_bump) = Address::derive_program_address(
            &[b"stake", pool_address.as_array(), user_address.as_array()],
            &program_id,
        )
        .ok_or(ProgramError::InvalidSeeds)?;
        if stake_account.address() != &stake_pda {
            return Err(VaultError::InvalidAccount.into());
        }

        let stake_bump_seed = [stake_bump];
        let stake_seeds = [
            Seed::from(b"stake"),
            Seed::from(pool_address.as_array()),
            Seed::from(user_address.as_array()),
            Seed::from(&stake_bump_seed),
        ];
        CreateAccount::with_minimum_balance(
            user,
            stake_account,
            StakeAccount::LEN as u64,
            &program_id,
            None,
        )?
        .invoke_signed(&[Signer::from(&stake_seeds)])?;

        let mut stake_view = StakeAccount::init(
            stake_account,
            user_address.as_array(),
            0,
            now,
            stake_bump,
        )?;

        Transfer::new(user_token_account, vault, user, amount)
            .invoke_with_program(token_program.address())?;

        stake_view.set_amount(amount);
    } else {
        let stake_account_address = stake_account.address().clone();

        let (expected, _expected_bump) = Address::derive_program_address(
            &[b"stake", pool_address.as_array(), user_address.as_array()],
            &program_id,
        )
        .ok_or(ProgramError::InvalidSeeds)?;
        if stake_account_address != expected {
            return Err(VaultError::InvalidAccount.into());
        }

        let mut stake_view = StakeAccount::load(stake_account)?;

        if stake_view.owner() != user_address.as_array() {
            return Err(VaultError::InvalidOwner.into());
        }

        let elapsed = now - stake_view.last_update_ts();
        if elapsed < 0 {
            return Err(VaultError::ClockWentBackwards.into());
        }
        let new_points = accrue_points(
            stake_view.amount(),
            elapsed,
            pool_view.reward_rate(),
            stake_view.points(),
        )
        .ok_or(VaultError::MathOverflow)?;
        stake_view.set_points(new_points);
        stake_view.set_last_update_ts(now);

        Transfer::new(user_token_account, vault, user, amount)
            .invoke_with_program(token_program.address())?;

        let new_amount = stake_view
            .amount()
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        stake_view.set_amount(new_amount);
    }

    let new_total_staked = pool_view
        .total_staked()
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    pool_view.set_total_staked(new_total_staked);

    Ok(())
}
