use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::POOL_SEED;
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
    let pool = &mut ctx.accounts.pool;
    pool.admin = ctx.accounts.admin.key();
    pool.stake_mint = ctx.accounts.stake_mint.key();
    pool.reward_mint = ctx.accounts.reward_mint.key();
    pool.reward_rate = reward_rate;
    pool.total_staked = 0;
    pool.bump = ctx.bumps.pool;

    emit!(PoolInitialized {
        pool: pool.key(),
        stake_mint: pool.stake_mint,
        reward_mint: pool.reward_mint,
        reward_rate: pool.reward_rate,
    });

    Ok(())
}
