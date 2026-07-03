use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient staked amount")]
    InsufficientStake,
    #[msg("Math operation overflowed")]
    MathOverflow,
    #[msg("Invalid mint authority")]
    InvalidMintAuthority,
    #[msg("Clock went backwards")]
    ClockWentBackwards,
}
