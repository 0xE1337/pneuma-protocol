/**
 * effective-tier.ts — 整合声誉段位 + 诚信段位 + 段位 hard cap 的最终段位决策
 *
 * 这一层把 v3 输出 + boundary 触发数 + court guilty 历史叠加，得出**用户实际看到的**
 * 双层段位状态。
 *
 * 决策顺序（重要）：
 *   1. 先把 raw display score 扣减 boundary penalty（candidate -200 / observed -500）
 *   2. 调 getTier 拿声誉段位（Newcomer→Diamond）
 *   3. 如果 hasGuiltyRecord（court 判过）→ 钳制声誉段位 ≤ Silver
 *   4. boundary tier 单独计算（与声誉段位 orthogonal）
 *
 * 输出供 UI 渲染双层徽章：「💎 Diamond · ✅ 锚定」/「🥇 Gold · ⚠ 候选」/
 * 「🥈 Silver · 🛑 冻结」。
 */

import {
  scaleToDisplayScore,
  getTier,
  TIERS,
  type TierMeta,
} from "./tier.js";
import {
  applyBoundaryPenalty,
  type BoundaryTierMeta,
} from "./boundary-tier.js";

/** 声誉段位顺序索引（用于 hard cap 比较） */
const TIER_ORDER_INDEX: Record<string, number> = {
  newcomer: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
  diamond: 5,
};

const SILVER_TIER = TIERS.find((t) => t.id === "silver")!;

export interface EffectiveTier {
  /** 调整后的 display score (0-1000)，已扣 boundary penalty */
  displayScore: number;
  /** 声誉段位（能力维度），可能被 hard cap 钳到 Silver */
  reputationTier: TierMeta;
  /** 诚信段位（合规维度，与 reputationTier orthogonal） */
  integrityTier: BoundaryTierMeta;
  /** 是否被 court guilty hard cap 钳过段位 */
  cappedByGuilty: boolean;
  /** 是否冻结声誉增长（boundary frozen） */
  growthFrozen: boolean;
  /** 钳前的 raw display score（debug + UI 提示用） */
  rawDisplayScore: number;
}

/**
 * 整合输入：v3 breakdown 总分 (0-100) + boundary 触发数 + 是否有 guilty 历史
 *
 * @param rawTotal      v3 输出的 total（0-100）
 * @param triggers12mo  rolling 12 个月内 OwnershipBoundary 触发数
 * @param hasGuiltyRecord 是否被 court 判过 guilty
 */
export function getEffectiveTier(
  rawTotal: number,
  triggers12mo: number,
  hasGuiltyRecord: boolean,
): EffectiveTier {
  // 1. 0-100 → 0-1000 display
  const rawDisplayScore = scaleToDisplayScore(rawTotal);

  // 2. 扣 boundary penalty
  const { adjustedScore, tier: integrityTier } = applyBoundaryPenalty(
    rawDisplayScore,
    triggers12mo,
  );

  // 3. 拿声誉段位
  let reputationTier = getTier(adjustedScore);

  // 4. court guilty hard cap → 钳到 Silver
  let cappedByGuilty = false;
  if (
    hasGuiltyRecord &&
    (TIER_ORDER_INDEX[reputationTier.id] ?? 0) >
      (TIER_ORDER_INDEX["silver"] ?? 2)
  ) {
    reputationTier = SILVER_TIER;
    cappedByGuilty = true;
  }

  return {
    displayScore: adjustedScore,
    reputationTier,
    integrityTier,
    cappedByGuilty,
    growthFrozen: integrityTier.growthFrozen,
    rawDisplayScore,
  };
}
