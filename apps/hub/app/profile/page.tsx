"use client";

/**
 * /profile — 「我的 Agent」入口
 *
 * IA 重构后这一页吸收了原 /wallet 路由的功能：
 *   - tab="souls"  → 我钱包下的所有 Soul（默认）
 *   - tab="wallet" → USDC 余额、faucet、转账（原 /wallet 内容）
 *
 * tab 状态走 URL 查询 ?tab=wallet，刷新可回，复制链接可分享。
 *
 * 三个区段（souls tab 内）：
 *   1. My Souls：用 useMySouls 反查当前钱包持有的 Souls
 *   2. Browse all Souls：列出全网 mint 过的 tokenId 1..N，作为第三方浏览入口
 *   3. 未连钱包态：只显示第二段，提示连接钱包看 "My Souls"
 */

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";
import { SOUL_NFT, SoulNFTAbi } from "@/lib/contracts";
import { useMySouls } from "@/lib/useMySouls";
import { useI18n } from "@/lib/i18n";
import { WalletPanel } from "./_components/WalletPanel";

type Tab = "souls" | "wallet";

export default function ProfileIndexPage() {
  return (
    <Suspense fallback={null}>
      <ProfileIndexInner />
    </Suspense>
  );
}

function ProfileIndexInner() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "wallet" ? "wallet" : "souls";

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "souls") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.push(qs ? `/profile?${qs}` : "/profile");
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "200px",
          left: "8%",
          width: "84%",
          height: "5px",
          transform: "rotate(-7deg)",
          opacity: 0.35,
        }}
      />

      <div className="relative max-w-3xl mx-auto px-8 pt-12 pb-24 space-y-8 animate-fade-in">
        <header className="space-y-3">
          <span className="pill-live">Profile</span>
          <h1 className="display text-4xl md:text-5xl">{t("profile.title")}</h1>
          <p className="text-ink-dim leading-relaxed">{t("profile.subtitle")}</p>
        </header>

        {/* Tab 切换 */}
        <div className="flex items-center gap-2 border-b border-border">
          <TabButton active={tab === "souls"} onClick={() => setTab("souls")}>
            我的 Soul
          </TabButton>
          <TabButton active={tab === "wallet"} onClick={() => setTab("wallet")}>
            钱包
          </TabButton>
        </div>

        {tab === "souls" && <SoulsTab />}
        {tab === "wallet" && <WalletPanel />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-mono transition-colors -mb-px border-b-2 ${
        active
          ? "border-cyan text-cyan"
          : "border-transparent text-ink-dim hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function SoulsTab() {
  const { address, isConnected } = useAccount();
  const { souls: mySouls, loading: mySoulsLoading } = useMySouls(address);

  const { data: totalMinted } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "totalMinted",
    query: { refetchInterval: 6000 },
  });

  return (
    <div className="space-y-8">
      {/* My Souls (only when connected) */}
      {isConnected && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-cyan font-mono">
              My Souls
            </h2>
            <span className="text-[10px] text-ink-faint font-mono">
              wallet {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>
          </div>

          {mySoulsLoading && (
            <div className="surface p-5 text-sm text-ink-dim">
              Scanning Transfer logs…
            </div>
          )}

          {!mySoulsLoading && mySouls.length === 0 && (
            <div className="surface p-7 text-center space-y-3">
              <div className="text-ink-faint">
                这个钱包还没有 Soul。
              </div>
              <Link
                href="/mint"
                className="inline-block text-soul-soft underline underline-offset-2 text-sm"
              >
                30 秒铸造你的第一个 Soul →
              </Link>
            </div>
          )}

          {mySouls.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {mySouls.map((s) => (
                <Link
                  key={s.tokenId.toString()}
                  href={`/profile/${s.tokenId.toString()}`}
                  className="surface p-4 hover:border-cyan transition-colors group"
                >
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className="text-[12px] font-mono text-cyan group-hover:text-magenta">
                      #{s.tokenId.toString()}
                    </span>
                    <span className="text-ink font-medium truncate">
                      {s.agentName || "Unnamed Agent"}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-ink-faint break-all">
                    TBA {s.tba.slice(0, 8)}…{s.tba.slice(-6)}
                  </div>
                  <div className="text-[10px] font-mono text-ink-faint mt-1">
                    created {new Date(Number(s.createdAt) * 1000).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Connect prompt (when not connected) */}
      {!isConnected && (
        <section className="surface-glow p-7 space-y-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-magenta font-mono">
            连接钱包看你的 Soul
          </div>
          <p className="text-ink-dim text-sm leading-relaxed">
            身份绑定钱包：在 MetaMask 切钱包，Soul 列表自动跟着切——
            没有登录、没有 session。
          </p>
        </section>
      )}

      {/* Browse all */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-ink-dim font-mono">
            浏览任意 Soul
          </h2>
          <span className="text-[10px] text-ink-faint font-mono">
            {totalMinted ? `${totalMinted.toString()} minted total` : "—"}
          </span>
        </div>
        <div className="surface p-5 space-y-4">
          <p className="text-[12px] text-ink-dim leading-relaxed">
            任何人都可以读任意 Soul 的链上履历。点 token ID
            进它的公开 attestation 时间线。
          </p>
          {totalMinted && totalMinted > 0n ? (
            <div className="flex flex-wrap gap-2">
              {Array.from(
                { length: Math.min(Number(totalMinted), 48) },
                (_, i) => {
                  const id = i + 1;
                  return (
                    <Link
                      key={id}
                      href={`/profile/${id}`}
                      className="px-3 py-1.5 rounded-md border border-border bg-bg hover:border-soul/50 hover:bg-soul/5 hover:text-cyan transition-all text-[11px] font-mono"
                    >
                      #{id}
                    </Link>
                  );
                },
              )}
            </div>
          ) : (
            <div className="text-ink-faint font-mono text-sm">
              No Souls minted yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
