use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::constants::{POOL_SEED, SCALE, STAKE_SEED};
use crate::errors::ErrorCode;
use crate::events::Claimed;
use crate::state::{Pool, StakeAccount};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [POOL_SEED, pool.stake_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [STAKE_SEED, pool.key().as_ref(), user.key().as_ref()],
        bump = stake_account.bump,
        constraint = stake_account.owner == user.key(),
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        mut,
        address = pool.reward_mint,
    )]
    pub reward_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = reward_mint,
        associated_token::authority = user,
    )]
    pub user_reward_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let reward_rate = ctx.accounts.pool.reward_rate;

    ctx.accounts.stake_account.accrue(reward_rate, now)?;

    let reward_u128 = ctx.accounts.stake_account.points / SCALE;
    if reward_u128 == 0 {
        // Nothing claimable yet; accrue() above already advanced last_update_ts.
        return Ok(());
    }

    let reward: u64 = reward_u128.try_into().map_err(|_| ErrorCode::MathOverflow)?;
    // Keep the sub-SCALE remainder so no fractional progress is lost to the user across claims.
    ctx.accounts.stake_account.points %= SCALE;

    let stake_mint = ctx.accounts.pool.stake_mint;
    let bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[u8]] = &[POOL_SEED, stake_mint.as_ref(), &[bump]];
    let signer_seeds_outer: &[&[&[u8]]] = &[signer_seeds];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.reward_mint.to_account_info(),
        to: ctx.accounts.user_reward_ata.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds_outer);
    token::mint_to(cpi_ctx, reward)?;

    emit!(Claimed {
        user: ctx.accounts.user.key(),
        reward,
    });

    Ok(())
}
