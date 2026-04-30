"use client";

/**
 * ChainGuard — 错链 / 未添加 Arc Testnet 引导组件
 *
 * 解决 P2 issue + 用户钱包没有 Arc Testnet 的入口缺失：
 *   1. 用户连了 ETH 主网 → wrong chain → banner 显示
 *   2. 用户钱包还没添加 Arc Testnet → 点"添加 Arc Testnet 并切换"按钮
 *      底层 wagmi useSwitchChain 调 wallet_switchEthereumChain，wallet 返回 4902
 *      时自动 fallback 到 wallet_addEthereumChain（viem 内置 fallback）—— 一键搞定
 *
 * 暴露三种用法：
 *   - <WrongChainBanner />            非阻塞 banner，layout 全局加在 Navbar 下面
 *   - <WrongChainBlocker>...</...>    阻塞 children（适合 mint/run 等写交易页）
 *   - 文案全 i18n（默认中文，EN toggle 切换）
 */

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { CHAIN_ID } from "@/lib/chain";
import { useI18n } from "@/lib/i18n";

function WrongChainCard({ chainId }: { chainId: number }) {
  const { switchChain, isPending, error } = useSwitchChain();
  const { t } = useI18n();

  return (
    <div className="surface p-7 max-w-2xl mx-auto border-magenta/40 space-y-4">
      <div className="text-magenta text-[11px] uppercase tracking-[0.13em] font-mono">
        {t("chain.wrong.eyebrow")}
      </div>
      <h2 className="display text-2xl">{t("chain.wrong.title")}</h2>
      <p className="text-ink-dim text-sm leading-relaxed">
        {t("chain.wrong.connected_prefix")}{" "}
        <code className="text-ink font-mono">{chainId}</code>
        {"。"}
        {t("chain.wrong.connected_suffix")}
      </p>
      <button
        type="button"
        onClick={() => switchChain({ chainId: CHAIN_ID })}
        disabled={isPending}
        className="btn-primary"
      >
        {isPending ? t("chain.wrong.switching") : t("chain.wrong.add_button")}
      </button>
      {error && (
        <div className="text-[11px] text-magenta font-mono break-all">
          {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </div>
      )}
      <p className="text-[10px] text-ink-faint font-mono leading-relaxed">
        {t("chain.wrong.note")}
      </p>
    </div>
  );
}

export function WrongChainBanner() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  if (!isConnected || chainId === CHAIN_ID) return null;
  return (
    <div className="mt-6 mb-2 px-8">
      <WrongChainCard chainId={chainId} />
    </div>
  );
}

export function WrongChainBlocker({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  if (isConnected && chainId !== CHAIN_ID) {
    return (
      <div className="px-8">
        <WrongChainCard chainId={chainId} />
      </div>
    );
  }
  return <>{children}</>;
}
