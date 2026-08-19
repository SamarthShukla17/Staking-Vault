use mollusk_svm::{program::keyed_account_for_system_program, result::Check, Mollusk};
use mollusk_svm_programs_token::token;
use solana_program_error::ProgramError;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use spl_token_interface::state::{Account as TokenAccount, AccountState, Mint};

fn program_id() -> Pubkey {
    Pubkey::new_from_array(pinocchio_vault::ID)
}

fn mint_account(authority: Pubkey) -> Account {
    token::create_account_for_mint(Mint {
        mint_authority: COption::Some(authority),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    })
}

fn token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    token::create_account_for_token_account(TokenAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    })
}

/// Hand-encodes a `Pool` account's bytes directly (bypassing the `initialize`
/// instruction), matching the packed layout documented in `src/state.rs`.
fn pool_account(
    program_id: Pubkey,
    admin: Pubkey,
    stake_mint: Pubkey,
    reward_mint: Pubkey,
    reward_rate: u64,
    total_staked: u64,
    bump: u8,
) -> Account {
    let mut account = Account::new(1_000_000_000, 114, &program_id);
    account.data[0] = 1;
    account.data[1..33].copy_from_slice(admin.as_ref());
    account.data[33..65].copy_from_slice(stake_mint.as_ref());
    account.data[65..97].copy_from_slice(reward_mint.as_ref());
    account.data[97..105].copy_from_slice(&reward_rate.to_le_bytes());
    account.data[105..113].copy_from_slice(&total_staked.to_le_bytes());
    account.data[113] = bump;
    account
}

struct Fixture {
    mollusk: Mollusk,
    program_id: Pubkey,
    accounts: Vec<(Pubkey, Account)>,
    metas: Vec<AccountMeta>,
    user: Pubkey,
    stake_pda: Pubkey,
    user_token_account: Pubkey,
    vault_pda: Pubkey,
    reward_rate: u64,
}

fn setup(reward_rate: u64) -> Fixture {
    // SAFETY: single-threaded test process, set before any other code reads the var.
    unsafe {
        std::env::set_var(
            "SBF_OUT_DIR",
            concat!(env!("CARGO_MANIFEST_DIR"), "/target/deploy"),
        );
    }

    let program_id = program_id();
    let mut mollusk = Mollusk::new(&program_id, "pinocchio_vault");
    token::add_program(&mut mollusk);

    let admin = Pubkey::new_unique();
    let user = Pubkey::new_unique();
    let stake_mint = Pubkey::new_unique();
    let reward_mint = Pubkey::new_unique();
    let user_token_account = Pubkey::new_unique();

    let (pool_pda, pool_bump) =
        Pubkey::find_program_address(&[b"pool", stake_mint.as_ref()], &program_id);
    let (vault_pda, _vault_bump) =
        Pubkey::find_program_address(&[b"vault", pool_pda.as_ref()], &program_id);
    let (stake_pda, _stake_bump) =
        Pubkey::find_program_address(&[b"stake", pool_pda.as_ref(), user.as_ref()], &program_id);

    let (system_program_id, system_program_account) = keyed_account_for_system_program();
    let (token_program_id, token_program_account) = token::keyed_account();

    let accounts = vec![
        (user, Account::new(10_000_000_000, 0, &system_program_id)),
        (
            pool_pda,
            pool_account(program_id, admin, stake_mint, reward_mint, reward_rate, 0, pool_bump),
        ),
        (stake_pda, Account::default()),
        (user_token_account, token_account(stake_mint, user, 1_000_000)),
        (vault_pda, token_account(stake_mint, pool_pda, 0)),
        (stake_mint, mint_account(admin)),
        (token_program_id, token_program_account),
        (system_program_id, system_program_account),
    ];

    let metas = vec![
        AccountMeta::new(user, true),
        AccountMeta::new(pool_pda, false),
        AccountMeta::new(stake_pda, false),
        AccountMeta::new(user_token_account, false),
        AccountMeta::new(vault_pda, false),
        AccountMeta::new_readonly(stake_mint, false),
        AccountMeta::new_readonly(token_program_id, false),
        AccountMeta::new_readonly(system_program_id, false),
    ];

    Fixture {
        mollusk,
        program_id,
        accounts,
        metas,
        user,
        stake_pda,
        user_token_account,
        vault_pda,
        reward_rate,
    }
}

fn stake_instruction(program_id: Pubkey, metas: Vec<AccountMeta>, amount: u64) -> Instruction {
    let mut data = vec![1u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction::new_with_bytes(program_id, &data, metas)
}

#[test]
fn first_stake_creates_account_and_transfers_tokens() {
    let fixture = setup(5);

    let instruction = stake_instruction(fixture.program_id, fixture.metas.clone(), 1_000);
    let result = fixture.mollusk.process_and_validate_instruction(
        &instruction,
        &fixture.accounts,
        &[Check::success()],
    );

    let stake_account = result
        .get_account(&fixture.stake_pda)
        .expect("stake account missing from result");
    assert_eq!(stake_account.owner, fixture.program_id);
    assert_eq!(stake_account.data.len(), 66);
    assert_eq!(stake_account.data[0], 2, "stake tag byte");
    assert_eq!(&stake_account.data[1..33], fixture.user.as_ref(), "owner");
    assert_eq!(
        u64::from_le_bytes(stake_account.data[33..41].try_into().unwrap()),
        1_000,
        "amount"
    );
    assert_eq!(
        u128::from_le_bytes(stake_account.data[41..57].try_into().unwrap()),
        0,
        "points start at zero"
    );

    let vault_account = result
        .get_account(&fixture.vault_pda)
        .expect("vault account missing from result");
    let vault_state = TokenAccount::unpack_from_slice(&vault_account.data)
        .expect("vault should decode as an SPL token account");
    assert_eq!(vault_state.amount, 1_000, "vault received the staked amount");

    let user_token_account = result
        .get_account(&fixture.user_token_account)
        .expect("user token account missing from result");
    let user_token_state = TokenAccount::unpack_from_slice(&user_token_account.data)
        .expect("user token account should decode");
    assert_eq!(
        user_token_state.amount,
        1_000_000 - 1_000,
        "user's tokens were debited"
    );
}

#[test]
fn second_stake_accrues_points_exactly() {
    let mut fixture = setup(5);

    let first_instruction = stake_instruction(fixture.program_id, fixture.metas.clone(), 1_000);
    let first_result = fixture.mollusk.process_and_validate_instruction(
        &first_instruction,
        &fixture.accounts,
        &[Check::success()],
    );

    // Advance the sysvar clock by 100 seconds before the second stake.
    fixture.mollusk.sysvars.clock.unix_timestamp += 100;

    let second_instruction = stake_instruction(fixture.program_id, fixture.metas.clone(), 500);
    let second_result = fixture.mollusk.process_and_validate_instruction(
        &second_instruction,
        &first_result.resulting_accounts,
        &[Check::success()],
    );

    let stake_account = second_result
        .get_account(&fixture.stake_pda)
        .expect("stake account missing from result");
    let points = u128::from_le_bytes(stake_account.data[41..57].try_into().unwrap());
    // Accrued on the *pre-existing* 1_000 staked over the 100s elapsed, at `reward_rate`.
    let expected_points = 1_000u128 * 100u128 * fixture.reward_rate as u128;
    assert_eq!(points, expected_points, "points accrued exactly");

    let amount = u64::from_le_bytes(stake_account.data[33..41].try_into().unwrap());
    assert_eq!(amount, 1_000 + 500, "second stake adds to the existing amount");

    let last_update_ts = i64::from_le_bytes(stake_account.data[57..65].try_into().unwrap());
    assert_eq!(last_update_ts, 100, "last_update_ts advances to the new clock value");
}

#[test]
fn zero_amount_is_rejected() {
    let fixture = setup(5);

    let instruction = stake_instruction(fixture.program_id, fixture.metas.clone(), 0);
    fixture.mollusk.process_and_validate_instruction(
        &instruction,
        &fixture.accounts,
        &[Check::err(ProgramError::Custom(0))],
    );
}

#[test]
fn forged_stake_account_at_wrong_pda_is_rejected() {
    let mut fixture = setup(5);

    // Swap in an account key that is not the derived `["stake", pool, user]` PDA.
    let forged_stake_account = Pubkey::new_unique();
    fixture.accounts[2] = (forged_stake_account, Account::default());
    fixture.metas[2] = AccountMeta::new(forged_stake_account, false);

    let instruction = stake_instruction(fixture.program_id, fixture.metas.clone(), 1_000);
    fixture.mollusk.process_and_validate_instruction(
        &instruction,
        &fixture.accounts,
        &[Check::err(ProgramError::Custom(3))],
    );
}
