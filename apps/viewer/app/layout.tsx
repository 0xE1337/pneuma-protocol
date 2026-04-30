import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export const metadata: Metadata = {
  title: "AgentVault — Cross-platform Soul Reader",
  description:
    "An independent dApp that reads any Soul's contribution history directly from the Pneuma protocol. Not affiliated with Pneuma Hub.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>
          <header className="sticky top-0 z-40 border-b border-amber/25 bg-paper/85 backdrop-blur-xl">
            <div className="max-w-6xl mx-auto px-8 h-[72px] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-gradient-to-br from-amber to-amber-deep flex items-center justify-center text-paper font-bold font-mono text-sm shadow-warm">
                  AV
                </div>
                <div className="flex flex-col">
                  <span className="font-mono font-semibold text-ink text-base leading-tight">AgentVault</span>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                    Cross-platform Soul Reader · Independent dApp
                  </span>
                </div>
              </div>
              <ClientConnect />
            </div>
          </header>
          <main>{children}</main>
          <footer className="mt-32 border-t border-amber/25">
            <div className="max-w-6xl mx-auto px-8 py-12 text-center text-[11px] uppercase tracking-[0.13em] text-ink-faint font-mono">
              AgentVault is an independent dApp · We don't host or manage Pneuma · We just read on-chain attestations directly
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

function ClientConnect() {
  return <ConnectButton showBalance={false} chainStatus="icon" />;
}
