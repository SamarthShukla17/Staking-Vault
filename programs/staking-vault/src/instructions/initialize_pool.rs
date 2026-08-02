use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{self, Mint, SetAuthority, Token, TokenAccount};

use crate::constants::POOL_SEED;
use crate::errors::ErrorCode;
use crate::events::PoolInitialized;
use crate::state::Pool;

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Pool::LEN,
        seeds = [POOL_SEED, stake_mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    pub stake_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = reward_mint.mint_authority == COption::Some(admin.key()) @ ErrorCode::InvalidMintAuthority,
    )]
    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = stake_mint,
        associated_token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_pool(ctx: Context<InitializePool>, reward_rate: u64) -> Result<()> {
    require!(reward_rate > 0, ErrorCode::ZeroAmount);

    ctx.accounts.pool.admin = ctx.accounts.admin.key();
    ctx.accounts.pool.stake_mint = ctx.accounts.stake_mint.key();
    ctx.accounts.pool.reward_mint = ctx.accounts.reward_mint.key();
    ctx.accounts.pool.reward_rate = reward_rate;
    ctx.accounts.pool.total_staked = 0;
    ctx.accounts.pool.bump = ctx.bumps.pool;

    let pool_key = ctx.accounts.pool.key();

    // Move the reward mint's authority to the pool PDA so claim()'s mint_to CPI (signed by the
    // pool) is authorized later. Only the admin — already verified above to be the current mint
    // authority — can authorize this move.
    let cpi_accounts = SetAuthority {
        current_authority: ctx.accounts.admin.to_account_info(),
        account_or_mint: ctx.accounts.reward_mint.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::set_authority(cpi_ctx, AuthorityType::MintTokens, Some(pool_key))?;

    emit!(PoolInitialized {
        pool: pool_key,
        stake_mint: ctx.accounts.stake_mint.key(),
        reward_mint: ctx.accounts.reward_mint.key(),
        reward_rate,
    });

    Ok(())
}
