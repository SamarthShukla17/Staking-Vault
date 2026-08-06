"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { getMint } from "@solana/spl-token";
import {
  associatedTokenAddress,
  claimableRewards,
  pool as poolPda,
  vaultAta as vaultAtaPda,
  type PoolAccount,
  type StakeAccountState,
} from "@staking-vault/sdk";
import { motion } from "framer-motion";
import { AlertTriangle, Coins, Layers } from "lucide-react";

import { PoolStats } from "@/components/PoolStats";
import { Position } from "@/components/Position";
import { StakeForm } from "@/components/StakeForm";
import { TxToastProvider } from "@/components/TxToast";
import { useVaultClient } from "@/lib/client";
import { config, configIssues } from "@/lib/config";
import { shortenAddress, solanaFmAddressUrl } from "@/lib/format";

function ConfigBanner() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full rounded-xl border border-red-500/25 bg-[#0a0a0a] p-6"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <h1 className="text-lg font-semibold text-red-300">Missing configuration</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          This app needs the following environment variables before it can run. Copy{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-neutral-200">.env.example</code> to{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-neutral-200">.env.local</code>, fill in the
          values, and restart the dev server.
        </p>
        <ul className="mt-4 space-y-1.5 font-mono text-sm text-red-300/80">
          {configIssues.map((issue) => (
            <li key={issue.field}>
              <span className="text-red-200">{issue.field}</span>{" "}
              <span className="text-red-400/60">— {issue.message}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

function VaultApp() {
  // Only rendered by the default export after confirming config !== null.
  const cfg = config!;
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { client } = useVaultClient();

  const [pool, setPool] = useState<PoolAccount | null>(null);
  const [stakeAccount, setStakeAccount] = useState<StakeAccountState | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint | null>(null);
  const [walletStakeBalance, setWalletStakeBalance] = useState<bigint | null>(null);
  const [stakeDecimals, setStakeDecimals] = useState(9);
  const [rewardDecimals, setRewardDecimals] = useState(9);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [poolData, stakeMintInfo] = await Promise.all([
        client.getPool(cfg.stakeMint),
        getMint(connection, cfg.stakeMint).catch(() => null),
      ]);
      setPool(poolData);
      if (stakeMintInfo) setStakeDecimals(stakeMintInfo.decimals);

      const [poolPk] = poolPda(cfg.stakeMint);
      const [vaultAtaPk] = vaultAtaPda(poolPk, cfg.stakeMint);

      const pending: Promise<unknown>[] = [
        connection
          .getTokenAccountBalance(vaultAtaPk)
          .then((res) => setVaultBalance(BigInt(res.value.amount)))
          .catch(() => setVaultBalance(0n)),
      ];

      if (poolData) {
        pending.push(
          getMint(connection, poolData.rewardMint)
            .then((m) => setRewardDecimals(m.decimals))
            .catch(() => undefined),
        );
      }

      if (publicKey) {
        pending.push(client.getStakeAccount(cfg.stakeMint, publicKey).then(setStakeAccount));

        const [userAta] = associatedTokenAddress(cfg.stakeMint, publicKey);
        pending.push(
          connection
            .getTokenAccountBalance(userAta)
            .then((res) => setWalletStakeBalance(BigInt(res.value.amount)))
            .catch(() => setWalletStakeBalance(0n)),
        );
      } else {
        setStakeAccount(null);
        setWalletStakeBalance(null);
      }

      await Promise.all(pending);
    } finally {
      setLoading(false);
    }
  }, [client, connection, cfg.stakeMint, publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Ticks the displayed claimable amount forward once a second, purely off the last-fetched
  // pool/stakeAccount snapshot via math.ts — no RPC calls on this interval. Owned here (rather
  // than inside Position) so the Claim button in Actions shares the exact same live number.
  const [nowTs, setNowTs] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = setInterval(() => setNowTs(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, []);

  const claimable = useMemo(() => {
    if (!pool || !stakeAccount) return 0n;
    const now = nowTs < stakeAccount.lastUpdateTs ? stakeAccount.lastUpdateTs : nowTs;
    return claimableRewards({
      amount: stakeAccount.amount,
      points: stakeAccount.points,
      lastUpdateTs: stakeAccount.lastUpdateTs,
      rewardRate: pool.rewardRate,
      nowTs: now,
    });
  }, [pool, stakeAccount, nowTs]);

  const noTestBalance = connected && walletStakeBalance === 0n;

  return (
    <div className="relative mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8 flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white">
            <Layers className="h-4.5 w-4.5 text-black" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-50 sm:text-xl">Staking Vault</h1>
            <p className="text-xs text-neutral-500 sm:text-sm">Stake TEST, earn RWD.</p>
          </div>
        </div>
        <WalletMultiButton />
      </motion.header>

      {noTestBalance && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-6 flex gap-3 rounded-xl border border-amber-500/25 bg-[#0a0a0a] px-4 py-3.5 text-sm text-neutral-300"
        >
          <Coins className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="leading-relaxed">
            You don&apos;t have any TEST tokens yet. Request some for the stake mint{" "}
            <a
              href={solanaFmAddressUrl(cfg.stakeMint.toBase58())}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-amber-300 underline decoration-amber-400/40 underline-offset-2 hover:text-amber-200"
            >
              {shortenAddress(cfg.stakeMint.toBase58())}
            </a>{" "}
            — run{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-neutral-200">
              yarn setup:devnet -- --mint-to &lt;your address&gt; 100
            </code>{" "}
            from the repo, or ask whoever runs the pool to send you some.
          </p>
        </motion.div>
      )}

      <div className="space-y-4">
        <PoolStats
          pool={pool}
          vaultBalance={vaultBalance}
          stakeDecimals={stakeDecimals}
          rewardDecimals={rewardDecimals}
          loading={loading}
        />
        <Position
          connected={connected}
          stakeAccount={stakeAccount}
          claimable={claimable}
          stakeDecimals={stakeDecimals}
          rewardDecimals={rewardDecimals}
          loading={loading}
        />
        <StakeForm
          connected={connected}
          poolExists={pool !== null}
          client={client}
          stakeMint={cfg.stakeMint}
          stakeDecimals={stakeDecimals}
          rewardDecimals={rewardDecimals}
          walletStakeBalance={walletStakeBalance}
          stakedAmount={stakeAccount?.amount ?? 0n}
          claimable={claimable}
          onSuccess={refresh}
        />
      </div>
    </div>
  );
}

export default function Page() {
  if (!config) {
    return <ConfigBanner />;
  }

  return (
    <TxToastProvider>
      <VaultApp />
    </TxToastProvider>
  );
}
