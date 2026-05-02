"use client";

/**
 * /court/new — 起诉表单（Tier 0 自动化版）
 *
 * 设计目标：用户只填两件事
 *   1. 争议的 callId（合约会校验 caller=你 / status=settled / 未被起诉）
 *   2. 一句话申诉理由
 *
 * 系统自动推导：
 *   - defendant —— 合约内部从 callId.skillId.owner 推导
 *   - jurors —— 从所有 Soul 持有者中按 ReputationGraph.totalActiveStakeTo
 *               排相关性，剔除 plaintiff/defendant 后取前 N 个；
 *               用户可点"换一组"重抽，或手动覆盖
 *   - evidenceHash —— 由 (callId, reason, callerTBA, paidAmount) 自动 keccak256
 *
 * 链上 invariant 仍由合约 fileDispute 内部 revert 兜底，前端只是把"必填"减到极少。
 */

import { useState, useMemo, useEffect } from "react";
import {
  useAccount,
  useWriteContract,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  keccak256,
  encodePacked,
  isAddress,
  getAddress,
  type Hex,
  type Address,
} from "viem";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PNEUMA_COURT,
  SOUL_NFT,
  SKILL_REGISTRY,
  REPUTATION_GRAPH,
  PneumaCourtAbi,
  SoulNFTAbi,
  SkillRegistryAbi,
  ReputationGraphAbi,
  txUrl,
} from "@/lib/contracts";
import { DEMO_DEFAULTS } from "@/lib/demoDefaults";

// 合约硬约束（PneumaCourt.sol）
const MIN_JURORS = 3;
const MAX_JURORS = 11;
const MAX_REASON_LENGTH = 500;

// 默认推荐数量 —— 取 5（>= MIN_JURORS=3，留余量）
const RECOMMEND_COUNT = 5;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const EMPTY_HASH: Hex = `0x${"00".repeat(32)}` as Hex;

interface CallRecordView {
  callId: bigint;
  skillId: bigint;
  caller: Address;
  callerTBA: Address;
  amountEscrowed: bigint;
  paymentHash: Hex;
  status: number; // 0=Pending, 1=Settled, 2=Refunded
  startedAt: bigint;
  slashed: boolean;
  inputBytes: number;
  maxOutputBytes: number;
  actualOutputBytes: number;
}

interface SkillView {
  owner: Address;
  name: string;
}

interface RankedJuror {
  address: Address;
  stake: bigint;
}

export default function NewDisputePage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const [callIdRaw, setCallIdRaw] = useState(DEMO_DEFAULTS.court.callId);
  const [reason, setReason] = useState(DEMO_DEFAULTS.court.reason);
  const [shuffleNonce, setShuffleNonce] = useState(0);
  // 用户可手动覆盖推荐名单（粘贴一行一个 EOA）。null = 跟随推荐
  const [overrideText, setOverrideText] = useState<string | null>(null);

  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // ─── Step 1: 解析 callId + 反查 CallRecord ────────────────────────────
  const callIdBig = useMemo(() => {
    const trimmed = callIdRaw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }, [callIdRaw]);

  const { data: callRecord, isLoading: loadingCall } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "getCall",
    args: callIdBig != null ? [callIdBig] : undefined,
    query: { enabled: callIdBig != null },
  }) as { data: CallRecordView | undefined; isLoading: boolean };

  const { data: isDisputed } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "isCallDisputed",
    args: callIdBig != null ? [callIdBig] : undefined,
    query: { enabled: callIdBig != null },
  });

  const { data: skillData } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "getSkill",
    args: callRecord ? [callRecord.skillId] : undefined,
    query: { enabled: !!callRecord },
  }) as { data: SkillView | undefined };

  const defendant = skillData?.owner;
  const skillName = skillData?.name;

  // 校验 caller / status / dispute 状态（前端先 fail-fast，合约还会兜底）
  const callValidation = useMemo(() => {
    if (callIdBig == null) return { ok: false, msg: null as string | null };
    if (loadingCall) return { ok: false, msg: "查询链上中…" };
    if (!callRecord) return { ok: false, msg: "callId 不存在" };
    if (
      address &&
      callRecord.caller.toLowerCase() !== address.toLowerCase()
    )
      return { ok: false, msg: "你不是这笔 call 的 caller，无权起诉" };
    if (callRecord.status !== 1)
      return {
        ok: false,
        msg:
          callRecord.status === 0
            ? "call 还在 Pending（请走 timeout-slash 而不是起诉）"
            : "call 已 Refunded（无法起诉）",
      };
    if (isDisputed) return { ok: false, msg: "这笔 call 已经被起诉过了" };
    return { ok: true, msg: null };
  }, [callIdBig, loadingCall, callRecord, address, isDisputed]);

  // ─── Step 2: 枚举所有 Soul 持有者 ────────────────────────────────────
  const { data: totalMintedRaw } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "totalMinted",
  });
  const totalMinted = totalMintedRaw ? Number(totalMintedRaw as bigint) : 0;

  const ownerCalls = useMemo(() => {
    if (totalMinted === 0) return [];
    return Array.from({ length: totalMinted }, (_, i) => ({
      address: SOUL_NFT,
      abi: SoulNFTAbi,
      functionName: "ownerOf" as const,
      args: [BigInt(i + 1)] as const,
    }));
  }, [totalMinted]);

  const { data: ownersData } = useReadContracts({
    contracts: ownerCalls,
    allowFailure: true,
    query: { enabled: ownerCalls.length > 0 },
  });

  const allHolders: Address[] = useMemo(() => {
    if (!ownersData) return [];
    const set = new Set<string>();
    for (const r of ownersData) {
      if (r.status === "success" && r.result) {
        const lower = (r.result as Address).toLowerCase();
        if (lower !== ZERO_ADDRESS) set.add(lower);
      }
    }
    return Array.from(set).map((a) => getAddress(a));
  }, [ownersData]);

  // ─── Step 3: 按相关性排序（ReputationGraph.totalActiveStakeTo） ────
  const eligibleHolders = useMemo(() => {
    if (!address) return [];
    const plaintiffLower = address.toLowerCase();
    const defendantLower = defendant?.toLowerCase();
    return allHolders.filter((h) => {
      const lower = h.toLowerCase();
      if (lower === plaintiffLower) return false;
      if (defendantLower && lower === defendantLower) return false;
      return true;
    });
  }, [allHolders, address, defendant]);

  const stakeCalls = useMemo(
    () =>
      eligibleHolders.map((h) => ({
        address: REPUTATION_GRAPH,
        abi: ReputationGraphAbi,
        functionName: "totalActiveStakeTo" as const,
        args: [h] as const,
      })),
    [eligibleHolders]
  );

  const { data: stakesData } = useReadContracts({
    contracts: stakeCalls,
    allowFailure: true,
    query: { enabled: stakeCalls.length > 0 },
  });

  const ranked: RankedJuror[] = useMemo(() => {
    return eligibleHolders.map((h, i) => {
      const r = stakesData?.[i];
      const stake =
        r && r.status === "success" ? (r.result as bigint) : 0n;
      return { address: h, stake };
    });
  }, [eligibleHolders, stakesData]);

  // 推荐：按 stake 降序 + 地址确定性排序，然后用 nonce 做种子洗牌取前 N
  // —— 同样的 nonce 给同样的结果，[换一组] 触发 nonce++，取一组不同的
  const recommended: Address[] = useMemo(() => {
    if (ranked.length === 0) return [];
    const sorted = [...ranked].sort((a, b) => {
      if (a.stake === b.stake) return a.address.localeCompare(b.address);
      return a.stake > b.stake ? -1 : 1;
    });
    // 取相关性 top 池（>= RECOMMEND_COUNT），在池内做种子洗牌
    const poolSize = Math.max(RECOMMEND_COUNT * 2, RECOMMEND_COUNT);
    const pool = sorted.slice(0, Math.min(poolSize, sorted.length));
    const arr = pool.map((p) => p.address);
    // Fisher-Yates with seeded LCG（nonce=0 时也洗一次保证 deterministic）
    let seed = (shuffleNonce + 1) * 2654435761; // 整数 hash 散列
    for (let i = arr.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) >>> 0;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, Math.min(RECOMMEND_COUNT, arr.length));
  }, [ranked, shuffleNonce]);

  // 用户手动覆盖（粘贴 EOA 列表）
  const overrideJurors: Address[] | null = useMemo(() => {
    if (overrideText == null) return null;
    const parsed = overrideText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s): s is Address => isAddress(s))
      .map((a) => getAddress(a));
    return parsed;
  }, [overrideText]);

  const finalJurors: Address[] = overrideJurors ?? recommended;

  // 名单内部一致性校验
  const jurorIssues = useMemo(() => {
    const issues: string[] = [];
    if (finalJurors.length < MIN_JURORS)
      issues.push(`陪审员至少 ${MIN_JURORS} 个（当前 ${finalJurors.length}）`);
    if (finalJurors.length > MAX_JURORS)
      issues.push(`陪审员最多 ${MAX_JURORS} 个`);
    const lower = finalJurors.map((a) => a.toLowerCase());
    if (new Set(lower).size !== lower.length) issues.push("有重复地址");
    if (address && lower.includes(address.toLowerCase()))
      issues.push("不能把自己（plaintiff）放进陪审员");
    if (defendant && lower.includes(defendant.toLowerCase()))
      issues.push("不能把被告放进陪审员");
    return issues;
  }, [finalJurors, address, defendant]);

  // ─── Step 4: evidenceHash 自动 derive ─────────────────────────────────
  const finalEvidence: Hex = useMemo(() => {
    if (!callRecord) return EMPTY_HASH;
    return keccak256(
      encodePacked(
        ["uint256", "string", "address", "uint256"],
        [
          callRecord.callId,
          reason || "(no reason)",
          callRecord.callerTBA,
          callRecord.amountEscrowed,
        ]
      )
    );
  }, [callRecord, reason]);

  const finalDescription = reason.trim();

  const ready =
    isConnected &&
    callValidation.ok &&
    finalDescription.length > 0 &&
    finalDescription.length <= MAX_REASON_LENGTH &&
    jurorIssues.length === 0 &&
    finalEvidence !== EMPTY_HASH;

  async function onSubmit() {
    if (!ready || !callIdBig) return;
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: PNEUMA_COURT,
        abi: PneumaCourtAbi,
        functionName: "fileDispute",
        args: [callIdBig, finalEvidence, finalDescription, finalJurors],
      });
      setTxHash(hash);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (isSuccess) {
    setTimeout(() => router.push("/court"), 800);
  }

  return (
    <div className="relative max-w-3xl mx-auto px-8 pt-12 pb-24 space-y-8 animate-fade-in">
      <header className="space-y-3">
        <span className="pill-live">PneumaCourt · 起诉新案件</span>
        <h1 className="display text-3xl md:text-4xl">File a dispute</h1>
        <p className="text-ink-dim leading-relaxed">
          只填两件事：争议的 <code>callId</code> + 一句话申诉理由。
          被告由合约从 skill.owner 自动反查；陪审员系统按声誉相关性自动给到 5 位人选。
          投票期 24 小时，多数决，平票 → innocent（保护被告）。
        </p>
      </header>

      {!isConnected && (
        <div className="surface p-6 text-center text-ink-dim">
          连接钱包以起诉。
        </div>
      )}

      {isConnected && (
        <div className="surface p-7 space-y-6">
          {/* ── callId ─────────────────────────────────────────── */}
          <div>
            <label className="label">争议的 callId</label>
            <input
              className="input"
              type="number"
              value={callIdRaw}
              onChange={(e) => setCallIdRaw(e.target.value)}
              placeholder="例：47"
              disabled={isPending || confirming}
            />
            {callValidation.msg && (
              <p
                className={`text-[12px] mt-1.5 font-mono ${
                  callValidation.ok ? "text-cyan" : "text-magenta"
                }`}
              >
                {callValidation.ok ? "✓ " : "⚠ "}
                {callValidation.msg}
              </p>
            )}
            {callValidation.ok && callRecord && defendant && (
              <div className="text-[11px] mt-2 font-mono space-y-0.5 text-ink-dim">
                <div>
                  ✓ 已 settled · skill #{callRecord.skillId.toString()}
                  {skillName ? ` "${skillName}"` : ""}
                </div>
                <div>
                  被告（自动反查）:{" "}
                  <span className="text-ink">
                    {defendant.slice(0, 8)}…{defendant.slice(-6)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── 申诉理由 ───────────────────────────────────────── */}
          <div>
            <label className="label">申诉理由（一句话即可，≤ 500 字符）</label>
            <textarea
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：调用结果与声明的 skill 完全不符，请求 slash 并退款。"
              disabled={isPending || confirming}
              maxLength={MAX_REASON_LENGTH}
            />
            <p className="text-[11px] text-ink-faint mt-1.5 font-mono">
              {reason.length} / {MAX_REASON_LENGTH} · 证据 hash 由
              (callId · 理由 · 你的 TBA · 支付金额) 自动算
            </p>
          </div>

          {/* ── 评审员推荐 ─────────────────────────────────────── */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="label !mb-0">
                找到最相关的 {RECOMMEND_COUNT} 位评审员
              </label>
              <button
                type="button"
                onClick={() => setShuffleNonce((n) => n + 1)}
                disabled={
                  isPending ||
                  confirming ||
                  overrideText != null ||
                  ranked.length <= RECOMMEND_COUNT
                }
                className="text-[11px] font-mono text-cyan hover:text-magenta disabled:text-ink-faint disabled:cursor-not-allowed"
              >
                换一组 ↻
              </button>
            </div>

            {overrideText == null ? (
              <>
                <p className="text-[11px] text-ink-faint font-mono mb-2">
                  按 ReputationGraph 担保权重排序 ·
                  已剔除你和被告 · 全部持 Soul
                </p>
                {recommended.length === 0 ? (
                  <div className="text-[12px] text-magenta font-mono py-2">
                    {totalMinted === 0
                      ? "链上还没有 Soul 持有者"
                      : "可用持有者不足（需要剔除 plaintiff/defendant 后仍 ≥ 3 位）"}
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {recommended.map((j, i) => {
                      const stake =
                        ranked.find(
                          (r) => r.address.toLowerCase() === j.toLowerCase()
                        )?.stake ?? 0n;
                      return (
                        <li
                          key={j}
                          className="flex items-center justify-between text-[12px] font-mono px-3 py-2 rounded border border-ink-faint/20 bg-ink-faint/5"
                        >
                          <span>
                            <span className="text-ink-faint mr-2">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="text-ink">
                              {j.slice(0, 10)}…{j.slice(-8)}
                            </span>
                          </span>
                          <span className="text-cyan">
                            stake {(Number(stake) / 1e6).toFixed(2)} USDC
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setOverrideText("")}
                  disabled={isPending || confirming}
                  className="mt-2 text-[11px] font-mono text-ink-faint hover:text-cyan"
                >
                  手动指定陪审员 →
                </button>
              </>
            ) : (
              <>
                <textarea
                  className="input min-h-[100px] font-mono text-[13px]"
                  value={overrideText}
                  onChange={(e) => setOverrideText(e.target.value)}
                  placeholder={`一行一个 EOA\n0xaaa…\n0xbbb…\n0xccc…`}
                  disabled={isPending || confirming}
                />
                <div className="text-[11px] mt-1.5 font-mono space-y-0.5 text-ink-faint">
                  解析到 {overrideJurors?.length ?? 0} 个有效地址
                </div>
                <button
                  type="button"
                  onClick={() => setOverrideText(null)}
                  disabled={isPending || confirming}
                  className="mt-2 text-[11px] font-mono text-ink-faint hover:text-cyan"
                >
                  ← 用系统推荐
                </button>
              </>
            )}

            {jurorIssues.length > 0 && (
              <ul className="mt-2 text-[11px] font-mono text-magenta space-y-0.5">
                {jurorIssues.map((msg) => (
                  <li key={msg}>⚠ {msg}</li>
                ))}
              </ul>
            )}
          </div>

          {/* ── 提交 ───────────────────────────────────────────── */}
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
