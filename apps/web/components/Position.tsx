"use client";

import { Coins, Lock, Sparkles } from "lucide-react";
import type { StakeAccountState } from "@staking-vault/sdk";

import { Card } from "@/components/Card";
import { formatBaseUnits } from "@/lib/format";

export interface PositionProps {
  connected: boolean;
  stakeAccount: StakeAccountState | null;
  /** Claimable rewards (base units), ticked forward every second by the parent via math.ts. */
  claimable: bigint;
  stakeDecimals: number;
  rewardDecimals: number;
  loading: boolean;
}

export function Position({ connected, stakeAccount, claimable, stakeDecimals, rewardDecimals, loading }: PositionProps) {
  return (
    <Card delay={0.1}>
      <h2 className="mb-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">
        <Sparkles className="h-3.5 w-3.5" />
        Your position
      </h2>

      {!connected ? (
        <p className="text-sm text-neutral-500">Connect your wallet to see your staked balance and rewards.</p>
      ) : loading && !stakeAccount ? (
        <div className="space-y-3">
          <div className="h-8 w-32 animate-shimmer rounded-lg bg-shimmer" />
          <div className="h-8 w-32 animate-shimmer rounded-lg bg-shimmer" />
        </div>
      ) : !stakeAccount ? (
        <p className="text-sm text-neutral-500">You haven&apos;t staked yet. Stake TEST below to start earning RWD.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
            <dt className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Lock className="h-3 w-3" />
              Staked
            </dt>
            <dd className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-neutral-50 sm:text-2xl">
              {formatBaseUnits(stakeAccount.amount, stakeDecimals)}
              <span className="ml-1 text-sm font-normal text-neutral-500">TEST</span>
            </dd>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3.5">
            <dt className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Coins className="h-3 w-3" />
              Claimable
            </dt>
            <dd className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-emerald-400 sm:text-2xl">
              {formatBaseUnits(claimable, rewardDecimals)}
              <span className="ml-1 text-sm font-normal text-neutral-500">RWD</span>
            </dd>
          </div>
        </div>
      )}
    </Card>
  );
}
