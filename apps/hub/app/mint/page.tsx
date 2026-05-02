"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient, useReadContract } from "wagmi";
import { addressUrl, SOUL_NFT, SoulNFTAbi, txUrl } from "@/lib/contracts";
import { decodeEventLog, type Hex } from "viem";
import { WrongChainBanner } from "@/app/_components/ChainGuard";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { DEMO_DEFAULTS } from "@/lib/demoDefaults";

export default function MintPage() {
  const { t } = useI18n();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [agentName, setAgentName] = useState(DEMO_DEFAULTS.mint.agentName);
  const [metadataURI, setMetadataURI] = useState(DEMO_DEFAULTS.mint.metadataURI);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ tokenId: bigint; tba: string; tx: Hex } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: balance } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  async function onMint() {
    if (!walletClient || !publicClient || !address) return;
    setError(null);
    setResult(null);
    setPending(true);

    try {
      const { request } = await publicClient.simulateContract({
        address: SOUL_NFT,
        abi: SoulNFTAbi,
        functionName: "publicMint",
        args: [agentName, metadataURI],
        account: address,
      });
      const txHash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      let tokenId = 0n;
      let tba = "";
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== SOUL_NFT.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({ abi: SoulNFTAbi, data: log.data, topics: log.topics });
          if (parsed.eventName === "SoulMinted") {
            tokenId = parsed.args.tokenId;
            tba = parsed.args.tba;
          }
        } catch {
          /* skip */
        }
      }

      setResult({ tokenId, tba, tx: txHash });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="neon-streak" data-color="violet" style={{ top: "200px", left: "8%", width: "84%", height: "5px", transform: "rotate(-7deg)", opacity: 0.4 }} />

      <div className="relative max-w-3xl mx-auto px-8 pt-12 pb-24 space-y-8 animate-fade-in">
        <header className="space-y-3">
          <span className="pill-live">Step 1 of 3</span>
          <h1 className="display text-4xl md:text-5xl">{t("mint.title")}</h1>
          <p className="text-ink-dim leading-relaxed">{t("mint.subtitle")}</p>
        </header>

        <WrongChainBanner />

        {!isConnected && (
          <div className="surface p-6 text-center text-ink-dim">Connect your wallet to begin.</div>
        )}

        {/* hackathon 期 sybil 防御：每钱包 1 Soul 上限 + UI 硬禁 mint button
            （SoulNFT.publicMint 合约层目前无 paywall，靠前端 guard + Soul 价值
            稀缺性叙事，正式部署前会加合约层 daily limit；详见 SECURITY-REVIEW） */}
        {isConnected && balance !== undefined && balance > 0n && (
          <div className="surface-gradient p-6 text-center space-y-4">
            <span className="pill-live">Already have a Soul</span>
            <p className="text-ink">
              You hold <strong>{balance.toString()}</strong> Soul NFT{balance > 1n ? "s" : ""} in this wallet.
            </p>
            <p className="text-[12px] text-ink-faint font-mono leading-relaxed">
              Hackathon limit: 1 Soul per wallet to keep reputation diversity factor honest.
              <br />Need a second identity? Use a different wallet.
            </p>
            <Link href="/profile" className="btn-primary inline-flex">
              View profile →
            </Link>
          </div>
        )}

        {isConnected && balance !== undefined && balance === 0n && (
          <div className="surface p-7 space-y-5">
            <div>
              <label className="label">Agent Name</label>
              <input
                className="input"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Alice's Trading Bot"
              />
            </div>
            <div>
              <label className="label">Metadata URI (optional)</label>
              <input
                className="input"
                value={metadataURI}
                onChange={(e) => setMetadataURI(e.target.value)}
                placeholder="ipfs://…"
              />
              <p className="text-[11px] text-ink-faint mt-1.5 font-mono">
                IPFS / HTTPS URL pointing to your agent's metadata JSON.
              </p>
            </div>

            <button
              type="button"
              onClick={onMint}
              disabled={pending || agentName.trim().length === 0}
              className="btn-primary w-full text-sm"
            >
              {pending ? "Minting on-chain…" : "Mint Soul"}
            </button>

            {error && (
              <div className="text-[12px] text-magenta border border-magenta/40 bg-magenta/10 rounded-md p-3 break-words font-mono">
                {error}
              </div>
            )}

            {result && (
              <div className="surface-gradient p-5 space-y-2 text-sm font-mono">
                <div className="text-cyan">✓ Soul minted</div>
                <div>
                  <span className="text-ink-dim">Token ID: </span>
                  <span className="text-ink">#{result.tokenId.toString()}</span>
                </div>
                <div>
                  <span className="text-ink-dim">TBA Wallet: </span>
                  <a
                    href={addressUrl(result.tba)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan hover:text-magenta underline underline-offset-2 break-all"
                  >
                    {result.tba}
                  </a>
                </div>
                <div>
                  <span className="text-ink-dim">Tx: </span>
                  <a
                    href={txUrl(result.tx)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-soul-soft hover:text-magenta underline underline-offset-2"
                  >
                    {result.tx.slice(0, 10)}…{result.tx.slice(-8)}
                  </a>
                </div>
                <Link href="/wallet" className="btn-primary inline-flex mt-3">
                  Next: fund USDC →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
