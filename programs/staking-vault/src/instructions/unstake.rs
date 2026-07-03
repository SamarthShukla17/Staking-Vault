use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{POOL_SEED, STAKE_SEED};
use crate::errors::ErrorCode;
use crate::events::Unstaked;
use crate::state::{Pool, StakeAccount};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
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
        token::mint = pool.stake_mint,
        token::authority = user,
    )]
    pub user_stake_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = pool.stake_mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    let reward_rate = ctx.accounts.pool.reward_rate;

    // accrue BEFORE checking/mutating `amount` so the withdrawal doesn't retroactively lose
    // points for time that already elapsed while the balance being removed was staked.
    ctx.accounts.stake_account.accrue(reward_rate, now)?;

    require!(
        ctx.accounts.stake_account.amount >= amount,
        ErrorCode::InsufficientStake
    );

    // The vault is an SPL token account owned by the pool PDA (not a SOL account), precisely
    // so withdrawals must go through a program-signed CPI rather than any direct transfer.
    let stake_mint = ctx.accounts.pool.stake_mint;
    let bump = ctx.accounts.pool.bump;
    let signer_seeds: &[&[u8]] = &[POOL_SEED, stake_mint.as_ref(), &[bump]];
    let signer_seeds_outer: &[&[&[u8]]] = &[signer_seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_stake_ata.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds_outer);
    token::transfer(cpi_ctx, amount)?;

    ctx.accounts.stake_account.amount = ctx
        .accounts
        .stake_account
        .amount
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    ctx.accounts.pool.total_staked = ctx
        .accounts
        .pool
        .total_staked
        .checked_sub(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    emit!(Unstaked {
        user: ctx.accounts.user.key(),
        amount,
        total_staked: ctx.accounts.pool.total_staked,
    });

    Ok(())
}
