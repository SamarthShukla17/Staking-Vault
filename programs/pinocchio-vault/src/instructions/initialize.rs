use pinocchio::{
    cpi::{Seed, Signer},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeAccount3;
use solana_program_error::ProgramError;

use crate::error::VaultError;
use crate::state::Pool;

/// Discriminator 0: initializes a `Pool` and its vault token account.
///
/// Accounts (in order):
/// 0. `[signer, writable]` admin        — pays for account creation, recorded as pool admin.
/// 1. `[writable]`         pool         — Pool PDA, seeds `["pool", stake_mint]`.
/// 2. `[writable]`         vault        — plain SPL token account PDA (not an ATA), seeds
///                                        `["vault", pool]`, owner authority = pool PDA.
/// 3. `[]`                 stake_mint   — mint that may be staked into this pool.
/// 4. `[]`                 reward_mint  — mint recorded for future reward claims (unused here).
/// 5. `[]`                 system_program
/// 6. `[]`                 token_program
///
/// Instruction data: `[0, reward_rate: u64 le]`.
pub fn process(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, pool, vault, stake_mint, reward_mint, _system_program, token_program, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if !pool.is_data_empty() || pool.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    if !vault.is_data_empty() || vault.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let program_id = Address::from(crate::ID);

    let (pool_pda, pool_bump) =
        Address::derive_program_address(&[b"pool", stake_mint.address().as_array()], &program_id)
            .ok_or(ProgramError::InvalidSeeds)?;
    if pool.address() != &pool_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let (vault_pda, vault_bump) =
        Address::derive_program_address(&[b"vault", pool.address().as_array()], &program_id)
            .ok_or(ProgramError::InvalidSeeds)?;
    if vault.address() != &vault_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let reward_rate_bytes: [u8; 8] = data
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let reward_rate = u64::from_le_bytes(reward_rate_bytes);
    if reward_rate == 0 {
        return Err(VaultError::ZeroAmount.into());
    }

    // Create the Pool account, owned by this program.
    let pool_bump_seed = [pool_bump];
    let pool_seeds = [
        Seed::from(b"pool"),
        Seed::from(stake_mint.address().as_array()),
        Seed::from(&pool_bump_seed),
    ];
    CreateAccount::with_minimum_balance(admin, pool, Pool::LEN as u64, &program_id, None)?
        .invoke_signed(&[Signer::from(&pool_seeds)])?;

    // Create the vault as a plain SPL token account (not an ATA — one less CPI
    // dependency), owned by the token program with the pool PDA as its authority.
    let vault_bump_seed = [vault_bump];
    let vault_seeds = [
        Seed::from(b"vault"),
        Seed::from(pool.address().as_array()),
        Seed::from(&vault_bump_seed),
    ];
    CreateAccount::with_minimum_balance(
        admin,
        vault,
        pinocchio_token::state::Account::LEN as u64,
        token_program.address(),
        None,
    )?
    .invoke_signed(&[Signer::from(&vault_seeds)])?;

    InitializeAccount3::new(vault, stake_mint, &pool_pda)
        .invoke_with_program(token_program.address())?;

    // Reward-mint authority transfer is not ported (claim is out of scope) — just record it.
    Pool::init(
        pool,
        admin.address().as_array(),
        stake_mint.address().as_array(),
        reward_mint.address().as_array(),
        reward_rate,
        pool_bump,
    )?;

    Ok(())
}
