/**
 * tier.ts — 声誉段位 + display 缩放
 *
 * 现状：computeReputationV2 输出 total ∈ [0, 100]（4 维各自 clamp 100，加权 sum 仍 ≤ 100）。
 * 问题：UI 上 "声誉 73.8" vs "声誉 75.2" 视觉差异不强。
 *
 * 方案（双 channel）：
 *   1. 把 0-100 × 10 → 0-1000 整数显示，让"分数大 = 厉害"立刻可读
 *   2. 加段位（Newcomer / Bronze / Silver / Gold / Platinum / Diamond），
 *      给排行榜打段位徽章 + 顶部段位排名（"#14 / 412 in Gold"）
 *
 * 段位区间是产品决策，不是合约 invariant —— 调整时只动这个文件。
 */

/** 0-100 → 0-1000（整数，便于 UI 直接渲染数字） */
export function scaleToDisplayScore(rawTotal: number): number {
  if (!Number.isFinite(rawTotal) || rawTotal <= 0) return 0;
  return Math.round(Math.min(100, rawTotal) * 10);
}

/** 段位元数据 */
export interface TierMeta {
  /** 段位英文 ID，URL/program 用 */
  id: TierId;
  /** 中文展示名 */
  zhName: string;
  /** 英文展示名 */
  enName: string;
  /** Unicode emoji，徽章图形 */
  emoji: string;
  /** 配色（tailwind class fragment，建议挂 text-{color}） */
  color: string;
  /** display score (0-1000) 区间下界（含） */
  min: number;
  /** display score (0-1000) 区间上界（不含；最高段为 1001 表示无穷） */
  max: number;
}

export type TierId =
  | "newcomer"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond";

/**
 * 段位表（display score 0-1000 区间）
 *
 * 排序：从低到高。getTier() 用线性扫描 + < max 判定。
 */
export const TIERS: ReadonlyArray<TierMeta> = [
  {
    id: "newcomer",
    zhName: "新人",
    enName: "Newcomer",
    emoji: "⚪",
    color: "ink-faint",
    min: 0,
    max: 100,
  },
  {
    id: "bronze",
    zhName: "铜",
    enName: "Bronze",
    emoji: "🥉",
    color: "amber-600",
    min: 100,
    max: 300,
  },
  {
    id: "silver",
    zhName: "银",
    enName: "Silver",
    emoji: "🥈",
    color: "slate-300",
    min: 300,
    max: 500,
  },
  {
    id: "gold",
    zhName: "金",
    enName: "Gold",
    emoji: "🥇",
    color: "yellow-400",
    min: 500,
    max: 700,
  },
  {
    id: "platinum",
    zhName: "铂",
    enName: "Platinum",
    emoji: "💠",
    color: "cyan",
    min: 700,
    max: 900,
  },
  {
    id: "diamond",
    zhName: "钻",
    enName: "Diamond",
    emoji: "💎",
    color: "magenta",
    min: 900,
    max: 1001,
  },
] as const;

/**
 * 给定 display score (0-1000)，返回对应段位元数据。
 * 边界：score < 0 视作 0；score > 1000 视作 1000；NaN 也走 newcomer。
 */
export function getTier(displayScore: number): TierMeta {
  if (!Number.isFinite(displayScore) || displayScore <= 0) return TIERS[0]!;
  const clamped = Math.min(1000, displayScore);
  for (const tier of TIERS) {
    if (clamped >= tier.min && clamped < tier.max) return tier;
  }
  return TIERS[TIERS.length - 1]!;
}

/**
 * 在某段位内的进度（0-1，下界 = 0，上界 = 1）。
 * 用于 ProgressBar 渲染"距离下一段位多远"。
 *
 * 注意：最高段位（diamond）的 max 是 exclusive 1001（用于 getTier 的 < 比较），
 * 但显示进度时我们想让 score=1000 == 1.0（顶满 progress bar），
 * 所以最高段位用 hard-cap 1000 当分母上界。
 */
export function tierProgress(displayScore: number): number {
  const tier = getTier(displayScore);
  const isTop = tier === TIERS[TIERS.length - 1];
  const upper = isTop ? 1000 : tier.max;
  const range = upper - tier.min;
  if (range <= 0) return 1;
  return Math.max(0, Math.min(1, (displayScore - tier.min) / range));
}

/**
 * 排行榜：把一组 display score 按 desc 排序后，给定目标 score 的段位内排名 + 段位人数。
 *
 * 适合「#14 / 412 in Gold」展示。
 *
 * 注意：传入数组应该是 *已过滤到同段位* 的，函数本身不再过滤——这样调用方
 * 可以自由组合（按段位、按类目、按时间窗）。
 */
export function rankInTier(
  scoresInTier: number[],
  myScore: number,
): { rank: number; total: number } {
  const sorted = [...scoresInTier].sort((a, b) => b - a);
  const rank = sorted.findIndex((s) => s <= myScore) + 1;
  return {
    rank: rank > 0 ? rank : sorted.length + 1,
    total: sorted.length,
  };
}
