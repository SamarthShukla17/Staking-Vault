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

/// Hand-encodes a `Pool` account's bytes directly, matching the packed layout
/// documented in `src/state.rs`.
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

/// Hand-encodes a `StakeAccount`'s bytes directly, matching the packed layout
/// documented in `src/state.rs`.
fn stake_account_bytes(
    program_id: Pubkey,
    owner: Pubkey,
    amount: u64,
    points: u128,
    last_update_ts: i64,
    bump: u8,
) -> Account {
    let mut account = Account::new(1_000_000_000, 66, &program_id);
    account.data[0] = 2;
    account.data[1..33].copy_from_slice(owner.as_ref());
    account.data[33..41].copy_from_slice(&amount.to_le_bytes());
    account.data[41..57].copy_from_slice(&points.to_le_bytes());
    account.data[57..65].copy_from_slice(&last_update_ts.to_le_bytes());
    account.data[65] = bump;
    account
}

struct World {
    mollusk: Mollusk,
    program_id: Pubkey,
    admin: Pubkey,
    user: Pubkey,
    stake_mint: Pubkey,
    reward_mint: Pubkey,
    pool_pda: Pubkey,
    pool_bump: u8,
    stake_pda: Pubkey,
    stake_bump: u8,
    vault_pda: Pubkey,
    user_token_account: Pubkey,
    token_program_id: Pubkey,
    system_program_id: Pubkey,
    reward_rate: u64,
}

fn world(reward_rate: u64) -> World {
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
    let (stake_pda, stake_bump) =
        Pubkey::find_program_address(&[b"stake", pool_pda.as_ref(), user.as_ref()], &program_id);

    let (system_program_id, _) = keyed_account_for_system_program();
    let (token_program_id, _) = token::keyed_account();

    World {
        mollusk,
        program_id,
        admin,
        user,
        stake_mint,
        reward_mint,
        pool_pda,
        pool_bump,
        stake_pda,
        stake_bump,
        vault_pda,
        user_token_account,
        token_program_id,
        system_program_id,
        reward_rate,
    }
}

/// Base account set with an *empty* stake account (as if the user has never
/// staked yet) and `user_token_balance` tokens sitting in their wallet.
fn base_accounts(w: &World, user_token_balance: u64) -> Vec<(Pubkey, Account)> {
    let (_, system_program_account) = keyed_account_for_system_program();
    let (_, token_program_account) = token::keyed_account();

    vec![
        (w.user, Account::new(10_000_000_000, 0, &w.system_program_id)),
        (
            w.pool_pda,
            pool_account(w.program_id, w.admin, w.stake_mint, w.reward_mint, w.reward_rate, 0, w.pool_bump),
        ),
        (w.stake_pda, Account::default()),
        (w.user_token_account, token_account(w.stake_mint, w.user, user_token_balance)),
        (w.vault_pda, token_account(w.stake_mint, w.pool_pda, 0)),
        (w.stake_mint, mint_account(w.admin)),
        (w.token_program_id, token_program_account),
        (w.system_program_id, system_program_account),
    ]
}

fn stake_metas(w: &World) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(w.user, true),
        AccountMeta::new(w.pool_pda, false),
        AccountMeta::new(w.stake_pda, false),
        AccountMeta::new(w.user_token_account, false),
        AccountMeta::new(w.vault_pda, false),
        AccountMeta::new_readonly(w.stake_mint, false),
        AccountMeta::new_readonly(w.token_program_id, false),
        AccountMeta::new_readonly(w.system_program_id, false),
    ]
}

fn unstake_metas(w: &World) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new(w.user, true),
        AccountMeta::new(w.pool_pda, false),
        AccountMeta::new(w.stake_pda, false),
        AccountMeta::new(w.user_token_account, false),
        AccountMeta::new(w.vault_pda, false),
        AccountMeta::new_readonly(w.stake_mint, false),
        AccountMeta::new_readonly(w.token_program_id, false),
    ]
}

fn stake_instruction(w: &World, amount: u64) -> Instruction {
    let mut data = vec![1u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction::new_with_bytes(w.program_id, &data, stake_metas(w))
}

fn unstake_instruction(w: &World, amount: u64) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction::new_with_bytes(w.program_id, &data, unstake_metas(w))
}

fn stake_account_amount(account: &Account) -> u64 {
    u64::from_le_bytes(account.data[33..41].try_into().unwrap())
}

fn stake_account_points(account: &Account) -> u128 {
    u128::from_le_bytes(account.data[41..57].try_into().unwrap())
}

fn pool_total_staked(account: &Account) -> u64 {
    u64::from_le_bytes(account.data[105..113].try_into().unwrap())
}

fn vault_amount(account: &Account) -> u64 {
    TokenAccount::unpack_from_slice(&account.data)
        .expect("token account should decode")
        .amount
}

#[test]
fn unstake_partial_after_warp_accrues_points_and_moves_tokens() {
    let mut w = world(3);
    let accounts = base_accounts(&w, 5_000);

    let stake_result = w.mollusk.process_and_validate_instruction(
        &stake_instruction(&w, 1_000),
        &accounts,
        &[Check::success()],
    );

    // Advance the sysvar clock by 50 seconds before unstaking.
    w.mollusk.sysvars.clock.unix_timestamp += 50;

    let unstake_result = w.mollusk.process_and_validate_instruction(
        &unstake_instruction(&w, 400),
        &stake_result.resulting_accounts,
        &[Check::success()],
    );

    let vault_account = unstake_result
        .get_account(&w.vault_pda)
        .expect("vault account missing from result");
    assert_eq!(vault_amount(vault_account), 600, "vault balance after partial unstake");

    let stake_account = unstake_result
        .get_account(&w.stake_pda)
        .expect("stake account missing from result");
    assert_eq!(stake_account_amount(stake_account), 600, "remaining staked amount");
    assert_eq!(
        stake_account_points(stake_account),
        1_000u128 * 50u128 * w.reward_rate as u128,
        "points accrued on the pre-unstake amount over the elapsed time"
    );

    let pool_account = unstake_result
        .get_account(&w.pool_pda)
        .expect("pool account missing from result");
    assert_eq!(pool_total_staked(pool_account), 600, "pool total_staked mirrors the stake account");
}

#[test]
fn overdraw_is_rejected_and_state_is_unchanged() {
    let w = world(3);
    let mut accounts = base_accounts(&w, 5_000);
    accounts[1] = (
        w.pool_pda,
        pool_account(w.program_id, w.admin, w.stake_mint, w.reward_mint, w.reward_rate, 600, w.pool_bump),
    );
    accounts[2] = (
        w.stake_pda,
        stake_account_bytes(w.program_id, w.user, 600, 0, 0, w.stake_bump),
    );
    accounts[4] = (w.vault_pda, token_account(w.stake_mint, w.pool_pda, 600));

    let before = accounts.clone();

    let result = w.mollusk.process_and_validate_instruction(
        &unstake_instruction(&w, 601),
        &accounts,
        &[Check::err(ProgramError::Custom(1))], // InsufficientStake
    );

    for (pubkey, account) in &before {
        let after = result
            .get_account(pubkey)
            .expect("account missing from result");
        assert_eq!(after.data, account.data, "{pubkey} data changed on a failed unstake");
        assert_eq!(after.lamports, account.lamports, "{pubkey} lamports changed on a failed unstake");
    }
}

#[test]
fn attacker_cannot_unstake_victims_position() {
    let w = world(3);
    let mut accounts = base_accounts(&w, 5_000);
    accounts[1] = (
        w.pool_pda,
        pool_account(w.program_id, w.admin, w.stake_mint, w.reward_mint, w.reward_rate, 1_000, w.pool_bump),
    );
    accounts[2] = (
        w.stake_pda,
        stake_account_bytes(w.program_id, w.user, 1_000, 0, 0, w.stake_bump),
    );
    accounts[4] = (w.vault_pda, token_account(w.stake_mint, w.pool_pda, 1_000));

    // The attacker is a different signer, pointed at the victim's real stake_account.
    let attacker = Pubkey::new_unique();
    let attacker_token_account = Pubkey::new_unique();
    accounts[0] = (attacker, Account::new(10_000_000_000, 0, &w.system_program_id));
    accounts.push((attacker_token_account, token_account(w.stake_mint, attacker, 0)));

    let mut metas = unstake_metas(&w);
    metas[0] = AccountMeta::new(attacker, true);
    metas[3] = AccountMeta::new(attacker_token_account, false);

    let mut data = vec![2u8];
    data.extend_from_slice(&500u64.to_le_bytes());
    let instruction = Instruction::new_with_bytes(w.program_id, &data, metas);

    // The attacker's own `["stake", pool, attacker]` PDA never equals the
    // victim's stake_account, so this is rejected as an invalid account
    // before any owner check is even reached.
    w.mollusk.process_and_validate_instruction(
        &instruction,
        &accounts,
        &[Check::err(ProgramError::Custom(3))], // InvalidAccount
    );
}

#[test]
fn full_exit_then_further_unstake_is_rejected() {
    let w = world(3);
    let mut accounts = base_accounts(&w, 5_000);
    accounts[1] = (
        w.pool_pda,
        pool_account(w.program_id, w.admin, w.stake_mint, w.reward_mint, w.reward_rate, 1_000, w.pool_bump),
    );
    accounts[2] = (
        w.stake_pda,
        stake_account_bytes(w.program_id, w.user, 1_000, 0, 0, w.stake_bump),
    );
    accounts[4] = (w.vault_pda, token_account(w.stake_mint, w.pool_pda, 1_000));

    let full_exit_result = w.mollusk.process_and_validate_instruction(
        &unstake_instruction(&w, 1_000),
        &accounts,
        &[Check::success()],
    );

    let stake_account = full_exit_result
        .get_account(&w.stake_pda)
        .expect("stake account missing from result");
    assert_eq!(stake_account_amount(stake_account), 0, "fully unstaked");

    w.mollusk.process_and_validate_instruction(
        &unstake_instruction(&w, 1),
        &full_exit_result.resulting_accounts,
        &[Check::err(ProgramError::Custom(1))], // InsufficientStake
    );
}
