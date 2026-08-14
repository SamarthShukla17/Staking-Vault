use core::ops::Range;

use pinocchio::AccountView;
use solana_program_error::ProgramError;

use crate::error::VaultError;

/// Raw 32-byte address, matching the layout `crate::ID` is declared with.
pub type Pubkey = [u8; 32];

const POOL_TAG: u8 = 1;
const STAKE_TAG: u8 = 2;

fn check_account(account: &AccountView, len: usize) -> Result<(), ProgramError> {
    if account.owner().as_ref() != crate::ID.as_ref() {
        return Err(VaultError::InvalidOwner.into());
    }
    if account.data_len() != len {
        return Err(VaultError::InvalidAccount.into());
    }
    Ok(())
}

/// Zero-copy view over a `Pool` account's raw bytes.
///
/// Layout (little-endian, packed, 114 bytes total):
/// `tag(1) | admin(32) | stake_mint(32) | reward_mint(32) | reward_rate(8) | total_staked(8) | bump(1)`
pub struct Pool<'a>(&'a mut [u8]);

impl<'a> Pool<'a> {
    pub const LEN: usize = 114;

    const ADMIN: Range<usize> = 1..33;
    const STAKE_MINT: Range<usize> = 33..65;
    const REWARD_MINT: Range<usize> = 65..97;
    const REWARD_RATE: Range<usize> = 97..105;
    const TOTAL_STAKED: Range<usize> = 105..113;
    const BUMP: usize = 113;

    /// Loads an existing `Pool` account, verifying owner, length, and tag.
    ///
    /// # Safety
    /// Uses `borrow_unchecked_mut` to hand out a raw `&mut [u8]` without the
    /// runtime `RefCell`-style borrow tracking. This is sound as long as the
    /// same account is not concurrently loaded elsewhere in the same
    /// instruction — callers must not load the same account twice.
    pub fn load(account: &'a mut AccountView) -> Result<Self, ProgramError> {
        check_account(account, Self::LEN)?;
        let data = unsafe { account.borrow_unchecked_mut() };
        if data[0] != POOL_TAG {
            return Err(VaultError::InvalidAccount.into());
        }
        Ok(Self(data))
    }

    /// Initializes a `Pool` account, writing the tag and every field once.
    pub fn init(
        account: &'a mut AccountView,
        admin: &Pubkey,
        stake_mint: &Pubkey,
        reward_mint: &Pubkey,
        reward_rate: u64,
        bump: u8,
    ) -> Result<Self, ProgramError> {
        check_account(account, Self::LEN)?;
        let data = unsafe { account.borrow_unchecked_mut() };
        let mut pool = Self(data);
        pool.write_fields(admin, stake_mint, reward_mint, reward_rate, bump);
        Ok(pool)
    }

    fn write_fields(
        &mut self,
        admin: &Pubkey,
        stake_mint: &Pubkey,
        reward_mint: &Pubkey,
        reward_rate: u64,
        bump: u8,
    ) {
        self.0[0] = POOL_TAG;
        self.0[Self::ADMIN].copy_from_slice(admin);
        self.0[Self::STAKE_MINT].copy_from_slice(stake_mint);
        self.0[Self::REWARD_MINT].copy_from_slice(reward_mint);
        self.0[Self::REWARD_RATE].copy_from_slice(&reward_rate.to_le_bytes());
        self.0[Self::TOTAL_STAKED].copy_from_slice(&0u64.to_le_bytes());
        self.0[Self::BUMP] = bump;
    }

    pub fn admin(&self) -> &Pubkey {
        self.0[Self::ADMIN].try_into().unwrap()
    }

    pub fn stake_mint(&self) -> &Pubkey {
        self.0[Self::STAKE_MINT].try_into().unwrap()
    }

    pub fn reward_mint(&self) -> &Pubkey {
        self.0[Self::REWARD_MINT].try_into().unwrap()
    }

    pub fn reward_rate(&self) -> u64 {
        u64::from_le_bytes(self.0[Self::REWARD_RATE].try_into().unwrap())
    }

    pub fn total_staked(&self) -> u64 {
        u64::from_le_bytes(self.0[Self::TOTAL_STAKED].try_into().unwrap())
    }

    pub fn bump(&self) -> u8 {
        self.0[Self::BUMP]
    }

    pub fn set_reward_rate(&mut self, reward_rate: u64) {
        self.0[Self::REWARD_RATE].copy_from_slice(&reward_rate.to_le_bytes());
    }

    pub fn set_total_staked(&mut self, total_staked: u64) {
        self.0[Self::TOTAL_STAKED].copy_from_slice(&total_staked.to_le_bytes());
    }
}

/// Zero-copy view over a `StakeAccount` account's raw bytes.
///
/// Layout (little-endian, packed, 66 bytes total):
/// `tag(1) | owner(32) | amount(8) | points(16) | last_update_ts(8) | bump(1)`
pub struct StakeAccount<'a>(&'a mut [u8]);

impl<'a> StakeAccount<'a> {
    pub const LEN: usize = 66;

    const OWNER: Range<usize> = 1..33;
    const AMOUNT: Range<usize> = 33..41;
    const POINTS: Range<usize> = 41..57;
    const LAST_UPDATE_TS: Range<usize> = 57..65;
    const BUMP: usize = 65;

    /// Loads an existing `StakeAccount`, verifying owner, length, and tag.
    ///
    /// # Safety
    /// See [`Pool::load`]: the same account must not be loaded twice within
    /// one instruction.
    pub fn load(account: &'a mut AccountView) -> Result<Self, ProgramError> {
        check_account(account, Self::LEN)?;
        let data = unsafe { account.borrow_unchecked_mut() };
        if data[0] != STAKE_TAG {
            return Err(VaultError::InvalidAccount.into());
        }
        Ok(Self(data))
    }

    /// Initializes a `StakeAccount`, writing the tag and every field once.
    pub fn init(
        account: &'a mut AccountView,
        owner: &Pubkey,
        amount: u64,
        last_update_ts: i64,
        bump: u8,
    ) -> Result<Self, ProgramError> {
        check_account(account, Self::LEN)?;
        let data = unsafe { account.borrow_unchecked_mut() };
        let mut stake = Self(data);
        stake.write_fields(owner, amount, last_update_ts, bump);
        Ok(stake)
    }

    fn write_fields(&mut self, owner: &Pubkey, amount: u64, last_update_ts: i64, bump: u8) {
        self.0[0] = STAKE_TAG;
        self.0[Self::OWNER].copy_from_slice(owner);
        self.0[Self::AMOUNT].copy_from_slice(&amount.to_le_bytes());
        self.0[Self::POINTS].copy_from_slice(&0u128.to_le_bytes());
        self.0[Self::LAST_UPDATE_TS].copy_from_slice(&last_update_ts.to_le_bytes());
        self.0[Self::BUMP] = bump;
    }

    pub fn owner(&self) -> &Pubkey {
        self.0[Self::OWNER].try_into().unwrap()
    }

    pub fn amount(&self) -> u64 {
        u64::from_le_bytes(self.0[Self::AMOUNT].try_into().unwrap())
    }

    pub fn points(&self) -> u128 {
        u128::from_le_bytes(self.0[Self::POINTS].try_into().unwrap())
    }

    pub fn last_update_ts(&self) -> i64 {
        i64::from_le_bytes(self.0[Self::LAST_UPDATE_TS].try_into().unwrap())
    }

    pub fn bump(&self) -> u8 {
        self.0[Self::BUMP]
    }

    pub fn set_amount(&mut self, amount: u64) {
        self.0[Self::AMOUNT].copy_from_slice(&amount.to_le_bytes());
    }

    pub fn set_points(&mut self, points: u128) {
        self.0[Self::POINTS].copy_from_slice(&points.to_le_bytes());
    }

    pub fn set_last_update_ts(&mut self, last_update_ts: i64) {
        self.0[Self::LAST_UPDATE_TS].copy_from_slice(&last_update_ts.to_le_bytes());
    }
}

/// Points accrued for `amount` staked over `elapsed` seconds at `rate`, added to `points`.
///
/// Pure function over checked `u128` math; returns `None` on overflow (including
/// a negative `elapsed`, which the caller should have already rejected as
/// [`VaultError::ClockWentBackwards`]).
pub fn accrue_points(amount: u64, elapsed: i64, rate: u64, points: u128) -> Option<u128> {
    if elapsed < 0 {
        return None;
    }
    let delta = (amount as u128)
        .checked_mul(elapsed as u128)?
        .checked_mul(rate as u128)?;
    points.checked_add(delta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_pubkey(fill: u8) -> Pubkey {
        [fill; 32]
    }

    #[test]
    fn pool_len_is_114() {
        assert_eq!(Pool::LEN, 114);
    }

    #[test]
    fn stake_account_len_is_66() {
        assert_eq!(StakeAccount::LEN, 66);
    }

    #[test]
    fn pool_round_trip_and_offsets() {
        let admin = sample_pubkey(0x11);
        let stake_mint = sample_pubkey(0x22);
        let reward_mint = sample_pubkey(0x33);
        let reward_rate: u64 = 0x0102030405060708;
        let bump: u8 = 0xAB;

        let mut buf = [0u8; Pool::LEN];
        {
            let mut pool = Pool(&mut buf);
            pool.write_fields(&admin, &stake_mint, &reward_mint, reward_rate, bump);

            assert_eq!(pool.admin(), &admin);
            assert_eq!(pool.stake_mint(), &stake_mint);
            assert_eq!(pool.reward_mint(), &reward_mint);
            assert_eq!(pool.reward_rate(), reward_rate);
            assert_eq!(pool.total_staked(), 0);
            assert_eq!(pool.bump(), bump);

            pool.set_total_staked(999);
            pool.set_reward_rate(42);
            assert_eq!(pool.total_staked(), 999);
            assert_eq!(pool.reward_rate(), 42);
        }

        // Hardcoded offsets — a silent layout shift fails these regardless of
        // whatever range constants the implementation happens to use.
        assert_eq!(buf[0], 1); // tag
        assert_eq!(&buf[1..33], &admin);
        assert_eq!(&buf[33..65], &stake_mint);
        assert_eq!(&buf[65..97], &reward_mint);
        assert_eq!(u64::from_le_bytes(buf[97..105].try_into().unwrap()), 42);
        assert_eq!(u64::from_le_bytes(buf[105..113].try_into().unwrap()), 999);
        assert_eq!(buf[113], bump);
    }

    #[test]
    fn stake_account_round_trip_and_offsets() {
        let owner = sample_pubkey(0x44);
        let amount: u64 = 0x1122334455667788;
        let last_update_ts: i64 = -12345;
        let bump: u8 = 0xCD;

        let mut buf = [0u8; StakeAccount::LEN];
        {
            let mut stake = StakeAccount(&mut buf);
            stake.write_fields(&owner, amount, last_update_ts, bump);

            assert_eq!(stake.owner(), &owner);
            assert_eq!(stake.amount(), amount);
            assert_eq!(stake.points(), 0);
            assert_eq!(stake.last_update_ts(), last_update_ts);
            assert_eq!(stake.bump(), bump);

            stake.set_amount(amount / 2);
            stake.set_points(u128::MAX);
            stake.set_last_update_ts(555);
            assert_eq!(stake.amount(), amount / 2);
            assert_eq!(stake.points(), u128::MAX);
            assert_eq!(stake.last_update_ts(), 555);
        }

        assert_eq!(buf[0], 2); // tag
        assert_eq!(&buf[1..33], &owner);
        assert_eq!(
            u64::from_le_bytes(buf[33..41].try_into().unwrap()),
            amount / 2
        );
        assert_eq!(u128::from_le_bytes(buf[41..57].try_into().unwrap()), u128::MAX);
        assert_eq!(i64::from_le_bytes(buf[57..65].try_into().unwrap()), 555);
        assert_eq!(buf[65], bump);
    }

    #[test]
    fn accrue_points_adds_amount_times_elapsed_times_rate() {
        assert_eq!(accrue_points(100, 10, 5, 0), Some(100u128 * 10 * 5));
    }

    #[test]
    fn accrue_points_adds_onto_existing_points() {
        assert_eq!(accrue_points(100, 10, 5, 42), Some(100u128 * 10 * 5 + 42));
    }

    #[test]
    fn accrue_points_with_zero_elapsed_adds_zero() {
        assert_eq!(accrue_points(500, 0, 7, 100), Some(100));
    }

    #[test]
    fn accrue_points_negative_elapsed_returns_none() {
        assert_eq!(accrue_points(100, -1, 5, 0), None);
    }

    #[test]
    fn accrue_points_succeeds_at_largest_representable_product() {
        // u64::MAX * 1 * u64::MAX is the largest product two u64 factors (amount, rate)
        // can produce, and it still fits under u128::MAX.
        assert_eq!(
            accrue_points(u64::MAX, 1, u64::MAX, 0),
            Some((u64::MAX as u128) * (u64::MAX as u128))
        );
    }

    #[test]
    fn accrue_points_overflows_on_amount_elapsed_product() {
        // u64::MAX * 2 * u64::MAX = 2 * (2^128 - 2^65 + 1) > u128::MAX.
        assert_eq!(accrue_points(u64::MAX, 2, u64::MAX, 0), None);
    }

    #[test]
    fn accrue_points_overflows_on_final_add() {
        assert_eq!(accrue_points(1, 1, 1, u128::MAX), None);
    }
}
