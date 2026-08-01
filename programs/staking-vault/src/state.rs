use anchor_lang::prelude::*;

use crate::errors::ErrorCode;

#[account]
pub struct Pool {
    pub admin: Pubkey,
    pub stake_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_rate: u64,
    pub total_staked: u64,
    pub bump: u8,
}

impl Pool {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub amount: u64,
    pub points: u128,
    pub last_update_ts: i64,
    pub bump: u8,
}

impl StakeAccount {
    pub const LEN: usize = 8 + 32 + 8 + 16 + 8 + 1;

    /// Accrues points for the elapsed time since `last_update_ts` and advances the checkpoint to `now`.
    pub fn accrue(&mut self, rate: u64, now: i64) -> Result<()> {
        require!(now >= self.last_update_ts, ErrorCode::ClockWentBackwards);

        let elapsed = (now - self.last_update_ts) as u128;
        let delta = (self.amount as u128)
            .checked_mul(elapsed)
            .and_then(|v| v.checked_mul(rate as u128))
            .ok_or(ErrorCode::MathOverflow)?;

        self.points = self.points.checked_add(delta).ok_or(ErrorCode::MathOverflow)?;
        self.last_update_ts = now;
        Ok(())
    }

    /// Read-only, saturating projection of `accrue`'s points for the elapsed time since `last_update_ts`.
    pub fn pending(&self, rate: u64, now: i64) -> u128 {
        let elapsed = now.saturating_sub(self.last_update_ts).max(0) as u128;
        let delta = (self.amount as u128)
            .saturating_mul(elapsed)
            .saturating_mul(rate as u128);
        self.points.saturating_add(delta)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(amount: u64, points: u128, last_update_ts: i64) -> StakeAccount {
        StakeAccount {
            owner: Pubkey::default(),
            amount,
            points,
            last_update_ts,
            bump: 0,
        }
    }

    #[test]
    fn accrue_adds_amount_times_elapsed_times_rate() {
        let mut acc = account(100, 0, 0);
        acc.accrue(5, 10).unwrap();
        assert_eq!(acc.points, 100u128 * 10 * 5);
        assert_eq!(acc.last_update_ts, 10);
    }

    #[test]
    fn accrue_with_zero_amount_adds_zero() {
        let mut acc = account(0, 42, 0);
        acc.accrue(5, 10).unwrap();
        assert_eq!(acc.points, 42);
        assert_eq!(acc.last_update_ts, 10);
    }

    #[test]
    fn accrue_with_zero_elapsed_adds_zero() {
        let mut acc = account(500, 100, 20);
        acc.accrue(7, 20).unwrap();
        assert_eq!(acc.points, 100);
        assert_eq!(acc.last_update_ts, 20);
    }

    #[test]
    fn accrue_with_zero_rate_adds_zero() {
        let mut acc = account(500, 100, 0);
        acc.accrue(0, 50).unwrap();
        assert_eq!(acc.points, 100);
        assert_eq!(acc.last_update_ts, 50);
    }

    #[test]
    fn accrue_succeeds_at_the_largest_representable_product() {
        // u64::MAX * 1 * u64::MAX is the largest product two u64 factors (amount, rate) can ever
        // produce, and it still fits under u128::MAX (u64::MAX^2 = 2^128 - 2^65 + 1 < 2^128 - 1)
        // — proving the u128 intermediate has headroom for the true worst case, not just typical
        // values.
        let mut acc = account(u64::MAX, 0, 0);
        acc.accrue(u64::MAX, 1).unwrap();
        assert_eq!(acc.points, (u64::MAX as u128) * (u64::MAX as u128));
    }

    #[test]
    fn pending_with_max_values_does_not_panic() {
        let acc = account(u64::MAX, 0, 0);
        let result = acc.pending(u64::MAX, i64::MAX);
        assert_eq!(result, u128::MAX);
    }

    #[test]
    fn accrue_returns_math_overflow_at_boundary() {
        let mut acc = account(u64::MAX, 0, 0);
        let err = acc.accrue(u64::MAX, 2).unwrap_err();
        assert!(err.to_string().contains("Math operation overflowed"));
    }

    #[test]
    fn accrue_returns_clock_went_backwards() {
        let mut acc = account(100, 0, 10);
        let err = acc.accrue(5, 5).unwrap_err();
        assert!(err.to_string().contains("Clock went backwards"));
    }

    #[test]
    fn workspace_release_profile_has_overflow_checks_enabled() {
        // accrue()'s checked_* calls are the primary defense against silent wraparound, but
        // `overflow-checks = true` on [profile.release] is the backstop for any arithmetic
        // elsewhere in the crate (including dependencies) that isn't already checked_*. Parsed
        // as plain text rather than pulling in a TOML crate just for this one assertion.
        let workspace_cargo_toml = include_str!("../../../Cargo.toml");
        let release_start = workspace_cargo_toml
            .find("[profile.release]")
            .expect("workspace Cargo.toml must have a [profile.release] section");
        let after = &workspace_cargo_toml[release_start..];
        let release_section_end = after[1..].find('[').map(|i| i + 1).unwrap_or(after.len());
        let release_section = &after[..release_section_end];

        assert!(
            release_section
                .lines()
                .any(|line| line.trim() == "overflow-checks = true"),
            "[profile.release] must set `overflow-checks = true`, got:\n{release_section}"
        );
    }
}
