"use client";

/**
 * ReputationBadge — 列表卡片用的双层徽章
 *
 * 双层 = 声誉段位（能力维度）+ 诚信段位（合规维度），orthogonal：
 *   - 声誉段位：Newcomer ⚪ → Bronze 🥉 → Silver 🥈 → Gold 🥇 → Platinum 💠 → Diamond 💎
 *   - 诚信段位：Anchored ✅ → Candidate ⚠ → Observed 🔴 → Frozen 🛑
 *
 * 三种 size：
 *   - sm  → 一行紧凑：「💎 738 ✅」
 *   - md  → 两行：声誉徽章 + 诚信状态 chip
 *   - lg  → md + 段位进度条 + cap 警告
 *
 * 向后兼容：boundaryTriggers12mo / hasGuiltyRecord 都是可选，缺省 0/false →
 * integrityTier = anchored、cappedByGuilty = false → 跟旧版渲染一致。
 *
 * 设计原则：
 *   - 0 deps，纯 SVG/HTML
 *   - 颜色直接挂 inline style（避免 tailwind purge 拆 dynamic class）
 *   - 段位决策走 @pneuma/reputation-formula 的 getEffectiveTier，
 *     单一真相源；任何 dApp 复用都能渲染同样徽章。
 */

import {
  getEffectiveTier,
  tierProgress,
  type TierMeta,
} from "@pneuma/reputation-formula";

interface BadgeProps {
  /** 0-100 raw v2/v3 total (computeReputationV2/V3 输出) */
  rawTotal: number;
  /** 排行榜场景：当前段位排名 + 段位人数 → "#14 / 412" */
  rankInTier?: { rank: number; total: number };
  /** sm | md | lg */
  size?: "sm" | "md" | "lg";
  /** rolling 12 个月内 OwnershipBoundary 触发数（默认 0） */
  boundaryTriggers12mo?: number;
  /** 是否有 Court guilty 历史（hard cap 触发条件，默认 false） */
  hasGuiltyRecord?: boolean;
}

/** 声誉段位 id → 颜色 hex */
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
  boundaryTriggers12mo = 0,
  hasGuiltyRecord = false,
}: BadgeProps) {
  const effective = getEffectiveTier(
    rawTotal,
    boundaryTriggers12mo,
    hasGuiltyRecord,
  );
  const { reputationTier, integrityTier, cappedByGuilty, growthFrozen } =
    effective;
  const repColor = TIER_COLORS[reputationTier.id] ?? "rgba(160,160,160,0.7)";
  const integrityColor = integrityTier.color;
  const showIntegrityChip = integrityTier.id !== "anchored";

  // 标题文字（hover 上显示完整说明）
  const fullTitle = [
    `${reputationTier.zhName}（${reputationTier.enName}）· raw ${rawTotal.toFixed(1)}/100`,
    showIntegrityChip ? `诚信：${integrityTier.zhName} — ${integrityTier.description}` : null,
    cappedByGuilty ? "段位被 Court guilty 钳制到 Silver" : null,
    growthFrozen ? "声誉增长已永久冻结，需人工申诉" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ─────────────────────── sm 紧凑模式 ───────────────────────
  if (size === "sm") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono"
        style={{
          color: repColor,
          background: `${repColor}1a`,
          border: `1px solid ${repColor}40`,
        }}
        title={fullTitle}
      >
        <span>{reputationTier.emoji}</span>
        <span className="font-semibold">{effective.displayScore}</span>
        {/* 诚信状态作为右侧小图标，仅在非 anchored 时显示 */}
        {showIntegrityChip && (
          <span
            style={{ color: integrityColor }}
            aria-label={integrityTier.zhName}
          >
            {integrityTier.emoji}
          </span>
        )}
      </span>
    );
  }

  // ─────────────────────── md / lg 模式 ───────────────────────
  return (
    <div className="inline-flex flex-col gap-1.5" title={fullTitle}>
      {/* 声誉行 —— 段位 emoji + 分数 + 段位名 + 段内排名 */}
      <div className="flex items-center gap-2.5">
        <span style={{ fontSize: "20px", lineHeight: 1 }}>
          {reputationTier.emoji}
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className="font-mono font-bold text-base leading-none"
              style={{ color: repColor }}
            >
              {effective.displayScore}
            </span>
            <span
              className="font-mono text-[10px] uppercase tracking-[0.13em]"
              style={{ color: repColor }}
            >
              {reputationTier.enName}
            </span>
            {cappedByGuilty && (
              <span
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  color: "#dc2626",
                  background: "rgba(220,38,38,0.12)",
                  border: "1px solid rgba(220,38,38,0.4)",
                }}
                title="Court guilty 历史 → 段位钳制到 Silver"
              >
                ⚠ capped
              </span>
            )}
          </div>
          {rankInTier && (
            <span className="font-mono text-[10px] text-ink-faint leading-none">
              #{rankInTier.rank} / {rankInTier.total} in {reputationTier.enName}
            </span>
          )}
        </div>
      </div>

      {/* 诚信状态行 —— 仅在非 anchored 时展示，避免视觉噪音 */}
      {showIntegrityChip && (
        <div
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono self-start"
          style={{
            color: integrityColor,
            background: `${integrityColor}14`,
            border: `1px solid ${integrityColor}55`,
          }}
        >
          <span>{integrityTier.emoji}</span>
          <span className="font-semibold uppercase tracking-wider">
            {integrityTier.zhName}
          </span>
          <span className="opacity-70">·</span>
          <span className="opacity-90">{integrityTier.description}</span>
        </div>
      )}

      {size === "lg" && (
        <TierProgressBar
          tier={reputationTier}
          displayScore={effective.displayScore}
          frozen={growthFrozen}
        />
      )}
    </div>
  );
}

function TierProgressBar({
  tier,
  displayScore,
  frozen,
}: {
  tier: TierMeta;
  displayScore: number;
  frozen: boolean;
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
            background: frozen ? "#dc2626" : color,
            opacity: frozen ? 0.6 : 1,
          }}
        />
      </div>
      <div className="flex items-baseline justify-between text-[9px] font-mono text-ink-faint uppercase tracking-[0.13em]">
        <span>{tier.min}</span>
        {frozen ? (
          <span style={{ color: "#dc2626" }}>🛑 冻结</span>
        ) : (
          <span>{tier.id === "diamond" ? "1000" : tier.max}</span>
        )}
      </div>
    </div>
  );
}
