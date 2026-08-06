"use client";

import type { PoolAccount } from "@staking-vault/sdk";
import { Layers, TrendingUp } from "lucide-react";

import { Card } from "@/components/Card";
import { formatBaseUnits, humanizeRewardRatePerDay, shortenAddress, solanaFmAddressUrl } from "@/lib/format";

export interface PoolStatsProps {
  pool: PoolAccount | null;
  /** Raw balance of the vault's stake-mint token account, in base units. */
  vaultBalance: bigint | null;
  stakeDecimals: number;
  rewardDecimals: number;
  loading: boolean;
}

export function PoolStats({ pool, vaultBalance, stakeDecimals, rewardDecimals, loading }: PoolStatsProps) {
  return (
    <Card delay={0.05}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          <Layers className="h-3.5 w-3.5" />
          Pool
        </h2>
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-neutral-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-amber-400" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
          Devnet
        </span>
      </div>

      {loading && !pool ? (
        <div className="space-y-3">
          <div className="h-8 w-40 animate-shimmer rounded-lg bg-shimmer" />
          <div className="h-5 w-56 animate-shimmer rounded-lg bg-shimmer" />
        </div>
      ) : !pool ? (
        <p className="text-sm text-neutral-500">
          No pool found for this stake mint yet. Run{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-neutral-400">yarn setup:devnet</code> to
          create one.
        </p>
      ) : (
        <dl className="space-y-4">
          <div>
            <dt className="text-xs text-neutral-500">Total staked (TVL)</dt>
            <dd className="font-mono text-3xl font-semibold tabular-nums text-neutral-50">
              {vaultBalance === null ? "…" : formatBaseUnits(vaultBalance, stakeDecimals)}{" "}
              <span className="text-base font-normal text-neutral-500">TEST</span>
            </dd>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
            <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" />
            <dd className="font-mono text-sm font-medium text-neutral-100">
              {humanizeRewardRatePerDay(pool.rewardRate, stakeDecimals, rewardDecimals)}{" "}
              <span className="font-sans font-normal text-neutral-500">RWD / TEST / day</span>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-neutral-500">
            <a
              href={solanaFmAddressUrl(pool.stakeMint.toBase58())}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-neutral-200"
            >
              Stake: {shortenAddress(pool.stakeMint.toBase58())} ↗
            </a>
            <a
              href={solanaFmAddressUrl(pool.rewardMint.toBase58())}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-neutral-200"
            >
              Reward: {shortenAddress(pool.rewardMint.toBase58())} ↗
            </a>
          </div>
        </dl>
      )}
    </Card>
  );
}
