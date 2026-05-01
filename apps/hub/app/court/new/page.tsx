"use client";

/**
 * /court/new — 起诉表单
 *
 * UX：
 *   1. 用户填 callId（要起诉的那笔已 settle 的 call）
 *   2. 描述（≤ 500 字符）
 *   3. 证据 hash（可粘贴 IPFS hash 或前端计算 keccak256(description) 当占位）
 *   4. jurors 列表（至少 3 个 EOA，必须持 Soul，不重复）
 *
 * 链上 invariant 校验交给合约（fileDispute 内部 revert），前端只做基础 UX 提示。
 */

import { useState } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { keccak256, toHex, isAddress, type Hex, type Address } from "viem";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PNEUMA_COURT,
  PneumaCourtAbi,
  txUrl,
} from "@/lib/contracts";

export default function NewDisputePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const [callId, setCallId] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceHash, setEvidenceHash] = useState(""); // 用户可粘贴 keccak256 / 留空自动算
  const [jurorsText, setJurorsText] = useState(""); // 一行一个地址

  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // 解析 jurors —— 一行一个 EOA，过滤空白行 + 校验地址格式
  const jurors: Address[] = jurorsText
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s): s is Address => isAddress(s));

  const dupes = jurors.length !== new Set(jurors.map((a) => a.toLowerCase())).size;
  const tooFew = jurors.length < 3;
  const tooMany = jurors.length > 7;
  const includesSelf =
    address && jurors.some((j) => j.toLowerCase() === address.toLowerCase());

  // evidenceHash 兜底：用户没填 → 用 keccak256(description) 当占位
  const finalEvidence: Hex =
    evidenceHash.startsWith("0x") && evidenceHash.length === 66
      ? (evidenceHash as Hex)
      : keccak256(toHex(description || "(no evidence)"));

  const ready =
    isConnected &&
    callId.trim().length > 0 &&
    description.trim().length > 0 &&
    !tooFew &&
    !tooMany &&
    !dupes &&
    !includesSelf;

  async function onSubmit() {
    if (!ready) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: PNEUMA_COURT,
        abi: PneumaCourtAbi,
        functionName: "fileDispute",
        args: [BigInt(callId), finalEvidence, description, jurors],
      });
      setTxHash(hash);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // 成功后跳到刚刚 file 的那条 dispute（用 disputeCount 当作 latestId 兜底；
  // 严谨一点应解 receipt logs，但 demo 里读 count + 1 已经够准）
  if (isSuccess) {
    setTimeout(() => router.push("/court"), 800);
  }

  return (
    <div className="relative max-w-3xl mx-auto px-8 pt-12 pb-24 space-y-8 animate-fade-in">
      <header className="space-y-3">
        <span className="pill-live">PneumaCourt · 起诉新案件</span>
        <h1 className="display text-3xl md:text-4xl">File a dispute</h1>
        <p className="text-ink-dim leading-relaxed">
          只能对**已 settled** 的 call 起诉，且 plaintiff 必须是该 call 的真 caller
          （链上验）。投票期 3 天，jurors 必须持 Soul、≥3 个、≤7 个、不重复、不含 plaintiff/defendant。
        </p>
      </header>

      {!isConnected && (
        <div className="surface p-6 text-center text-ink-dim">
          连接钱包以起诉。
        </div>
      )}

      {isConnected && (
        <div className="surface p-7 space-y-5">
          <div>
            <label className="label">争议的 callId</label>
            <input
              className="input"
              type="number"
              value={callId}
              onChange={(e) => setCallId(e.target.value)}
              placeholder="例：47"
              disabled={isPending || confirming}
            />
            <p className="text-[11px] text-ink-faint mt-1.5 font-mono">
              这笔 call 必须 status=1（已 settle），且 caller=你。/spending-trail/&lt;tba&gt; 可查你的历史 callId。
            </p>
          </div>

          <div>
            <label className="label">描述（≤ 500 字符）</label>
            <textarea
              className="input min-h-[100px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例：调用 Finance Oracle skill #1 查 ETH 价格，得到的是 BTC 价格 + 数字明显错误。需要 slash + 退还 escrow。"
              disabled={isPending || confirming}
              maxLength={500}
            />
            <p className="text-[11px] text-ink-faint mt-1.5 font-mono">
              {description.length} / 500 字符
            </p>
          </div>

          <div>
            <label className="label">
              证据 hash（IPFS / keccak256，留空自动取 keccak256(description)）
            </label>
            <input
              className="input"
              value={evidenceHash}
              onChange={(e) => setEvidenceHash(e.target.value)}
              placeholder="0x... 或留空"
              disabled={isPending || confirming}
            />
            <p className="text-[11px] text-ink-faint mt-1.5 font-mono break-all">
              将提交：{finalEvidence}
            </p>
          </div>

          <div>
            <label className="label">陪审员（一行一个 EOA，3 ≤ N ≤ 7）</label>
            <textarea
              className="input min-h-[100px] font-mono text-[13px]"
              value={jurorsText}
              onChange={(e) => setJurorsText(e.target.value)}
              placeholder={`0xaaa…\n0xbbb…\n0xccc…`}
              disabled={isPending || confirming}
            />
            <div className="text-[11px] mt-1.5 font-mono space-y-0.5">
              <div className="text-ink-faint">
                解析到 {jurors.length} 个有效地址
              </div>
              {tooFew && (
                <div className="text-magenta">⚠ 至少 3 个 juror</div>
              )}
              {tooMany && (
                <div className="text-magenta">⚠ 最多 7 个 juror</div>
              )}
              {dupes && (
                <div className="text-magenta">⚠ 有重复地址</div>
              )}
              {includesSelf && (
                <div className="text-magenta">
                  ⚠ 你（plaintiff）不能是 juror
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={!ready || isPending || confirming}
            className="btn-primary w-full text-sm"
          >
            {isPending
              ? "等钱包确认…"
              : confirming
              ? "上链中…"
              : "提交起诉"}
          </button>

          {error && (
            <div className="text-[12px] text-magenta border border-magenta/40 bg-magenta/10 rounded-md p-3 break-words font-mono">
              {error}
            </div>
          )}

          {txHash && (
            <div className="text-[12px] font-mono space-y-1">
              <div className="text-cyan">✓ 起诉已提交</div>
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-soul-soft hover:text-magenta underline underline-offset-2"
              >
                {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
              </a>
              {isSuccess && (
                <div className="text-cyan">已确认 · 跳转列表 →</div>
              )}
            </div>
          )}
        </div>
      )}

      <Link
        href="/court"
        className="text-[12px] font-mono text-ink-faint hover:text-cyan inline-block"
      >
        ← 返回列表
      </Link>
    </div>
  );
}
