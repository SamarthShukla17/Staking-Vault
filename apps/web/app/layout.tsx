import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";

import { Background } from "@/components/Background";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Staking Vault",
  description: "Stake TEST, earn RWD — devnet staking vault.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="relative min-h-screen bg-black font-sans text-neutral-200 antialiased">
        <Background />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
