"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import {
  USDC_TOKEN,
  UsdcAbi,
  USDC_DECIMALS,
  USDC_FAUCET_URL,
  SOUL_NFT,
  SoulNFTAbi,
  txUrl,
} from "@/lib/contracts";
import { WrongChainBanner } from "@/app/_components/ChainGuard";
import { useI18n } from "@/lib/i18n";

export default function WalletPage() {
  const { t } = useI18n();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [pendingTransfer, setPendingTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [lastTx, setLastTx] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: balanceEOA, refetch: refetchEOA } = useReadContract({
    address: USDC_TOKEN,
    abi: UsdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 4000 },
  });

  const { data: soulBalance } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  async function handleTransfer() {
    if (!walletClient || !publicClient || !address) return;
    setError(null);
    setLastTx(null);
    setPendingTransfer(true);
    try {
      // USDC 是 6 decimals，不是 18
      const amount = parseUnits(transferAmount, USDC_DECIMALS);
      const { request } = await publicClient.simulateContract({
        address: USDC_TOKEN,
        abi: UsdcAbi,
        functionName: "transfer",
        args: [transferTo as Address, amount],
        account: address,
      });
      const tx = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setLastTx(tx);
      setTransferTo("");
      setTransferAmount("");
      refetchEOA();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingTransfer(false);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="neon-streak" data-color="cyan" style={{ top: "200px", left: "8%", width: "84%", height: "5px", transform: "rotate(-7deg)", opacity: 0.35 }} />

      <div className="relative max-w-4xl mx-auto px-8 pt-12 pb-24 space-y-8 animate-fade-in">
        <header className="space-y-3">
          <span className="pill-live">Step 2 of 3</span>
          <h1 className="display text-4xl md:text-5xl">{t("wallet.title")}</h1>
          <p className="text-ink-dim leading-relaxed">{t("wallet.faucet.note")}</p>
        </header>

        <WrongChainBanner />

        {!isConnected ? (
          <div className="surface p-6 text-center text-ink-dim">Connect wallet first.</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <Stat
                label="USDC balance (your EOA)"
                value={
                  balanceEOA !== undefined
                    ? `${Number(formatUnits(balanceEOA, USDC_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC`
                    : "…"
                }
                color="text-soul-soft"
              />
              <Stat
                label="Souls held"
                value={soulBalance !== undefined ? `${soulBalance.toString()} NFT` : "…"}
                color="text-magenta"
              />
            </div>

            {/* Circle faucet —— 替代旧 USDC 自家 faucet 按钮 */}
            <div className="surface p-7 space-y-4">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-cyan">⚡</span>
                <h3 className="font-mono text-lg font-semibold text-ink">Get test USDC</h3>
              </div>
              <p className="text-sm text-ink-dim">
                USDC is a real Circle-issued stablecoin, not platform points. Grab some test
                USDC from Circle&apos;s official faucet — opens in a new tab.
              </p>
              <a
                href={USDC_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="btn-primary inline-flex items-center gap-2"
              >
                Open Circle Faucet →
              </a>
              <p className="text-[11px] text-ink-faint font-mono leading-relaxed">
                Once funded, you can call any skill on /run with your wallet.
              </p>
            </div>

            <div className="surface p-7 space-y-5">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-magenta">⤳</span>
                <h3 className="font-mono text-lg font-semibold text-ink">Transfer USDC</h3>
              </div>

              <div>
                <label className="label">To address</label>
                <input
                  className="input"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  placeholder="0x…"
                />
              </div>

              <div>
                <label className="label">Amount (USDC)</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="10"
                />
              </div>

              <button
                type="button"
                onClick={handleTransfer}
                disabled={
                  pendingTransfer ||
                  !transferTo.startsWith("0x") ||
                  !transferAmount ||
                  Number(transferAmount) <= 0
                }
                className="btn-primary"
              >
                {pendingTransfer ? "Sending…" : "Send"}
              </button>
            </div>

            {error && (
              <div className="surface p-4 text-sm text-magenta border-magenta/40 bg-magenta/10 break-words font-mono">
                {error}
              </div>
            )}

            {lastTx && (
              <div className="surface-gradient p-4 text-sm font-mono">
                <span className="text-cyan">✓ Confirmed: </span>
                <a
                  href={txUrl(lastTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-soul-soft hover:text-magenta underline underline-offset-2"
                >
                  {lastTx.slice(0, 10)}…{lastTx.slice(-8)}
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
    </div>
  );
}
