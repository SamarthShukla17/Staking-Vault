//! Chains `initialize` -> `stake` (two users) -> `unstake` (partial) through
//! Mollusk and asserts, after every single step, that the vault's actual SPL
//! token balance equals `pool.total_staked`, which in turn equals the sum of
//! every `StakeAccount.amount` — i.e. the pool never drifts from what it
//! actually custodies.

use mollusk_svm::{program::keyed_account_for_system_program, result::Check, Mollusk};
use mollusk_svm_programs_token::token;
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

fn stake_account_amount(account: &Account) -> u64 {
    u64::from_le_bytes(account.data[33..41].try_into().unwrap())
}

fn pool_total_staked(account: &Account) -> u64 {
    u64::from_le_bytes(account.data[105..113].try_into().unwrap())
}

fn vault_amount(account: &Account) -> u64 {
    TokenAccount::unpack_from_slice(&account.data)
        .expect("token account should decode")
        .amount
}

/// Upserts every `(pubkey, account)` from `updates` into `world`.
fn merge(world: &mut Vec<(Pubkey, Account)>, updates: &[(Pubkey, Account)]) {
    for (pubkey, account) in updates {
        if let Some(entry) = world.iter_mut().find(|(k, _)| k == pubkey) {
            entry.1 = account.clone();
        } else {
            world.push((*pubkey, account.clone()));
        }
    }
}

fn find<'a>(world: &'a [(Pubkey, Account)], pubkey: &Pubkey) -> &'a Account {
    &world
        .iter()
        .find(|(k, _)| k == pubkey)
        .expect("account missing from world")
        .1
}

/// Asserts vault balance == pool.total_staked == sum of every stake amount.
fn assert_invariant(
    world: &[(Pubkey, Account)],
    vault_pda: Pubkey,
    pool_pda: Pubkey,
    stake_pdas: &[Pubkey],
    step: &str,
) {
    let vault_balance = vault_amount(find(world, &vault_pda));
    let total_staked = pool_total_staked(find(world, &pool_pda));
    let sum_of_stakes: u64 = stake_pdas
        .iter()
        .map(|pda| {
            let account = find(world, pda);
            if account.data.len() == 66 {
                stake_account_amount(account)
            } else {
                0
            }
        })
        .sum();

    assert_eq!(
        vault_balance, total_staked,
        "[{step}] vault balance ({vault_balance}) != pool.total_staked ({total_staked})"
    );
    assert_eq!(
        total_staked, sum_of_stakes,
        "[{step}] pool.total_staked ({total_staked}) != sum of stake amounts ({sum_of_stakes})"
    );
}

#[test]
fn vault_balance_tracks_total_staked_through_init_stake_stake_unstake() {
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
    let mollusk = mollusk;

    let admin = Pubkey::new_unique();
    let stake_mint = Pubkey::new_unique();
    let reward_mint = Pubkey::new_unique();
    let user1 = Pubkey::new_unique();
    let user2 = Pubkey::new_unique();
    let user1_token_account = Pubkey::new_unique();
    let user2_token_account = Pubkey::new_unique();
    let reward_rate: u64 = 2;

    let (pool_pda, _pool_bump) =
        Pubkey::find_program_address(&[b"pool", stake_mint.as_ref()], &program_id);
    let (vault_pda, _vault_bump) =
        Pubkey::find_program_address(&[b"vault", pool_pda.as_ref()], &program_id);
    let (stake_pda1, _stake_bump1) =
        Pubkey::find_program_address(&[b"stake", pool_pda.as_ref(), user1.as_ref()], &program_id);
    let (stake_pda2, _stake_bump2) =
        Pubkey::find_program_address(&[b"stake", pool_pda.as_ref(), user2.as_ref()], &program_id);

    let (system_program_id, system_program_account) = keyed_account_for_system_program();
    let (token_program_id, token_program_account) = token::keyed_account();

    let mut world: Vec<(Pubkey, Account)> = vec![
        (admin, Account::new(10_000_000_000, 0, &system_program_id)),
        (user1, Account::new(10_000_000_000, 0, &system_program_id)),
        (user2, Account::new(10_000_000_000, 0, &system_program_id)),
        (pool_pda, Account::default()),
        (vault_pda, Account::default()),
        (stake_pda1, Account::default()),
        (stake_pda2, Account::default()),
        (stake_mint, mint_account(admin)),
        (reward_mint, mint_account(admin)),
        (user1_token_account, token_account(stake_mint, user1, 5_000)),
        (user2_token_account, token_account(stake_mint, user2, 5_000)),
        (system_program_id, system_program_account),
        (token_program_id, token_program_account),
    ];

    let stake_pdas = [stake_pda1, stake_pda2];

    // --- init ---
    let mut data = vec![0u8];
    data.extend_from_slice(&reward_rate.to_le_bytes());
    let init_ix = Instruction::new_with_bytes(
        program_id,
        &data,
        vec![
            AccountMeta::new(admin, true),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(stake_mint, false),
            AccountMeta::new_readonly(reward_mint, false),
            AccountMeta::new_readonly(system_program_id, false),
            AccountMeta::new_readonly(token_program_id, false),
        ],
    );
    let result = mollusk.process_and_validate_instruction(&init_ix, &world, &[Check::success()]);
    merge(&mut world, &result.resulting_accounts);
    assert_invariant(&world, vault_pda, pool_pda, &stake_pdas, "after init");

    // --- stake user1: 1_000 ---
    let mut data = vec![1u8];
    data.extend_from_slice(&1_000u64.to_le_bytes());
    let stake1_ix = Instruction::new_with_bytes(
        program_id,
        &data,
        vec![
            AccountMeta::new(user1, true),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new(stake_pda1, false),
            AccountMeta::new(user1_token_account, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(stake_mint, false),
            AccountMeta::new_readonly(token_program_id, false),
            AccountMeta::new_readonly(system_program_id, false),
        ],
    );
    let result = mollusk.process_and_validate_instruction(&stake1_ix, &world, &[Check::success()]);
    merge(&mut world, &result.resulting_accounts);
    assert_invariant(&world, vault_pda, pool_pda, &stake_pdas, "after user1 stakes 1_000");

    // --- stake user2: 500 ---
    let mut data = vec![1u8];
    data.extend_from_slice(&500u64.to_le_bytes());
    let stake2_ix = Instruction::new_with_bytes(
        program_id,
        &data,
        vec![
            AccountMeta::new(user2, true),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new(stake_pda2, false),
            AccountMeta::new(user2_token_account, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(stake_mint, false),
            AccountMeta::new_readonly(token_program_id, false),
            AccountMeta::new_readonly(system_program_id, false),
        ],
    );
    let result = mollusk.process_and_validate_instruction(&stake2_ix, &world, &[Check::success()]);
    merge(&mut world, &result.resulting_accounts);
    assert_invariant(&world, vault_pda, pool_pda, &stake_pdas, "after user2 stakes 500");

    // --- unstake user1: 300 (partial) ---
    let mut data = vec![2u8];
    data.extend_from_slice(&300u64.to_le_bytes());
    let unstake1_ix = Instruction::new_with_bytes(
        program_id,
        &data,
        vec![
            AccountMeta::new(user1, true),
            AccountMeta::new(pool_pda, false),
            AccountMeta::new(stake_pda1, false),
            AccountMeta::new(user1_token_account, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(stake_mint, false),
            AccountMeta::new_readonly(token_program_id, false),
        ],
    );
    let result =
        mollusk.process_and_validate_instruction(&unstake1_ix, &world, &[Check::success()]);
    merge(&mut world, &result.resulting_accounts);
    assert_invariant(&world, vault_pda, pool_pda, &stake_pdas, "after user1 unstakes 300");

    // Final sanity: exact expected numbers, not just internal consistency.
    let final_vault = vault_amount(find(&world, &vault_pda));
    let final_pool = pool_total_staked(find(&world, &pool_pda));
    let final_stake1 = stake_account_amount(find(&world, &stake_pda1));
    let final_stake2 = stake_account_amount(find(&world, &stake_pda2));
    assert_eq!(final_vault, 1_200);
    assert_eq!(final_pool, 1_200);
    assert_eq!(final_stake1, 700);
    assert_eq!(final_stake2, 500);
}
