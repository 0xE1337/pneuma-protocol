"use client";

import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatUnits, parseUnits, isAddress, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  PNEUMA_COMMONS,
  PneumaCommonsAbi,
  REPUTATION_GRAPH,
  ReputationGraphAbi,
  SOUL_NFT,
  SoulNFTAbi,
  USDC_TOKEN,
  UsdcAbi,
  USDC_DECIMALS,
  addressUrl,
  txUrl,
  RATER_ROLE,
  BOUNDARY_CATEGORY,
} from "@/lib/contracts";
import { useOwnershipTimeline, type OwnershipEvent } from "@/lib/useOwnershipTimeline";
import { WrongChainBanner } from "@/app/_components/ChainGuard";
import { ReputationRadar } from "@/app/_components/ReputationRadar";
import {
  computeReputationV2,
  type EndorsementLike,
  type PublicationLike,
} from "@/lib/reputationScore.v2";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { DEMO_DEFAULTS } from "@/lib/demoDefaults";

const CATEGORY_COLOR: Record<string, string> = {
  finance: "cyan",
  text: "magenta",
};

export default function SoulProfilePage({ params }: { params: Promise<{ soulId: string }> }) {
  const { soulId } = use(params);
  const tokenId = BigInt(soulId);

  const { data: soulData } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "souls",
    args: [tokenId],
  });

  const { data: ownerData } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "ownerOf",
    args: [tokenId],
  });

  const tba = soulData?.[3] as Address | undefined;

  const { data: attestations, isLoading: attestLoading } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: tba ? [tba] : undefined,
    query: { enabled: !!tba, refetchInterval: 8000 },
  });

  // 必须在 early return 之前调用所有 hook，否则 soulData 从 undefined 变 defined 时
  // 渲染路径上 hook 数量不一致，React 报 "change in the order of Hooks" 红屏。
  // useMemo 依赖 allValid，所以 allValid 也得在 early return 之前算出来。
  const allValid = (attestations ?? []).filter((a) => !a.revoked);
  // 切段：每个 boundary 把 timeline 切成"过去主人时代 / 当前主人时代"
  const eras = useMemo(
    () => splitTimelineByOwnership(allValid),
    [allValid],
  );

  if (!soulData) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-24 text-center text-ink-dim">
        Loading Soul #{soulId}…
      </div>
    );
  }

  // "业务"评分（排除 boundary，给统计用）
  const valid = allValid.filter((a) => a.raterRole !== RATER_ROLE.SYSTEM);
  const totalUsd = valid.reduce((s, a) => s + a.paidAmount, 0n);
  const avgRating =
    valid.length > 0 ? valid.reduce((s, a) => s + a.rating, 0) / valid.length : 0;
  const transferCount = eras.length - 1; // current era 之前每段都对应一次 transfer

  return (
    <div className="relative overflow-hidden">
      <div className="neon-streak" data-color="magenta" style={{ top: "320px", left: "8%", width: "84%", height: "5px", transform: "rotate(-6deg)", opacity: 0.4 }} />
      <div className="neon-streak" data-color="cyan" style={{ top: "1100px", left: "14%", width: "72%", height: "4px", transform: "rotate(7deg)", opacity: 0.3 }} />

      <div className="relative max-w-7xl mx-auto px-8 pt-12 pb-24">
        <WrongChainBanner />

        {/* Hero header */}
        <header className="flex items-start justify-between gap-8 flex-wrap mb-14 animate-fade-in">
          <div className="space-y-3 max-w-2xl">
            <span className="pill-live">Soul #{soulId}</span>
            <h1 className="display text-5xl md:text-6xl">
              {soulData[0] || "未命名 Agent"}
            </h1>
            <div className="space-y-2 pt-2 font-mono text-[12px]">
              <Row label="合约钱包" value={tba} link={tba ? addressUrl(tba) : undefined} accent="cyan" />
              <Row label="持有者" value={ownerData} link={ownerData ? addressUrl(ownerData) : undefined} />
              <Row
                label="创建于"
                value={`${new Date(Number(soulData[4]) * 1000).toLocaleString()} · Arc Testnet`}
              />
              {soulData[2] && <Row label="元数据" value={soulData[2]} />}
            </div>
          </div>

          <div className="flex flex-col gap-4 items-end">
            <div className="flex gap-3 flex-wrap">
              <StatPill value={valid.length.toString()} label="调用次数" color="text-magenta" />
              <StatPill value={formatUnits(totalUsd, 6)} label="USDC 累计" color="text-soul-soft" />
              <StatPill value={avgRating.toFixed(1)} label="平均 ★" color="text-cyan" />
            </div>
            {/* Spending Trail link — receipt-feed view of the same TBA,
                read straight from on-chain PneumaAttestation. */}
            {tba && (
              <Link
                href={`/spending-trail/${tba}`}
                className="surface px-4 py-2 inline-flex items-center gap-2 text-cyan font-mono text-[11px] uppercase tracking-[0.13em] hover:border-cyan transition-colors"
              >
                <span aria-hidden="true">⌗</span>
                查看消费明细 →
              </Link>
            )}
            <OwnerActions tokenId={tokenId} owner={ownerData as Address | undefined} />
          </div>
        </header>

        {/* anet 联动状态面板 —— 把"是否真的接入 Agent Network"做成可视证据 */}
        <AnetBindingPanel soulId={soulId} />

        {/* Ownership lineage */}
        <OwnershipLineage tokenId={tokenId} />

        {/* 反洗白警示横幅（仅当 Soul 转过手才显示） */}
        {transferCount > 0 && <LaunderingWarning transferCount={transferCount} />}

        {/* V6.0.3 — 4 维 reputation 雷达图（顶层 agent 画像） */}
        {tba && ownerData && (
          <ReputationRadarSection
            tba={tba}
            ownerEOA={ownerData as Address}
            attestations={(attestations ?? []) as readonly AttestationItem[]}
          />
        )}

        {/* Timeline — 按 boundary 切段 */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.18em] text-cyan font-mono">
              贡献履历
            </span>
            <span className="text-ink-dim text-sm">
              {valid.length} 条业务评价
              {transferCount > 0 && (
                <span className="text-ink-faint">
                  {" · 分 "}
                  {eras.length} 个主人时代
                </span>
              )}
            </span>
            <span className="ml-auto inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-ink-dim font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse-dot" /> 实时 · 8 秒同步
            </span>
          </div>

          {attestLoading && <div className="text-ink-faint">正在从链上读取…</div>}

          {!attestLoading && valid.length === 0 && (
            <div className="surface p-10 text-center text-ink-dim">
              暂无任何评价。在{" "}
              <Link href="/run" className="text-soul-soft underline underline-offset-2">
                /run
              </Link>{" "}
              调用一个 skill 写下第一条。
            </div>
          )}

          <div className="space-y-8">
            {eras.map((era, i) => (
              <EraSection key={i} era={era} />
            ))}
          </div>
        </section>

        {/* V6.0.1 — Publications (思想贡献维度) */}
        {ownerData && <PublicationsSection author={ownerData as Address} />}

        {/* V6.0.2 — Endorsements (社会资本维度) */}
        {ownerData && <EndorsementsSection endorsee={ownerData as Address} />}

        {/* Open protocol highlight */}
        <section className="mt-16 surface-gradient p-8 space-y-3">
          <span className="pill-live">开放协议 · 跨 dApp 读取</span>
          <p className="text-ink leading-relaxed">
            此页面只是一种渲染。任何其他 dApp 都可以调用
          </p>
          <code className="block px-4 py-3 rounded bg-bg border border-border font-mono text-[12px] text-magenta overflow-x-auto">
            PneumaAttestation.getAttestationsByRecipient(tba)
          </code>
          <p className="text-ink-dim text-sm leading-relaxed">
            直接用 viem 调，拿到同一份数据——无需 API key、无需后端、无需许可。30 秒就能搭一个竞品 dApp。
          </p>
        </section>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  link,
  accent,
}: {
  label: string;
  value: unknown;
  link?: string;
  accent?: "cyan" | "magenta";
}) {
  const valueClass = accent === "cyan" ? "text-cyan" : "text-ink";
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-[0.13em] text-ink-dim w-20 shrink-0">
        {label}
      </span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={`${valueClass} hover:text-magenta underline underline-offset-2 break-all`}
        >
          {String(value)}
        </a>
      ) : (
        <span className={`${valueClass} break-all`}>{String(value)}</span>
      )}
    </div>
  );
}

function StatPill({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="surface px-6 py-4 text-center min-w-[120px]">
      <div className={`stat-value text-3xl ${color}`}>{value}</div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}

/**
 * OwnerActions — 仅当当前连接钱包是该 Soul 的 owner 时显示转移面板。
 *
 * 这是 Pneuma "身份可携带" 叙事的核心 UI 抓手：
 *   1. ERC-721 standard `safeTransferFrom` —— SOUL NFT 转给任何地址
 *   2. 转移后 TBA 地址不变（CREATE2 派生只依赖 tokenId）
 *   3. PneumaAttestation 用 TBA 索引履历 → 评价记录自动跟随到新 owner
 *
 * 这条链路在 contracts/test/Pneuma.t.sol::test_E2E_NFTTransferCarriesHistory
 * 已被 forge E2E 实测过（gas 1.08M）。本组件就是把协议层成立的事实
 * 在 UX 层兑现。
 */
function OwnerActions({ tokenId, owner }: { tokenId: bigint; owner?: Address }) {
  const { address } = useAccount();
  const isOwner =
    !!address && !!owner && address.toLowerCase() === owner.toLowerCase();

  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  if (!owner) return null;

  // 不是 owner：显示提示文案（鼓励用户切到 owner 钱包）
  if (!isOwner) {
    return (
      <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono text-right max-w-[260px] leading-relaxed">
        连接持有者钱包以转移此 Soul。当前持有者：{" "}
        <span className="text-ink-dim">
          {owner.slice(0, 6)}…{owner.slice(-4)}
        </span>
      </div>
    );
  }

  // 转移成功：显示成功态 + tx 链接
  if (isSuccess) {
    return (
      <div className="surface px-5 py-4 max-w-sm space-y-2">
        <div className="text-cyan font-mono text-[11px] uppercase tracking-[0.13em]">
          ✓ 转移完成
        </div>
        <div className="text-ink text-sm break-all font-mono">
          Soul #{tokenId.toString()} → {recipient.slice(0, 6)}…{recipient.slice(-4)}
        </div>
        <div className="text-[10px] text-ink-dim leading-relaxed">
          履历（TBA + 评价）会自动跟随 NFT。
        </div>
        {hash && (
          <a
            href={txUrl(hash)}
            target="_blank"
            rel="noreferrer"
            className="block text-soul-soft underline underline-offset-2 text-[11px] font-mono"
          >
            在 arcscan 查看 →
          </a>
        )}
        <button
          onClick={() => {
            reset();
            setOpen(false);
            setRecipient("");
          }}
          className="text-ink-dim text-[10px] underline underline-offset-2 hover:text-ink"
        >
          关闭
        </button>
      </div>
    );
  }

  // 折叠态：触发按钮
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="surface px-5 py-3 text-magenta font-mono text-[12px] uppercase tracking-[0.13em] hover:border-magenta transition-colors"
      >
        转移 Soul →
      </button>
    );
  }

  // 展开态：地址输入 + 确认/取消
  const recipientValid = isAddress(recipient);
  const submitting = isPending || isConfirming;
  const errMsg = error
    ? // viem BaseError 暴露 shortMessage 字段；不存在则退化到 message
      (error as { shortMessage?: string }).shortMessage ?? (error as Error).message
    : null;

  const onSubmit = () => {
    if (!recipientValid) return;
    writeContract({
      address: SOUL_NFT,
      abi: SoulNFTAbi,
      functionName: "safeTransferFrom",
      args: [owner, recipient as Address, tokenId],
    });
  };

  return (
    <div className="surface p-5 max-w-sm space-y-3">
      <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
        转移 Soul #{tokenId.toString()}
      </div>
      <input
        type="text"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="0x… 接收者地址"
        className="w-full px-3 py-2 bg-bg border border-border rounded font-mono text-[11px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-cyan"
        autoFocus
        disabled={submitting}
      />
      <p className="text-[10px] text-ink-dim leading-relaxed">
        SOUL NFT 转给接收者。{" "}
        <span className="text-ink">
          TBA 地址 + 全部评价自动跟随
        </span>{" "}
        （TBA 由 tokenId CREATE2 派生，不依赖 owner）。
      </p>
      {errMsg && (
        <div className="text-[11px] text-magenta font-mono break-all leading-relaxed">
          {errMsg}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!recipientValid || submitting}
          className="flex-1 bg-magenta/20 border border-magenta text-magenta px-4 py-2 font-mono text-[11px] uppercase tracking-[0.13em] hover:bg-magenta/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isPending
            ? "钱包签名中…"
            : isConfirming
            ? "确认中…"
            : "确认转移"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setRecipient("");
            reset();
          }}
          disabled={submitting}
          className="px-4 py-2 text-ink-dim text-[11px] uppercase tracking-[0.13em] font-mono hover:text-ink disabled:opacity-40"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * OwnershipLineage — 视觉化 Soul NFT 的 owner 变迁链
 *
 * 与下方 Contribution History（attestation 时间线，挂在 TBA 上）形成对位：
 *   - 这一段：NFT owner 谁谁谁，会变
 *   - 下一段：TBA 履历，不变 ← 这就是叙事核心
 *
 * 当 owner 链 > 1 时（即转移过），UI 用 cyan badge 高亮"history followed"
 * 这条事实，让评委一眼看到协议层成立的事实在 UX 上变成可感知的视觉。
 */
function OwnershipLineage({ tokenId }: { tokenId: bigint }) {
  const { events, loading, error } = useOwnershipTimeline(tokenId);
  const transferCount = events.filter((e) => !e.isMint).length;

  if (loading && events.length === 0) {
    return (
      <section className="space-y-3">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-magenta font-mono">
          Ownership Lineage
        </h3>
        <div className="surface p-5 text-ink-faint text-sm">
          Scanning Transfer logs…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-3">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-magenta font-mono">
          Ownership Lineage
        </h3>
        <div className="surface p-5 text-magenta text-sm font-mono break-all">
          {error}
        </div>
      </section>
    );
  }

  if (events.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-magenta font-mono">
          Ownership Lineage
        </h3>
        <span className="text-ink-dim text-sm">
          {events.length} on-chain {events.length === 1 ? "event" : "events"}
        </span>
        {transferCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-cyan/40 bg-cyan/10 text-cyan text-[10px] uppercase tracking-[0.13em] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse-dot" />
            transferred {transferCount}× · history followed
          </span>
        )}
      </div>

      <div className="surface p-5 space-y-0">
        {events.map((ev, i) => (
          <OwnershipNode key={ev.txHash + i} ev={ev} isLast={i === events.length - 1} />
        ))}
      </div>
    </section>
  );
}

function OwnershipNode({ ev, isLast }: { ev: OwnershipEvent; isLast: boolean }) {
  const dotColor = ev.isMint ? "rgb(0 242 255)" : "rgb(191 64 255)";
  const dateStr =
    ev.timestamp > 0n
      ? new Date(Number(ev.timestamp) * 1000).toLocaleString()
      : `block #${ev.blockNumber.toString()}`;

  return (
    <div className="flex gap-4 pb-4">
      <div className="flex flex-col items-center w-6 shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full ring-[3px] ring-bg shrink-0 mt-1.5"
          style={{ background: dotColor }}
        />
        {!isLast && <div className="flex-1 w-0.5 bg-border mt-1 min-h-[40px]" />}
      </div>

      <div className="flex-1 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`text-[10px] uppercase tracking-[0.13em] font-mono ${
              ev.isMint ? "text-cyan" : "text-magenta"
            }`}
          >
            {ev.isMint ? "Mint 出生" : "已转让"}
          </span>
          <span className="text-[11px] text-ink-dim font-mono">{dateStr}</span>
        </div>
        <div className="text-[12px] font-mono break-all">
          {!ev.isMint && (
            <>
              <span className="text-ink-dim">从 </span>
              <a
                href={addressUrl(ev.from)}
                target="_blank"
                rel="noreferrer"
                className="text-ink-dim hover:text-cyan underline underline-offset-2"
              >
                {ev.from.slice(0, 8)}…{ev.from.slice(-6)}
              </a>{" "}
            </>
          )}
          <span className="text-ink-dim">到 </span>
          <a
            href={addressUrl(ev.to)}
            target="_blank"
            rel="noreferrer"
            className="text-ink hover:text-magenta underline underline-offset-2"
          >
            {ev.to.slice(0, 8)}…{ev.to.slice(-6)}
          </a>
        </div>
        <a
          href={txUrl(ev.txHash)}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-soul-soft hover:text-magenta font-mono underline underline-offset-2"
        >
          tx {ev.txHash.slice(0, 12)}…{ev.txHash.slice(-6)} ↗
        </a>
      </div>
    </div>
  );
}

/**
 * splitTimelineByOwnership — 把 attestation 列表按 boundary 切成 era 段
 *
 * boundary attestation = SoulNFT 在转主时自动写入的 SYSTEM-rater 条目
 * (raterRole=SYSTEM, skillCategory="system:ownership")，
 * 它把 timeline 切成"前任主人时代 / 当前主人时代"，
 * 让买家 / 第三方 dApp 一眼分清"卖前战绩 vs 卖后表现"，反信用洗白攻击。
 *
 * @param all  按时间序的 attestation（含 boundary，已过滤 revoked）
 * @returns    eras：[最新当前 era, 前一任 era, ...]，前面是最新
 */
type AttestationItem = {
  uid: string;
  recipient: string;
  attester: string;
  skillId: bigint;
  paymentHash: string;
  rating: number;
  paidAmount: bigint;
  skillName: string;
  skillCategory: string;
  timestamp: bigint;
  revoked: boolean;
  raterRole: number;
  /** v3: 真用户文字评论（≤280 字符）；boundary / 旧 attestation 为空字符串 */
  comment?: string;
};

interface OwnershipEra {
  isCurrent: boolean;
  index: number; // 0=current, 1+=past（按倒序计）
  entries: AttestationItem[]; // 该 era 内的业务 attestation（不含 boundary 自身）
  startedAt: bigint | null; // 开始时间（前一个 boundary，或 null=mint 时）
  endedAt: bigint | null; // 结束时间（这一段的 boundary，仅 past era 有）
  boundaryUid: string | null;
}

function splitTimelineByOwnership(
  all: readonly AttestationItem[],
): OwnershipEra[] {
  // 时间升序（最早到最新）
  const sorted = [...all].sort((a, b) => Number(a.timestamp - b.timestamp));

  const result: OwnershipEra[] = [];
  let bucket: AttestationItem[] = [];
  let lastBoundaryAt: bigint | null = null;

  for (const a of sorted) {
    const isBoundary =
      a.raterRole === RATER_ROLE.SYSTEM && a.skillCategory === BOUNDARY_CATEGORY;
    if (isBoundary) {
      result.push({
        isCurrent: false,
        index: 0,
        entries: bucket,
        startedAt: lastBoundaryAt,
        endedAt: a.timestamp,
        boundaryUid: a.uid,
      });
      bucket = [];
      lastBoundaryAt = a.timestamp;
    } else {
      bucket.push(a);
    }
  }
  result.push({
    isCurrent: true,
    index: 0,
    entries: bucket,
    startedAt: lastBoundaryAt,
    endedAt: null,
    boundaryUid: null,
  });

  // 反转：最新 era 在最前
  const reversed = result.reverse();
  reversed.forEach((era, i) => {
    era.index = i;
  });
  return reversed;
}

/**
 * LaunderingWarning — 顶部反洗白警示横幅
 *
 * 仅当 Soul 转过手（transferCount > 0）才显示。明确告诉买家 / 第三方：
 * "下面的历史 attestation 不全是当前主人的功劳，注意分段查看"
 */
function LaunderingWarning({ transferCount }: { transferCount: number }) {
  return (
    <section className="surface p-5 border-magenta/40 bg-magenta/5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-magenta text-lg">⚠</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-magenta font-mono">
          Anti-laundering notice
        </span>
      </div>
      <p className="text-sm text-ink leading-relaxed">
        此 Soul 已转手{" "}
        <span className="text-magenta font-mono font-semibold">
          {transferCount}
        </span>{" "}
        次。过去的评价归属于{" "}
        <span className="text-ink">前任持有者</span>——只有{" "}
        <span className="text-cyan font-mono">当前主人时代</span>{" "}
        才反映你今天雇佣的这个 agent。每次所有权变更都通过 SoulNFT 自动写入的
        SYSTEM 评价在链上锚定。
      </p>
    </section>
  );
}

/**
 * EraSection — 单个 owner 时代的 attestation 列表
 *
 * isCurrent=true：正常颜色 + cyan 边框
 * isCurrent=false：opacity 50% + 灰色 "PAST" badge + 红色边框（视觉降权）
 */
function EraSection({ era }: { era: OwnershipEra }) {
  if (era.entries.length === 0 && !era.isCurrent) {
    // 空 era（前任主人在位时没攒任何 attestation），用一个轻量 placeholder
    return (
      <div className="opacity-40">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-ink-faint">
            前任主人时代 #{era.index} · 空
          </span>
        </div>
      </div>
    );
  }

  const headerLabel = era.isCurrent
    ? "当前主人时代"
    : `前任主人时代 #${era.index}`;
  const headerColor = era.isCurrent ? "text-cyan" : "text-ink-faint";

  return (
    <div className={era.isCurrent ? "" : "opacity-50"}>
      {/* Era header */}
      <div className="flex items-center gap-3 mb-3 pb-2 border-b border-border/60">
        <span
          className={`text-[10px] uppercase tracking-[0.18em] font-mono ${headerColor}`}
        >
          {headerLabel}
        </span>
        {era.startedAt && (
          <span className="text-[10px] text-ink-faint font-mono">
            from {new Date(Number(era.startedAt) * 1000).toLocaleString()}
          </span>
        )}
        {era.endedAt && (
          <span className="text-[10px] text-ink-faint font-mono">
            → ended {new Date(Number(era.endedAt) * 1000).toLocaleString()}
          </span>
        )}
        {!era.isCurrent && (
          <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded text-[9px] uppercase tracking-[0.13em] font-mono border border-magenta/40 text-magenta bg-magenta/5">
            past · history
          </span>
        )}
      </div>

      <div className="space-y-0">
        {era.entries
          .slice()
          .reverse() // era 内最新在前
          .map((a, i, arr) => (
            <TimelineEntry
              key={a.uid}
              entry={a}
              isLast={i === arr.length - 1}
            />
          ))}
        {era.entries.length === 0 && era.isCurrent && (
          <div className="text-[12px] text-ink-faint italic">
            No attestation in current owner era yet.
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineEntry({
  entry,
  isLast,
}: {
  entry: {
    uid: string;
    skillId: bigint;
    skillName: string;
    skillCategory: string;
    rating: number;
    paidAmount: bigint;
    timestamp: bigint;
    attester: string;
    raterRole: number; // 0=PROVIDER 1=CALLER 2=JUROR 3=SYSTEM
    /** v3: 真用户文字评论（≤280 字符）；boundary / 旧 attestation 为空字符串 */
    comment?: string;
  };
  isLast: boolean;
}) {
  const colorKey = CATEGORY_COLOR[entry.skillCategory] ?? "soul";
  const dotColor = colorKey === "cyan" ? "rgb(0 242 255)" : colorKey === "magenta" ? "rgb(191 64 255)" : "rgb(88 44 255)";

  // raterRole 视觉编码：CALLER (1) 用 cyan 边框 + ↘ 标记；
  //                    PROVIDER (0) 用默认；
  //                    JUROR (2) 用 magenta 边框 + ⚖ 标记
  const roleBadge =
    entry.raterRole === 1
      ? { label: "Caller-rated", icon: "↘", className: "border border-cyan/60 text-cyan bg-cyan/5" }
      : entry.raterRole === 2
      ? { label: "Juror-rated", icon: "⚖", className: "border border-magenta/60 text-magenta bg-magenta/5" }
      : { label: "Provider-rated", icon: "↗", className: "border border-soul/40 text-soul-soft bg-soul/5" };

  return (
    <div className="flex gap-6 pb-6">
      {/* Spine */}
      <div className="flex flex-col items-center w-10 shrink-0">
        <div
          className="w-3.5 h-3.5 rounded-full ring-[3px] ring-bg shrink-0"
          style={{ background: dotColor }}
        />
        {!isLast && <div className="flex-1 w-0.5 bg-border mt-1 min-h-[60px]" />}
      </div>

      {/* Card */}
      <div className="flex-1 surface p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <h3 className="font-mono text-lg font-semibold text-ink">{entry.skillName}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={
                  colorKey === "cyan"
                    ? "tag-cyan"
                    : colorKey === "magenta"
                    ? "tag-soul"
                    : "tag"
                }
              >
                #{entry.skillId.toString()} · {entry.skillCategory}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.13em] font-mono ${roleBadge.className}`}
              >
                <span>{roleBadge.icon}</span>
                {roleBadge.label}
              </span>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-magenta text-lg font-mono">
              {"★".repeat(entry.rating)}
              <span className="text-ink-faint">{"★".repeat(5 - entry.rating)}</span>
            </div>
            <div className="text-[11px] text-ink-dim font-mono">
              {formatUnits(entry.paidAmount, 6)} USDC paid
            </div>
            <div className="text-[10px] text-ink-faint font-mono">
              {new Date(Number(entry.timestamp) * 1000).toLocaleString()}
            </div>
          </div>
        </div>
        {/* v3 真用户文字评论 — 比抽象星数信息密度高得多 */}
        {entry.comment && entry.comment.length > 0 && (
          <blockquote className="border-l-2 border-magenta/50 pl-3 py-1 text-[12px] text-ink leading-relaxed italic">
            "{entry.comment}"
            <span className="block mt-0.5 not-italic text-[10px] text-ink-faint font-mono">
              — written by {entry.raterRole === 1 ? "real paying caller" : entry.raterRole === 0 ? "provider note" : "juror"}
            </span>
          </blockquote>
        )}

        <div className="text-[10px] text-ink-faint font-mono break-all border-t border-border/60 pt-2">
          uid {entry.uid.slice(0, 16)}…{entry.uid.slice(-6)}  ·  attester {entry.attester.slice(0, 8)}…{entry.attester.slice(-6)} (= SkillRegistry)
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  V6.0.1 PublicationsSection — 思想贡献维度
//
//  跟付费 attestation 形成 reputation 双轨：
//    - 经济维度：付费调用记录
//    - 思想维度：发布 + 被引用
//
//  显示 Soul 持有者 (ownerEOA) 在 PneumaCommons 上的所有 publication
//  注意：authorship 是 EOA 级别（msg.sender），不跟随 Soul transfer 流动
//        这是有意设计 —— 思想是个人作品，不是 NFT 资产
// ─────────────────────────────────────────────────────────────────────

interface PubRow {
  pubId: bigint;
  author: Address;
  contentType: string;
  contentHash: `0x${string}`;
  title: string;
  summary: string;
  publishedAt: bigint;
  citationCount: bigint;
  retracted: boolean;
}

function PublicationsSection({ author }: { author: Address }) {
  const { data: pubIds } = useReadContract({
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    functionName: "getPublicationsByAuthor",
    args: [author],
    query: { refetchInterval: 12000 },
  });

  const ids = (pubIds ?? []) as readonly bigint[];

  if (ids.length === 0) {
    return (
      <section className="mt-16 space-y-4">
        <header className="flex items-baseline justify-between">
          <h2 className="display text-2xl">Knowledge Commons</h2>
          <Link
            href="/commons"
            className="text-xs font-mono text-soul-soft hover:text-magenta underline underline-offset-2"
          >
            visit /commons →
          </Link>
        </header>
        <p className="text-ink-dim text-sm leading-relaxed max-w-3xl">
          This Soul-holder hasn't published any thoughts yet. Publications give agents an
          intellectual reputation dimension on top of paid call records — like ArXiv citations
          for AI agents.
        </p>
      </section>
    );
  }

  const totalCitations = 0; // 会在子组件聚合后展示
  return (
    <section className="mt-16 space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="display text-2xl">Knowledge Commons</h2>
        <Link
          href="/commons"
          className="text-xs font-mono text-soul-soft hover:text-magenta underline underline-offset-2"
        >
          visit /commons →
        </Link>
      </header>
      <p className="text-ink-dim text-sm leading-relaxed max-w-3xl">
        Free thoughts published on-chain by this Soul holder. Citation count is the second
        reputation axis (Intellectual) alongside paid-call-derived (Economic) score.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        {ids.map((pubId) => (
          <PublicationRow key={pubId.toString()} pubId={pubId} />
        ))}
      </div>
    </section>
  );
}

function PublicationRow({ pubId }: { pubId: bigint }) {
  const { data } = useReadContract({
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    functionName: "getPublication",
    args: [pubId],
    query: { refetchInterval: 12000 },
  });
  if (!data) return null;
  const p = data as PubRow;

  return (
    <Link
      href={`/commons#pub-${p.pubId.toString()}`}
      className={`surface p-5 block hover:border-soul/40 transition-colors space-y-2 ${
        p.retracted ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="font-mono text-sm font-semibold truncate">{p.title}</h4>
          {p.retracted && (
            <span className="text-[9px] uppercase tracking-[0.13em] px-1 py-0.5 rounded border border-amber-400/40 text-amber-400 font-mono shrink-0">
              retracted
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-base font-semibold text-magenta">
            {p.citationCount.toString()}
          </div>
          <div className="text-[9px] uppercase tracking-[0.13em] text-ink-faint font-mono">
            cited
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono">
        <span className="px-1.5 py-0.5 rounded border border-soul/30 text-soul-soft">
          {p.contentType}
        </span>
        <span className="text-ink-faint">#{p.pubId.toString()}</span>
        <span className="text-ink-faint">·</span>
        <span className="text-ink-faint">
          {new Date(Number(p.publishedAt) * 1000).toISOString().slice(0, 10)}
        </span>
      </div>
      <p className="text-xs text-ink-dim leading-relaxed line-clamp-2">{p.summary}</p>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  V6.0.2 EndorsementsSection — 社会资本维度
//
//  显示该 Soul 持有者收到的所有担保 + (如适用) 让访客发起担保
//
//  功能：
//    - 列出所有 active + retired endorsements 收到的（带 stake / context / status）
//    - 如果访客 ≠ Soul 持有者 + 自己持 Soul → 显示 endorse 表单
//    - 如果某条担保的 endorser 就是访客 → 显示 manage 操作（requestUnlock / withdraw）
// ─────────────────────────────────────────────────────────────────────

interface EndorsementRow {
  endorsementId: bigint;
  endorser: Address;
  endorsee: Address;
  stakedAmount: bigint;
  startedAt: bigint;
  unlockRequestedAt: bigint;
  active: boolean;
  context: string;
}

function EndorsementsSection({ endorsee }: { endorsee: Address }) {
  const { address: viewerAddress } = useAccount();

  // 检查访客是否持 Soul（决定能不能 endorse）
  const { data: viewerSoulBalance } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "balanceOf",
    args: viewerAddress ? [viewerAddress] : undefined,
    query: { enabled: !!viewerAddress },
  });
  const viewerHasSoul = (viewerSoulBalance ?? 0n) > 0n;
  const isSelfView =
    viewerAddress?.toLowerCase() === endorsee.toLowerCase();

  const { data: ids, refetch: refetchIds } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getEndorsementsByEndorsee",
    args: [endorsee],
    query: { refetchInterval: 12000 },
  });

  const { data: totalActive } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "totalActiveStakeTo",
    args: [endorsee],
    query: { refetchInterval: 12000 },
  });

  const idsArr = (ids ?? []) as readonly bigint[];

  return (
    <section className="mt-16 space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="display text-2xl">Social Capital</h2>
          <p className="text-ink-dim text-sm leading-relaxed mt-1 max-w-3xl">
            Stake-backed endorsements: 老 agent 用真金白银替这个 agent 担保，
            出事时担保人按 slashBps 联动 slash —— 协议层强制连带责任。
          </p>
        </div>
        {viewerHasSoul && !isSelfView && (
          <EndorseAction endorsee={endorsee} onDone={() => refetchIds()} />
        )}
      </header>

      {/* Aggregate stat */}
      <div className="surface-gradient p-5 flex items-baseline justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.13em] text-amber-400 font-mono">
            Active stake backing this agent
          </div>
          <div className="font-mono text-3xl text-ink mt-1">
            {totalActive ? (Number(totalActive) / 1e6).toFixed(2) : "0.00"}{" "}
            <span className="text-base text-ink-dim">USDC</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
            Total endorsements
          </div>
          <div className="font-mono text-3xl text-magenta">{idsArr.length}</div>
        </div>
      </div>

      {idsArr.length === 0 ? (
        <div className="surface p-8 text-center text-ink-dim text-sm">
          No endorsements yet. Be the first to back this agent with USDC stake.
        </div>
      ) : (
        <div className="space-y-3">
          {idsArr.map((id) => (
            <EndorsementListRow
              key={id.toString()}
              endorsementId={id}
              viewerAddress={viewerAddress}
              onChange={() => refetchIds()}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────── Endorse action (form) ───────────────────────

function EndorseAction({
  endorsee,
  onDone,
}: {
  endorsee: Address;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(DEMO_DEFAULTS.endorse.stake);
  const [context, setContext] = useState(DEMO_DEFAULTS.endorse.context);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const { data: minStake } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "minStake",
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-md bg-amber-400/15 border border-amber-400/40 text-amber-400 font-mono text-xs hover:bg-amber-400/25 transition-colors whitespace-nowrap"
      >
        🛡️ Endorse this agent
      </button>
    );
  }

  async function handleEndorse() {
    setError(null);
    if (!address || !publicClient) return setError("Wallet / RPC not ready");

    const stakeNum = Number(stake);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
      return setError("Invalid stake amount");
    }
    if (context.length > 280) return setError("Context ≤ 280 chars");

    const stakeWei = parseUnits(stake, USDC_DECIMALS);
    if (minStake && stakeWei < (minStake as bigint)) {
      return setError(
        `Stake below minimum (${(Number(minStake) / 1e6).toFixed(2)} USDC)`
      );
    }

    setSubmitting(true);
    try {
      // Step 1: ensure USDC allowance
      const allowance = (await publicClient.readContract({
        address: USDC_TOKEN,
        abi: UsdcAbi,
        functionName: "allowance",
        args: [address, REPUTATION_GRAPH],
      })) as bigint;

      if (allowance < stakeWei) {
        const approveHash = await writeContractAsync({
          address: USDC_TOKEN,
          abi: UsdcAbi,
          functionName: "approve",
          args: [REPUTATION_GRAPH, stakeWei * 100n], // approve 100x for future
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Step 2: endorse
      const txHash = await writeContractAsync({
        address: REPUTATION_GRAPH,
        abi: ReputationGraphAbi,
        functionName: "endorse",
        args: [endorsee, stakeWei, context],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setOpen(false);
      setStake(DEMO_DEFAULTS.endorse.stake);
      setContext(DEMO_DEFAULTS.endorse.context);
      onDone();
    } catch (err) {
      setError((err as Error).message ?? "Endorsement failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface p-5 border-amber-400/40 space-y-3 min-w-[300px]">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-sm text-amber-400">Endorse with USDC stake</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-ink-faint hover:text-ink-dim"
        >
          cancel
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
          Stake (USDC)
        </label>
        <input
          type="number"
          step="0.01"
          min="1"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-sm focus:outline-none focus:border-amber-400/40"
        />
        {minStake && (
          <div className="text-[10px] text-ink-faint font-mono">
            min: {(Number(minStake) / 1e6).toFixed(2)} USDC
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
          Why endorse? (≤ 280 chars)
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="I trained this agent on my dataset..."
          className="w-full bg-bg border border-border rounded px-3 py-2 font-mono text-xs resize-none focus:outline-none focus:border-amber-400/40"
        />
        <div className="text-[10px] text-ink-faint font-mono">
          {context.length} / 280
        </div>
      </div>

      <div className="text-[10px] text-amber-400/80 font-mono leading-relaxed border-l-2 border-amber-400/40 pl-2">
        ⚠️ 你将锁定 USDC，如果该 agent 出事被 slash，你将按 slashBps 比例联动 slash。
        撤保需 24h 延迟。
      </div>

      {error && <div className="text-xs text-red-400 font-mono">{error}</div>}

      <button
        onClick={handleEndorse}
        disabled={submitting}
        className="w-full px-4 py-2.5 rounded bg-amber-400/20 border border-amber-400/50 text-amber-400 font-mono text-xs hover:bg-amber-400/30 disabled:opacity-50 transition-colors"
      >
        {submitting ? "submitting…" : "Confirm endorsement"}
      </button>
    </div>
  );
}

// ─────────────────────── Single endorsement row ───────────────────────

const UNLOCK_DELAY_SEC = 24 * 60 * 60;

function EndorsementListRow({
  endorsementId,
  viewerAddress,
  onChange,
}: {
  endorsementId: bigint;
  viewerAddress?: Address;
  onChange: () => void;
}) {
  const { data, refetch } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getEndorsement",
    args: [endorsementId],
    query: { refetchInterval: 12000 },
  });

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [actionPending, setActionPending] = useState(false);

  if (!data) return null;
  const e = data as EndorsementRow;

  const isViewerEndorser =
    viewerAddress?.toLowerCase() === e.endorser.toLowerCase();

  const now = Math.floor(Date.now() / 1000);
  const unlockAt = Number(e.unlockRequestedAt) + UNLOCK_DELAY_SEC;
  const unlockRequested = e.unlockRequestedAt > 0n;
  const canWithdraw = unlockRequested && now >= unlockAt;
  const remainingSec = unlockRequested ? Math.max(0, unlockAt - now) : 0;

  let statusBadge: { text: string; cls: string };
  if (!e.active) {
    statusBadge = { text: "withdrawn", cls: "border-ink-faint/30 text-ink-faint" };
  } else if (canWithdraw) {
    statusBadge = { text: "ready to withdraw", cls: "border-cyan/40 text-cyan" };
  } else if (unlockRequested) {
    statusBadge = {
      text: `unlocking · ${formatRemaining(remainingSec)}`,
      cls: "border-amber-400/40 text-amber-400",
    };
  } else {
    statusBadge = { text: "active", cls: "border-emerald-400/40 text-emerald-400" };
  }

  async function handleAction(action: "requestUnlock" | "withdraw") {
    if (!publicClient) return;
    setActionPending(true);
    try {
      const txHash = await writeContractAsync({
        address: REPUTATION_GRAPH,
        abi: ReputationGraphAbi,
        functionName: action,
        args: [endorsementId],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await refetch();
      onChange();
    } catch (err) {
      console.error(err);
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div
      className={`surface p-5 space-y-2 ${
        e.active ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className={`px-1.5 py-0.5 rounded border ${statusBadge.cls}`}>
              {statusBadge.text}
            </span>
            <span className="text-ink-faint">#{e.endorsementId.toString()}</span>
          </div>
          <div className="font-mono text-sm">
            <a
              href={addressUrl(e.endorser)}
              target="_blank"
              rel="noreferrer"
              className="text-soul-soft hover:text-magenta underline underline-offset-2"
            >
              {e.endorser.slice(0, 8)}…{e.endorser.slice(-6)}
            </a>
            {isViewerEndorser && <span className="text-cyan/80 ml-2">(you)</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-lg font-semibold text-amber-400">
            {(Number(e.stakedAmount) / 1e6).toFixed(2)}
          </div>
          <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
            USDC staked
          </div>
        </div>
      </div>

      {e.context && (
        <p className="text-xs text-ink-dim leading-relaxed border-l-2 border-amber-400/30 pl-3 italic">
          "{e.context}"
        </p>
      )}

      <div className="text-[10px] text-ink-faint font-mono">
        since {new Date(Number(e.startedAt) * 1000).toISOString().slice(0, 10)}
      </div>

      {/* Manage actions for the endorser */}
      {isViewerEndorser && e.active && (
        <div className="flex gap-2 pt-1 border-t border-border/60">
          {!unlockRequested && (
            <button
              onClick={() => handleAction("requestUnlock")}
              disabled={actionPending}
              className="text-[11px] font-mono px-3 py-1 rounded border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 disabled:opacity-50"
            >
              {actionPending ? "…" : "Request unlock (24h delay)"}
            </button>
          )}
          {canWithdraw && (
            <button
              onClick={() => handleAction("withdraw")}
              disabled={actionPending}
              className="text-[11px] font-mono px-3 py-1 rounded border border-cyan/40 text-cyan hover:bg-cyan/10 disabled:opacity-50"
            >
              {actionPending ? "…" : "Withdraw"}
            </button>
          )}
          {unlockRequested && !canWithdraw && (
            <span className="text-[10px] text-ink-faint font-mono py-1">
              ⏳ withdraw available in {formatRemaining(remainingSec)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "ready";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─────────────────────────────────────────────────────────────────────
//  V6.0.3 ReputationRadarSection — 4 维 reputation 综合画像
//
//  数据源汇集：
//    - Economic   ← attestations (PneumaAttestation by TBA)
//    - Intellectual ← publications by ownerEOA (PneumaCommons)
//    - Social     ← endorsements received by ownerEOA (ReputationGraph)
//    - Judicial   ← V6.1 placeholder = 0
//
//  渲染：
//    - 顶部一句 narrative ("Multi-dimensional Identity")
//    - 大雷达图（240px）
//    - 4 个 dimension 卡片各自的 detail（economic 0 calls, intellectual 3 pubs etc.）
// ─────────────────────────────────────────────────────────────────────

function ReputationRadarSection({
  tba,
  ownerEOA,
  attestations,
}: {
  tba: Address;
  ownerEOA: Address;
  attestations: readonly AttestationItem[];
}) {
  // 读 publications by author（intellectual 维度）
  const { data: pubIds } = useReadContract({
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    functionName: "getPublicationsByAuthor",
    args: [ownerEOA],
    query: { refetchInterval: 12000 },
  });

  // 读 endorsements received（social 维度）
  const { data: endIds } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getEndorsementsByEndorsee",
    args: [ownerEOA],
    query: { refetchInterval: 12000 },
  });

  return (
    <section className="mb-14 surface-gradient p-8 rounded-lg">
      <header className="flex items-baseline justify-between mb-6">
        <div>
          <h2 className="display text-2xl">4-axis Reputation Profile</h2>
          <p className="text-ink-dim text-sm leading-relaxed mt-1 max-w-2xl">
            Pneuma reputation 不是单一积分。Economic（付费交易）、Intellectual（思想引用）、
            Social（社会担保）、Judicial（陪审表现 V6.1）—— 4 维独立累积，加权和构成 agent 综合信用画像。
          </p>
        </div>
      </header>

      <RadarBody
        tba={tba}
        attestations={attestations}
        publicationIds={(pubIds ?? []) as readonly bigint[]}
        endorsementIds={(endIds ?? []) as readonly bigint[]}
      />
    </section>
  );
}

function RadarBody({
  attestations,
  publicationIds,
  endorsementIds,
}: {
  tba: Address;
  attestations: readonly AttestationItem[];
  publicationIds: readonly bigint[];
  endorsementIds: readonly bigint[];
}) {
  // 拉每条 publication 的 citationCount + retracted（聚合）
  const publications: PublicationLike[] = [];
  for (const pid of publicationIds) {
    publications.push({ pubId: pid, citationCount: 0n, publishedAt: 0n, retracted: false });
    // 注意：这里简化版用 0 个 citation 算分；真实数据靠下面的 PubDetailLoader 合并
    // 但是 React hooks 不能放在循环里，所以用一个子组件 chain 异步加载
  }

  // 用一个 child collector 子组件分别拉详情（每个 pubId 一个 useReadContract）
  // 收集后通过 callback 把真实数据汇总到 parent state 再算 score
  // 简化方案：用 PubAggregator + EndorsementAggregator 子组件管理数据流
  return (
    <PubsAndEndorsLoader
      attestations={attestations}
      publicationIds={publicationIds}
      endorsementIds={endorsementIds}
    />
  );
}

/**
 * 因为 React hooks 不能放循环，我们用 React.memo 子组件 + 父级 reduce 模式：
 * 每个 child 独立 useReadContract，把数据回传 parent；parent 在 useMemo 里聚合并算 v2 分数
 *
 * 性能：N 个 publications + M 个 endorsements = N+M 个 RPC 请求，并行
 *      hackathon demo N+M < 20 条，问题不大
 */
function PubsAndEndorsLoader({
  attestations,
  publicationIds,
  endorsementIds,
}: {
  attestations: readonly AttestationItem[];
  publicationIds: readonly bigint[];
  endorsementIds: readonly bigint[];
}) {
  const [pubMap, setPubMap] = useState<Record<string, PublicationLike>>({});
  const [endMap, setEndMap] = useState<Record<string, EndorsementLike>>({});

  const breakdown = useMemo(() => {
    const pubs = publicationIds
      .map((id) => pubMap[id.toString()])
      .filter((p): p is PublicationLike => !!p);
    const ends = endorsementIds
      .map((id) => endMap[id.toString()])
      .filter((e): e is EndorsementLike => !!e);

    return computeReputationV2({
      attestations: attestations.map((a) => ({
        rating: a.rating,
        paidAmount: a.paidAmount,
        timestamp: a.timestamp,
        revoked: a.revoked,
        raterRole: a.raterRole,
      })),
      publications: pubs,
      endorsementsReceived: ends,
    });
  }, [attestations, publicationIds, endorsementIds, pubMap, endMap]);

  return (
    <>
      {/* hidden loaders for each publication / endorsement */}
      {publicationIds.map((id) => (
        <PubLoader
          key={`pub-${id.toString()}`}
          pubId={id}
          onLoad={(data) =>
            setPubMap((prev) => ({ ...prev, [id.toString()]: data }))
          }
        />
      ))}
      {endorsementIds.map((id) => (
        <EndorsementLoader
          key={`end-${id.toString()}`}
          endorsementId={id}
          onLoad={(data) =>
            setEndMap((prev) => ({ ...prev, [id.toString()]: data }))
          }
        />
      ))}

      {/* visual */}
      <div className="grid lg:grid-cols-2 gap-8 items-center">
        <div className="flex justify-center">
          <ReputationRadar breakdown={breakdown} size={280} />
        </div>
        <div className="space-y-3">
          <DimRow
            label="Economic"
            color="text-cyan"
            score={breakdown.economic.score}
            detail={breakdown.economic.detail}
          />
          <DimRow
            label="Intellectual"
            color="text-magenta"
            score={breakdown.intellectual.score}
            detail={breakdown.intellectual.detail}
          />
          <DimRow
            label="Social"
            color="text-amber-400"
            score={breakdown.social.score}
            detail={breakdown.social.detail}
          />
          <DimRow
            label="Judicial"
            color="text-violet-400"
            score={breakdown.judicial.score}
            detail={breakdown.judicial.detail}
          />
        </div>
      </div>
    </>
  );
}

function PubLoader({
  pubId,
  onLoad,
}: {
  pubId: bigint;
  onLoad: (p: PublicationLike) => void;
}) {
  const { data } = useReadContract({
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    functionName: "getPublication",
    args: [pubId],
  });

  // 必须用 useEffect 推到 commit 后；直接在 render body 里调 onLoad 会触发
  // "Cannot update a component while rendering" 的 React 错误（onLoad 是父
  // 组件的 setState 回调，render 期间禁止越界 setState）。
  // 故意只把 data 进 dep，onLoad 在父级每次 re-render 都是新函数，
  // 进 dep 会导致每次父 re-render 都重触发 effect 死循环。
  useEffect(() => {
    if (!data) return;
    const d = data as {
      pubId: bigint;
      citationCount: bigint;
      publishedAt: bigint;
      retracted: boolean;
    };
    onLoad({
      pubId: d.pubId,
      citationCount: d.citationCount,
      publishedAt: d.publishedAt,
      retracted: d.retracted,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return null;
}

function EndorsementLoader({
  endorsementId,
  onLoad,
}: {
  endorsementId: bigint;
  onLoad: (e: EndorsementLike) => void;
}) {
  const { data } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getEndorsement",
    args: [endorsementId],
  });

  // 同 PubLoader，setState in render 会被 React 报错。推到 useEffect 里。
  useEffect(() => {
    if (!data) return;
    const d = data as {
      stakedAmount: bigint;
      active: boolean;
      startedAt: bigint;
    };
    onLoad({
      stakedAmount: d.stakedAmount,
      active: d.active,
      startedAt: d.startedAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return null;
}

function DimRow({
  label,
  color,
  score,
  detail,
}: {
  label: string;
  color: string;
  score: number;
  detail: Record<string, number | string>;
}) {
  return (
    <div className="surface p-4 space-y-1">
      <div className="flex items-baseline justify-between">
        <span className={`font-mono text-sm font-semibold ${color}`}>{label}</span>
        <span className={`font-mono text-2xl ${color}`}>{score.toFixed(0)}</span>
      </div>
      <div className="text-[10px] text-ink-faint font-mono space-x-3">
        {Object.entries(detail).slice(0, 4).map(([k, v]) => (
          <span key={k}>
            <span className="text-ink-dim">{k}</span>={v as string}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * AnetBindingPanel —— 显示当前 Soul 跟 anet daemon 的联动状态
 *
 * 三种渲染分支：
 *   1. 当前 Soul 已绑定（binding.soulTokenId === soulId）→ 绿底显示 did:key + daemon status
 *   2. 别的 Soul 已绑定，本 Soul 未绑 → 灰底提示"其他 Soul 占用了 binding"
 *   3. 完全没绑 → 蓝底教用户跑 `pneuma anet bootstrap`
 *
 * 数据源：/api/anet-status（读 ~/.pneuma/anet-binding.json + 试探 anet whoami）
 */
function AnetBindingPanel({ soulId }: { soulId: string }) {
  type DaemonStatus = "connected" | "not_installed" | "not_running" | "loading";
  interface Status {
    binding: {
      soulTokenId?: string;
      did?: string;
      tba?: string;
      ownerEoa?: string;
      boundAt?: string;
    } | null;
    anetDaemon: DaemonStatus;
    anetDid: string | null;
  }

  const [status, setStatus] = useState<Status>({
    binding: null,
    anetDaemon: "loading",
    anetDid: null,
  });

  useEffect(() => {
    fetch("/api/anet-status")
      .then((r) => r.json())
      .then((d: Status) => setStatus(d))
      .catch(() =>
        setStatus({ binding: null, anetDaemon: "not_running", anetDid: null }),
      );
  }, []);

  const isMine = status.binding?.soulTokenId === soulId;
  const otherSoul = !!status.binding && !isMine;

  // daemon 状态点的颜色
  const daemonDot =
    status.anetDaemon === "connected"
      ? "bg-green-400"
      : status.anetDaemon === "loading"
      ? "bg-ink-faint animate-pulse"
      : "bg-amber-400";

  if (isMine && status.binding) {
    return (
      <section className="surface px-5 py-4 my-6 border border-cyan/40 bg-cyan/5">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <h3 className="text-[11px] uppercase tracking-[0.18em] font-mono text-cyan">
            ⬡ Pneuma × Agent Network · 已联动
          </h3>
          <span className="inline-flex items-center gap-2 text-[10px] font-mono text-ink-dim">
            <span className={`w-1.5 h-1.5 rounded-full ${daemonDot}`} />
            anet daemon ·{" "}
            {status.anetDaemon === "connected"
              ? "running"
              : status.anetDaemon === "loading"
              ? "checking…"
              : status.anetDaemon === "not_running"
              ? "not running"
              : "not installed"}
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-4 text-[12px] font-mono">
          <div>
            <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint">
              did:key
            </div>
            <div className="text-ink truncate">
              {status.binding.did ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint">
              agent:// URI
            </div>
            <div className="text-ink truncate">
              agent://pneuma-receipt-{soulId}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[10px] text-ink-faint font-mono">
          这条 Soul 跟 anet 上的 did:key 绑定后，所有 anet 任务都可镜像成链上
          attestation 写到 #{soulId} 的 TBA。运行
          <code className="text-cyan mx-1">pneuma anet mirror &lt;task-id&gt;</code>
          预览待镜像的收据。
        </div>
      </section>
    );
  }

  if (otherSoul) {
    return (
      <section className="surface px-5 py-4 my-6 border border-amber-400/30 bg-amber-400/5">
        <div className="text-[11px] uppercase tracking-[0.18em] font-mono text-amber-400 mb-1">
          ⬡ Pneuma × Agent Network · 其他 Soul 已联动
        </div>
        <div className="text-[12px] text-ink-dim font-mono leading-relaxed">
          本机 anet binding 当前指向 Soul #{status.binding?.soulTokenId}，
          不是 #{soulId}。要切换：先在 active wallet 切到 #{soulId} 的持有人，
          然后跑 <code className="text-cyan">pneuma anet bootstrap</code>。
        </div>
      </section>
    );
  }

  // 没绑：教用户怎么绑
  return (
    <section className="surface px-5 py-4 my-6 border border-magenta/30 bg-magenta/5">
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <div className="text-[11px] uppercase tracking-[0.18em] font-mono text-magenta">
          ⬡ Pneuma × Agent Network · 尚未联动
        </div>
        <span className="inline-flex items-center gap-2 text-[10px] font-mono text-ink-dim">
          <span className={`w-1.5 h-1.5 rounded-full ${daemonDot}`} />
          anet daemon ·{" "}
          {status.anetDaemon === "connected"
            ? "running"
            : status.anetDaemon === "loading"
            ? "checking…"
            : status.anetDaemon === "not_running"
            ? "not running"
            : "not installed"}
        </span>
      </div>
      <div className="text-[12px] text-ink-dim font-mono leading-relaxed">
        把这条 Soul 跟 anet did:key 绑定，让你的 anet 任务收据能镜像成链上
        attestation：
        <pre className="mt-2 text-cyan text-[11px] bg-bg/50 px-3 py-2 rounded border border-border/60 overflow-x-auto">{`pneuma anet bootstrap                # 绑定 did:key ↔ Soul #${soulId}
pneuma anet register-x402-skill       # 在 anet ANS 注册支付能力
pneuma anet mirror <anet-task-id>     # 把 KREC 镜像成链上 attestation`}</pre>
      </div>
    </section>
  );
}
