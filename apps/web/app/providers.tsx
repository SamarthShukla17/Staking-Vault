"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// The wallet-adapter tree reaches for `window` (extension detection, local wallet state) as
// soon as it mounts, so it must never render on the server — ssr:false is only valid inside a
// Client Component boundary, which is why this thin wrapper exists.
const WalletProviders = dynamic(() => import("./wallet-providers"), { ssr: false });

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
