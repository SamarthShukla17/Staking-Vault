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

#[test]
fn initialize_creates_pool_and_vault() {
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
    let stake_mint = Pubkey::new_unique();
    let reward_mint = Pubkey::new_unique();

    let (pool_pda, pool_bump) =
        Pubkey::find_program_address(&[b"pool", stake_mint.as_ref()], &program_id);
    let (vault_pda, _vault_bump) =
        Pubkey::find_program_address(&[b"vault", pool_pda.as_ref()], &program_id);

    let reward_rate: u64 = 5;
    let mut instruction_data = vec![0u8];
    instruction_data.extend_from_slice(&reward_rate.to_le_bytes());

    let (system_program_id, system_program_account) = keyed_account_for_system_program();
    let (token_program_id, token_program_account) = token::keyed_account();

    let instruction = Instruction::new_with_bytes(
        program_id,
        &instruction_data,
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

    let accounts = vec![
        (admin, Account::new(10_000_000_000, 0, &system_program_id)),
        (pool_pda, Account::default()),
        (vault_pda, Account::default()),
        (stake_mint, mint_account(admin)),
        (reward_mint, mint_account(admin)),
        (system_program_id, system_program_account),
        (token_program_id, token_program_account),
    ];

    let result =
        mollusk.process_and_validate_instruction(&instruction, &accounts, &[Check::success()]);

    let pool_account = result
        .get_account(&pool_pda)
        .expect("pool account missing from result");
    assert_eq!(pool_account.owner, program_id);
    assert_eq!(pool_account.data.len(), 114);
    assert_eq!(pool_account.data[0], 1, "pool tag byte");
    assert_eq!(&pool_account.data[1..33], admin.as_ref(), "admin");
    assert_eq!(&pool_account.data[33..65], stake_mint.as_ref(), "stake_mint");
    assert_eq!(&pool_account.data[65..97], reward_mint.as_ref(), "reward_mint");
    assert_eq!(
        u64::from_le_bytes(pool_account.data[97..105].try_into().unwrap()),
        reward_rate,
        "reward_rate"
    );
    assert_eq!(
        u64::from_le_bytes(pool_account.data[105..113].try_into().unwrap()),
        0,
        "total_staked starts at zero"
    );
    assert_eq!(pool_account.data[113], pool_bump, "bump");

    let vault_account = result
        .get_account(&vault_pda)
        .expect("vault account missing from result");
    assert_eq!(vault_account.owner, token_program_id);
    assert_eq!(vault_account.data.len(), TokenAccount::LEN);

    let vault_state = TokenAccount::unpack_from_slice(&vault_account.data)
        .expect("vault should decode as an SPL token account");
    assert_eq!(vault_state.mint, stake_mint);
    assert_eq!(vault_state.owner, pool_pda, "vault authority must be the pool PDA");
    assert_eq!(vault_state.amount, 0);
    assert_eq!(vault_state.state, AccountState::Initialized);
}
