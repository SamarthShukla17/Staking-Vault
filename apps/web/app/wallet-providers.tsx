"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import { config } from "@/lib/config";

const FALLBACK_ENDPOINT = "https://api.devnet.solana.com";

/**
 * The actual wallet-adapter context tree. Lives in its own module (rather than inline in
 * providers.tsx) so it can be loaded via `next/dynamic(..., { ssr: false })` — the wallet
 * adapters touch `window` at construction time and must never run during server rendering.
 */
export default function WalletProviders({ children }: { children: ReactNode }) {
  const endpoint = config?.rpcUrl ?? FALLBACK_ENDPOINT;
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
