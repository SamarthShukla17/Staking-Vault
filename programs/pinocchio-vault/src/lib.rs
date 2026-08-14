#![no_std]

pub mod error;
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
    _accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (tag, _data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match tag {
        0 => process_init(),
        1 => process_stake(),
        2 => process_unstake(),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn process_init() -> ProgramResult {
    Ok(())
}

fn process_stake() -> ProgramResult {
    Ok(())
}

fn process_unstake() -> ProgramResult {
    Ok(())
}