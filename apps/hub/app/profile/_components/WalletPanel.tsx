"use client";

/**
 * WalletPanel —— /profile 顶部「钱包」tab 内嵌内容
 *
 * 从原 /wallet 路由抽出，IA 重构后钱包不是独立 nav 项，
 * 而是「我的 Agent」页内一个 tab——和身份是同一个心智。
 *
 * 功能保持原 /wallet 一致：
 *   - 显示 USDC balance + Souls held
 *   - Circle 官方 faucet 跳转
 *   - USDC 转账（连接钱包后可用）
 */

import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWalletClient,
} from "wagmi";
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

export function WalletPanel() {
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

  if (!isConnected) {
    return (
      <div className="surface p-6 text-center text-ink-dim">
        连接钱包后查看 USDC 余额、领测试币、转账。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <Stat
          label="USDC 余额（你的 EOA）"
          value={
            balanceEOA !== undefined
              ? `${Number(formatUnits(balanceEOA, USDC_DECIMALS)).toLocaleString(
                  undefined,
                  { maximumFractionDigits: 4 },
                )} USDC`
              : "…"
          }
          color="text-soul-soft"
        />
        <Stat
          label="持有的 Souls"
          value={soulBalance !== undefined ? `${soulBalance.toString()} NFT` : "…"}
          color="text-magenta"
        />
      </div>

      {/* Circle 官方 faucet —— USDC 是真稳定币，不是平台积分 */}
      <div className="surface p-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-cyan">⚡</span>
          <h3 className="font-mono text-base font-semibold text-ink">
            领测试 USDC
          </h3>
        </div>
        <p className="text-sm text-ink-dim leading-relaxed">
          USDC 是 Circle 发行的稳定币，不是平台积分。点下面的链接到
          Circle 官方 faucet 领测试币，新窗口打开。
        </p>
        <a
          href={USDC_FAUCET_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-primary inline-flex items-center gap-2 text-sm"
        >
          打开 Circle Faucet →
        </a>
        <p className="text-[11px] text-ink-faint font-mono leading-relaxed">
          领到 USDC 后，可以在执行台调用任意 skill。
        </p>
      </div>

      {/* USDC 转账 */}
      <div className="surface p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-magenta">⤳</span>
          <h3 className="font-mono text-base font-semibold text-ink">
            转账 USDC
          </h3>
        </div>

        <div>
          <label className="label">收款地址</label>
          <input
            className="input"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            placeholder="0x…"
          />
        </div>

        <div>
          <label className="label">金额（USDC）</label>
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
          className="btn-primary text-sm"
        >
          {pendingTransfer ? "发送中…" : "发送"}
        </button>
      </div>

      {error && (
        <div className="surface p-4 text-sm text-magenta border-magenta/40 bg-magenta/10 break-words font-mono">
          {error}
        </div>
      )}

      {lastTx && (
        <div className="surface-gradient p-4 text-sm font-mono">
          <span className="text-cyan">✓ 已确认: </span>
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
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
    </div>
  );
}
