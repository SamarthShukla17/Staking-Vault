use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{POOL_SEED, STAKE_SEED};
use crate::errors::ErrorCode;
use crate::events::Staked;
use crate::state::{Pool, StakeAccount};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, pool.stake_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, Pool>,

    // SAFETY: seeds bind this PDA to `user` (seeds = [STAKE_SEED, pool, user]), so the
    // address Anchor derives and requires here is unique to `user`. A second signer can
    // never point this account slot at someone else's StakeAccount, and the handler only
    // ever writes owner/points/last_update_ts/bump the first time the account is created
    // (guarded by the `owner == Pubkey::default()` check below) — so init_if_needed cannot
    // be used to reset another user's state. `pool`, by contrast, never uses
    // init_if_needed, so it carries no equivalent risk.
    #[account(
        init_if_needed,
        payer = user,
        space = StakeAccount::LEN,
        seeds = [STAKE_SEED, pool.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        mut,
        associated_token::mint = pool.stake_mint,
        associated_token::authority = user,
    )]
    pub user_stake_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = pool.stake_mint,
        token::authority = pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    let user_key = ctx.accounts.user.key();
    let reward_rate = ctx.accounts.pool.reward_rate;

    let is_new = ctx.accounts.stake_account.owner == Pubkey::default();
    if is_new {
        ctx.accounts.stake_account.owner = user_key;
        ctx.accounts.stake_account.points = 0;
        ctx.accounts.stake_account.last_update_ts = now;
        ctx.accounts.stake_account.bump = ctx.bumps.stake_account;
    } else {
        require_keys_eq!(ctx.accounts.stake_account.owner, user_key);
    }

    // accrue BEFORE mutating `amount` so the new stake doesn't retroactively earn points
    // for time that elapsed before it was deposited.
    ctx.accounts.stake_account.accrue(reward_rate, now)?;

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_stake_ata.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    ctx.accounts.stake_account.amount = ctx
        .accounts
        .stake_account
        .amount
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    ctx.accounts.pool.total_staked = ctx
        .accounts
        .pool
        .total_staked
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    emit!(Staked {
        user: user_key,
        amount,
        total_staked: ctx.accounts.pool.total_staked,
    });

    Ok(())
}
