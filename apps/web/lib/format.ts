import { SCALE } from "@staking-vault/sdk";

/** Converts base units (e.g. lamports of an SPL token) to a trimmed human decimal string. */
export function formatBaseUnits(amount: bigint, decimals: number, maxFractionDigits = decimals): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFractionDigits);
  fracStr = fracStr.replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

/**
 * Parses a human decimal string (e.g. "10.5") typed into an amount field into base units.
 * Returns `null` for anything that isn't a non-negative decimal number, or that has more
 * fractional digits than the mint supports.
 */
export function parseToBaseUnits(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [wholeStr, fracStr = ""] = trimmed.split(".");
  if (fracStr.length > decimals) return null;

  const whole = BigInt(wholeStr);
  const frac = BigInt(fracStr.padEnd(decimals, "0") || "0");
  return whole * 10n ** BigInt(decimals) + frac;
}

/**
 * Reward base units minted per whole staked token per day, as a human decimal string.
 * pool.rewardRate is reward-base-units per staked-base-unit per second, scaled by SCALE
 * (see math.ts / constants.rs) — this converts that to a display-friendly daily rate.
 */
export function humanizeRewardRatePerDay(rewardRate: bigint, stakeDecimals: number, rewardDecimals: number): string {
  const SECONDS_PER_DAY = 86_400n;
  const perTokenPerDayBaseUnits = (rewardRate * SECONDS_PER_DAY * 10n ** BigInt(stakeDecimals)) / SCALE;
  return formatBaseUnits(perTokenPerDayBaseUnits, rewardDecimals, Math.min(rewardDecimals, 6));
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function shortenSignature(signature: string): string {
  return shortenAddress(signature, 6);
}

export function solanaFmTxUrl(signature: string): string {
  return `https://solana.fm/tx/${signature}?cluster=devnet-solana`;
}

export function solanaFmAddressUrl(address: string): string {
  return `https://solana.fm/address/${address}?cluster=devnet-solana`;
}
