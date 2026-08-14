use solana_program_error::ProgramError;

/// Custom errors for pinocchio-vault, surfaced to clients as
/// `ProgramError::Custom(code)` with `code` equal to the discriminant below.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum VaultError {
    /// 0: amount must be greater than zero.
    ZeroAmount = 0,
    /// 1: stake account does not hold enough to cover the requested unstake.
    InsufficientStake = 1,
    /// 2: a checked arithmetic operation overflowed.
    MathOverflow = 2,
    /// 3: account data length or tag byte did not match the expected layout.
    InvalidAccount = 3,
    /// 4: account is not owned by this program.
    InvalidOwner = 4,
    /// 5: the on-chain clock moved backwards relative to the last checkpoint.
    ClockWentBackwards = 5,
}

impl From<VaultError> for ProgramError {
    fn from(e: VaultError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
