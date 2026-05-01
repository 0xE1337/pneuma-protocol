"use client";

/**
 * ReputationBadge — 列表卡片用的紧凑声誉徽章
 *
 * 三种 size：
 *   - sm  → 一行紧凑：「💠 738」（用于 grid 卡片角落）
 *   - md  → 两行：段位 emoji + 名称 + 分数 + 段位内排名
 *   - lg  → md + 段位进度条
 *
 * 输入：raw total (0-100)，组件内部 normalize 到 0-1000 + tier 查表。
 *
 * 设计原则：
 *   - 0 deps，纯 SVG/HTML
 *   - tier 颜色直接挂 inline style（避免 tailwind purge 拆 dynamic class）
 */

import {
  scaleToDisplayScore,
  getTier,
  tierProgress,
  type TierMeta,
} from "@pneuma/reputation-formula";

interface BadgeProps {
  /** 0-100 raw V2 total (computeReputationV2 输出) */
  rawTotal: number;
  /** 排行榜场景：当前段位排名 + 段位人数 → "#14 / 412" */
  rankInTier?: { rank: number; total: number };
  /** sm | md | lg */
  size?: "sm" | "md" | "lg";
}

/** tier id → 颜色 hex（与 tier.color 的 tailwind class 对齐） */
const TIER_COLORS: Record<string, string> = {
  newcomer: "rgba(160,160,160,0.7)",
  bronze: "#d97706", // amber-600
  silver: "#cbd5e1", // slate-300
  gold: "#facc15", // yellow-400
  platinum: "#22d3ee", // cyan-400
  diamond: "#e879f9", // magenta/fuchsia-400
};

export function ReputationBadge({
  rawTotal,
  rankInTier,
  size = "md",
}: BadgeProps) {
  const displayScore = scaleToDisplayScore(rawTotal);
  const tier = getTier(displayScore);
  const color = TIER_COLORS[tier.id] ?? "rgba(160,160,160,0.7)";

  if (size === "sm") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
        style={{
          color,
          background: `${color}1a`, // 10% alpha
          border: `1px solid ${color}40`,
        }}
        title={`${tier.zhName} · ${tier.enName} · raw ${rawTotal.toFixed(1)}/100`}
      >
        <span>{tier.emoji}</span>
        <span className="font-semibold">{displayScore}</span>
      </span>
    );
  }

  // md / lg
  return (
    <div className="inline-flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span style={{ fontSize: "20px", lineHeight: 1 }}>{tier.emoji}</span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className="font-mono font-bold text-base leading-none"
              style={{ color }}
            >
              {displayScore}
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.13em]"
              style={{ color }}
            >
              {tier.enName}
            </span>
          </div>
          {rankInTier && (
            <span className="font-mono text-[10px] text-ink-faint leading-none">
              #{rankInTier.rank} / {rankInTier.total} in {tier.enName}
            </span>
          )}
        </div>
      </div>

      {size === "lg" && <TierProgressBar tier={tier} displayScore={displayScore} />}
    </div>
  );
}

function TierProgressBar({
  tier,
  displayScore,
}: {
  tier: TierMeta;
  displayScore: number;
}) {
  const progress = tierProgress(displayScore);
  const color = TIER_COLORS[tier.id] ?? "rgba(160,160,160,0.7)";

  return (
    <div className="space-y-1 min-w-[140px]">
      <div className="h-1 rounded-full bg-ink/10 overflow-hidden">
        <div
          className="h-full transition-all"
          style={{
            width: `${progress * 100}%`,
            background: color,
          }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[9px] font-mono text-ink-faint uppercase tracking-[0.13em]">
        <span>{tier.min}</span>
        <span>
          {tier.id === "diamond" ? "1000" : tier.max}
        </span>
      </div>
    </div>
  );
}
