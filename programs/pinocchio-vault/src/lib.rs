#![no_std]

pub mod error;
pub mod instructions;
pub mod state;

use pinocchio::{
    program_entrypoint, default_allocator, nostd_panic_handler,
    AccountView, Address, ProgramResult,
};
use solana_program_error::ProgramError;

pinocchio_pubkey::declare_id!("GfNQXKxE2CzdeE4BLHZBUSYBQYDPCyg6bRs8dqe5af7u");

program_entrypoint!(process_instruction);
default_allocator!();
nostd_panic_handler!();

pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match tag {
        0 => instructions::initialize::process(accounts, data),
        1 => instructions::stake::process(accounts, data),
        2 => instructions::unstake::process(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}