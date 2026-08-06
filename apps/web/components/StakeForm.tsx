"use client";

import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { motion } from "framer-motion";
import { ArrowDownToLine, ArrowUpFromLine, Coins, Loader2, Sparkle } from "lucide-react";
import { z } from "zod";
import type { StakingVaultClient } from "@staking-vault/sdk";

import { Card } from "@/components/Card";
import { useTxToast } from "@/components/TxToast";
import { formatBaseUnits, parseToBaseUnits } from "@/lib/format";

export interface StakeFormProps {
  connected: boolean;
  poolExists: boolean;
  client: StakingVaultClient;
  stakeMint: PublicKey;
  stakeDecimals: number;
  rewardDecimals: number;
  /** Wallet's TEST balance in base units, or null while unknown/loading. */
  walletStakeBalance: bigint | null;
  /** Currently staked amount in base units. */
  stakedAmount: bigint;
  /** Currently projected claimable rewards in base units (ticking, from Position). */
  claimable: bigint;
  /** Re-fetches pool/stakeAccount/balances after a transaction confirms. */
  onSuccess: () => Promise<void>;
}

type Mode = "stake" | "unstake" | "claim";

const MODES: { key: Mode; label: string; icon: typeof ArrowDownToLine }[] = [
  { key: "stake", label: "Stake", icon: ArrowDownToLine },
  { key: "unstake", label: "Unstake", icon: ArrowUpFromLine },
  { key: "claim", label: "Claim", icon: Coins },
];

const CTA_STYLES: Record<Mode, string> = {
  stake: "bg-white text-black hover:opacity-90",
  unstake: "border border-white/20 bg-transparent text-neutral-100 hover:bg-white/5",
  claim: "bg-emerald-500 text-black hover:bg-emerald-400",
};

function buildAmountSchema(decimals: number, max: bigint) {
  return z
    .string()
    .trim()
    .min(1, "Enter an amount")
    .regex(/^\d+(\.\d+)?$/, "Enter a valid number")
    .transform((value, ctx) => {
      const base = parseToBaseUnits(value, decimals);
      if (base === null) {
        ctx.addIssue({ code: "custom", message: `Up to ${decimals} decimal places` });
        return z.NEVER;
      }
      return base;
    })
    .refine((value) => value > 0n, "Amount must be greater than zero")
    .refine((value) => value <= max, "Amount exceeds available balance");
}

export function StakeForm({
  connected,
  poolExists,
  client,
  stakeMint,
  stakeDecimals,
  rewardDecimals,
  walletStakeBalance,
  stakedAmount,
  claimable,
  onSuccess,
}: StakeFormProps) {
  const { track } = useTxToast();
  const [mode, setMode] = useState<Mode>("stake");
  const [amountInput, setAmountInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const maxForMode = mode === "stake" ? walletStakeBalance ?? 0n : stakedAmount;
  const disabledCard = !connected || !poolExists || submitting;

  function switchMode(next: Mode) {
    setMode(next);
    setAmountInput("");
    setError(null);
  }

  function setMax() {
    setAmountInput(formatBaseUnits(maxForMode, stakeDecimals));
    setError(null);
  }

  async function submitAmountAction(kind: "stake" | "unstake") {
    const schema = buildAmountSchema(stakeDecimals, maxForMode);
    const result = schema.safeParse(amountInput);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid amount");
      return;
    }

    setError(null);
    setSubmitting(true);
    const amount = result.data;
    const label = `${kind === "stake" ? "Stake" : "Unstake"} ${formatBaseUnits(amount, stakeDecimals)} TEST`;
    try {
      await track(label, () => (kind === "stake" ? client.stake(stakeMint, amount) : client.unstake(stakeMint, amount)));
      setAmountInput("");
      await onSuccess();
    } catch {
      // The toast already surfaces the failure; nothing further to do here.
    } finally {
      setSubmitting(false);
    }
  }

  async function submitClaim() {
    setError(null);
    setSubmitting(true);
    try {
      await track("Claim rewards", () => client.claim(stakeMint));
      await onSuccess();
    } catch {
      // Toast surfaces the failure.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card delay={0.15}>
      <h2 className="mb-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">
        <Sparkle className="h-3.5 w-3.5" />
        Actions
      </h2>

      <div className="relative mb-5 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchMode(key)}
            className={`relative z-10 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === key ? "text-black" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {mode === key && (
              <motion.div
                layoutId="stakeform-tab-pill"
                className="absolute inset-0 -z-10 rounded-md bg-white"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {mode === "claim" ? (
        <div>
          <p className="mb-3 text-sm text-neutral-400">
            Claimable:{" "}
            <span className="font-mono font-medium text-emerald-400">
              {formatBaseUnits(claimable, rewardDecimals)} RWD
            </span>
          </p>
          <button
            type="button"
            disabled={disabledCard || claimable === 0n}
            onClick={submitClaim}
            className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-neutral-600 ${CTA_STYLES.claim}`}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Claiming…" : "Claim rewards"}
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-500">
            <span>Amount (TEST)</span>
            <button
              type="button"
              onClick={setMax}
              disabled={disabledCard}
              className="font-mono text-neutral-300 transition-colors hover:text-white disabled:text-neutral-600"
            >
              Max: {formatBaseUnits(maxForMode, stakeDecimals)}
            </button>
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amountInput}
            disabled={disabledCard}
            onChange={(e) => {
              setAmountInput(e.target.value);
              setError(null);
            }}
            className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-3 font-mono text-lg text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-white/30 disabled:opacity-50"
          />
          {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}

          <button
            type="button"
            disabled={disabledCard || amountInput.trim() === ""}
            onClick={() => submitAmountAction(mode)}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold capitalize transition-colors disabled:cursor-not-allowed disabled:border-0 disabled:bg-white/5 disabled:text-neutral-600 ${CTA_STYLES[mode]}`}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? `${mode === "stake" ? "Staking" : "Unstaking"}…` : mode}
          </button>
        </div>
      )}

      {!connected && <p className="mt-3 text-xs text-neutral-500">Connect your wallet to enable actions.</p>}
      {connected && !poolExists && (
        <p className="mt-3 text-xs text-neutral-500">This pool hasn&apos;t been initialized yet.</p>
      )}
    </Card>
  );
}
