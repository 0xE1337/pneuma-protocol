/**
 * boundary-tier.ts — 反洗白诚信段位 + 阶梯惩罚
 *
 * 跟 tier.ts（声誉段位）orthogonal：
 *   - 声誉段位（Newcomer→Diamond）= 你做得多好（能力维度）
 *   - 诚信段位（锚定/候选/观测/冻结）= 你结构上多干净（合规维度）
 *
 * 触发器：OwnershipBoundary attestation（Soul transfer 时合约层检测多 Soul /
 * 频繁转移 / IP 集群等结构性指纹后写入）。
 *
 * 阶梯设计（rolling 12 个月窗口）：
 *
 *   首次触发：扣 200 分 + 降级到「候选」
 *   二次触发：再扣 300 分 + 降级到「观测」
 *   三次触发：永久冻结声誉**增长**（分数能保但不能涨） → 「冻结」
 *
 * Rolling 12 个月：12 个月外的触发自动滑出窗口。防止合规老用户秋后算账。
 *
 * 申诉路径：冻结状态可通过 Governor / DAO 决议解封（链下流程）。
 *
 * 配套文档：[docs/PUNISHMENT_DESIGN.md](../../../docs/PUNISHMENT_DESIGN.md)
 */

/** 阶梯惩罚的扣分系数（display score 维度，0-1000） */
export const BOUNDARY_PENALTY = {
  /** 首次触发扣 200 display score */
  FIRST_HIT: 200,
  /** 二次触发再扣 300 display score（与首次叠加 = -500） */
  SECOND_HIT: 300,
  /** 三次触发不再扣分，但冻结增长 */
  THIRD_HIT_FREEZE: true,
} as const;

/** 12 个月的滚动窗口（秒） */
export const ROLLING_WINDOW_SECONDS = 365 * 24 * 60 * 60;

/** 诚信段位 ID */
export type BoundaryTierId = "anchored" | "candidate" | "observed" | "frozen";

export interface BoundaryTierMeta {
  id: BoundaryTierId;
  zhName: string;
  enName: string;
  emoji: string;
  /** UI 颜色（与 ReputationBadge 颜色策略一致：避免 tailwind 动态 class purge） */
  color: string;
  /** 一句话说明该段位含义 */
  description: string;
  /** 该段位下的扣分（累计 from 锚定的 displayScore 起算） */
  penaltyFromAnchor: number;
  /** 是否冻结声誉增长（true → 分数定格，不能涨） */
  growthFrozen: boolean;
}

export const BOUNDARY_TIERS: Record<BoundaryTierId, BoundaryTierMeta> = {
  anchored: {
    id: "anchored",
    zhName: "锚定",
    enName: "Anchored",
    emoji: "✅",
    color: "#10b981", // emerald-500
    description: "结构干净，未触发反洗白边界",
    penaltyFromAnchor: 0,
    growthFrozen: false,
  },
  candidate: {
    id: "candidate",
    zhName: "候选",
    enName: "Candidate",
    emoji: "⚠",
    color: "#f59e0b", // amber-500
    description: "12 个月内 1 次反洗白边界触发，扣 200 分",
    penaltyFromAnchor: BOUNDARY_PENALTY.FIRST_HIT,
    growthFrozen: false,
  },
  observed: {
    id: "observed",
    zhName: "观测",
    enName: "Observed",
    emoji: "🔴",
    color: "#ef4444", // red-500
    description: "12 个月内 2 次反洗白边界触发，累计扣 500 分",
    penaltyFromAnchor:
      BOUNDARY_PENALTY.FIRST_HIT + BOUNDARY_PENALTY.SECOND_HIT,
    growthFrozen: false,
  },
  frozen: {
    id: "frozen",
    zhName: "冻结",
    enName: "Frozen",
    emoji: "🛑",
    color: "#dc2626", // red-600
    description: "12 个月内 3+ 次触发，声誉增长永久冻结，需人工申诉",
    penaltyFromAnchor:
      BOUNDARY_PENALTY.FIRST_HIT + BOUNDARY_PENALTY.SECOND_HIT,
    growthFrozen: true,
  },
};

/**
 * 给定 rolling 12 个月内的 boundary 触发数，返回当前诚信段位。
 *
 *   0 触发  → anchored
 *   1 触发  → candidate
 *   2 触发  → observed
 *   3+ 触发 → frozen
 */
export function getBoundaryTier(triggers12mo: number): BoundaryTierMeta {
  if (triggers12mo <= 0) return BOUNDARY_TIERS.anchored;
  if (triggers12mo === 1) return BOUNDARY_TIERS.candidate;
  if (triggers12mo === 2) return BOUNDARY_TIERS.observed;
  return BOUNDARY_TIERS.frozen;
}

/**
 * 从一组 OwnershipBoundary attestation timestamp 数组里，过滤出
 * rolling 12 个月内的触发数。12 个月外的自动滑出窗口。
 *
 * @param triggerTimestamps OwnershipBoundary attestation 的 timestamp 数组（unix seconds）
 * @param now 当前时间（unix seconds），默认 Date.now()/1000
 */
export function countRollingBoundaryTriggers(
  triggerTimestamps: readonly bigint[],
  now: number = Date.now() / 1000,
): number {
  const cutoff = now - ROLLING_WINDOW_SECONDS;
  return triggerTimestamps.filter((ts) => Number(ts) >= cutoff).length;
}

/**
 * 把诚信段位的扣分应用到 display score 上。
 *
 *   anchored  → score 不变
 *   candidate → score - 200
 *   observed  → score - 500
 *   frozen    → score - 500（不再加扣分，但 growthFrozen=true）
 *
 * 最终结果 clamp 到 [0, 1000]。
 */
export function applyBoundaryPenalty(
  rawDisplayScore: number,
  triggers12mo: number,
): { adjustedScore: number; tier: BoundaryTierMeta } {
  const tier = getBoundaryTier(triggers12mo);
  const adjusted = Math.max(0, rawDisplayScore - tier.penaltyFromAnchor);
  return { adjustedScore: adjusted, tier };
}
