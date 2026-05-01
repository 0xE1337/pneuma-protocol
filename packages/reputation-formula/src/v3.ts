/**
 * v3 — Court-aware Reputation
 *
 * 在 v2 4 维基础上引入 3 个改动，让"被法庭判过 / 被罚过"在公式里有刻度：
 *
 *   1. punishmentFactor —— Economic 维度按 court guilty 占比衰减
 *      Laplace smoothing 防 0 案件 100% 失血
 *
 *   2. slashedRatio —— Social 维度按"担保过的人多少被 slash"反向衰减
 *      防"恶意背书"——你不能给坏人当背书又不承担信誉成本
 *
 *   3. judicial 真实化 —— v2 是 placeholder=0；v3 算 jurorVerdict 跟最终
 *      多数决一致的比例（accuracy），鼓励陪审员认真审而不是跟风
 *
 * v3 的核心承诺：**输入兼容 v2**——如果不传 court / endorseesGiven 数据，
 * factor / ratio 都是 0，judicial 仍是 0，等价于 v2 行为。所以现有 v2
 * 调用方升级到 v3 是 strict subset → superset，不破坏。
 *
 * 段位 hard cap **不在这里**实现，是调用方决策（参见 boundary-tier.ts
 * 的 getEffectiveTier）。这样公式纯粹算分，UI / 业务方决定怎么钳。
 */

import { DECAY_LAMBDA, DIM_WEIGHTS } from "./constants.js";
import {
  computeEconomicScore,
  computeIntellectualScore,
  computeSocialScore,
} from "./v2.js";
import type {
  AttestationLike,
  PublicationLike,
  EndorsementLike,
  DimensionScore,
  ReputationV3Breakdown,
  DisputeRecordLike,
  JurorVoteLike,
} from "./types.js";

// ────────────────────────── Punishment factor ──────────────────────────

/**
 * Court guilty 占比衰减
 *
 * factor = guiltyCount / (guiltyCount + innocentCount + 5)
 *                                                   ^^^ Laplace smoothing
 *
 * 0 / 0  → 0       （没案，不衰减）
 * 1 / 0  → 0.167   （Economic × 0.83）
 * 3 / 1  → 0.333   （Economic × 0.67）
 * 5 / 0  → 0.500   （Economic 砍半）
 * 9 / 1  → 0.600   （Economic × 0.40）
 *
 * @param disputes 与该 agent 相关的全部 dispute（无论作为 plaintiff / defendant）
 * @param defendantAddress 当前 agent 地址（小写归一化）
 */
export function computePunishmentFactor(
  disputes: readonly DisputeRecordLike[],
  defendantAddress: `0x${string}`,
): { factor: number; guiltyCount: number; innocentCount: number } {
  const lower = defendantAddress.toLowerCase();
  let guiltyCount = 0;
  let innocentCount = 0;

  for (const d of disputes) {
    // 只算 agent 作为 defendant 的案件（被诉方）
    if (d.defendant.toLowerCase() !== lower) continue;
    // 只算已 resolve 的案件
    if (d.status !== 2) continue;
    if (d.verdict === 1) guiltyCount++;
    else if (d.verdict === 2) innocentCount++;
  }

  const factor = guiltyCount / (guiltyCount + innocentCount + 5);
  return { factor, guiltyCount, innocentCount };
}

// ────────────────────────── Slashed ratio (反向背书) ──────────────────────────

/**
 * 「我担保过的 N 个 agent 里有 M 个被 slash」反向衰减系数
 *
 * ratio = slashedCount / (totalCount + 1)
 *
 * 0 / 0  → 0       （没担保过，不影响）
 * 0 / 5  → 0       （担保 5 个全干净）
 * 1 / 5  → 0.167   （Social × 0.83）
 * 2 / 5  → 0.333   （Social × 0.67）
 * 3 / 3  → 0.75    （Social × 0.25）
 *
 * @param endorseesGiven 当前 agent 给别人写的担保（outgoing endorsements）
 * @param slashedEndorseesCount 这些被担保人里被 slash 过的数量
 *        （可由调用方扫 SkillRegistry.CallSlashed 事件聚合）
 */
export function computeSlashedRatio(
  endorseesGiven: readonly EndorsementLike[],
  slashedEndorseesCount: number,
): { ratio: number; totalEndorsements: number } {
  const total = endorseesGiven.length;
  const ratio = slashedEndorseesCount / (total + 1);
  return { ratio, totalEndorsements: total };
}

// ────────────────────────── Judicial 真实化 ──────────────────────────

/**
 * Judicial = sqrt(votedCount) × accuracy × decayFactor × 8（clamp ≤ 100）
 *
 * - sqrt 抑制单 dispute 刷量
 * - accuracy = jurorVerdict 跟 finalVerdict 一致的次数 / 总投过票数
 * - decay 用最新一次投票的 idleDays
 *
 * 鼓励陪审员认真审 —— 跟风者 accuracy 低，judicial 分低，总分受限。
 */
export function computeJudicialScoreV3(
  votes: readonly JurorVoteLike[],
  now: number = Date.now() / 1000,
): DimensionScore {
  // 只算已投票（jurorVerdict 非 PENDING）+ dispute 已 resolve（finalVerdict 非 PENDING）
  const voted = votes.filter(
    (v) => v.jurorVerdict !== 0 && v.finalVerdict !== 0,
  );

  if (voted.length === 0) {
    return {
      score: 0,
      detail: { totalVotes: 0, accuracy: 0, note: "no resolved jury votes yet" },
    };
  }

  const correct = voted.filter((v) => v.jurorVerdict === v.finalVerdict).length;
  const accuracy = correct / voted.length;

  // 用最新一次投票的 idle days 算 decay
  const latest = voted.reduce((max, v) => {
    const filed = Number(v.filedAt ?? 0n);
    return filed > max ? filed : max;
  }, 0);
  const idleDays = latest > 0 ? Math.max(0, (now - latest) / 86400) : 999;
  const decayFactor = Math.max(0, 1 - DECAY_LAMBDA * idleDays);

  const sqrtVotes = Math.sqrt(voted.length);
  const rawScore = sqrtVotes * accuracy * decayFactor * 8;
  const score = Math.min(100, rawScore);

  return {
    score,
    detail: {
      totalVotes: voted.length,
      correctVotes: correct,
      accuracy: accuracy.toFixed(2),
      decayFactor: decayFactor.toFixed(2),
      idleDays: idleDays.toFixed(1),
    },
  };
}

// ────────────────────────── Combined v3 ──────────────────────────

/**
 * 完整 v3 reputation：v2 + court 感知
 *
 * 数据流：
 *   1. 调用方 fetch 所有 v2 输入（attestations / publications / endorsementsReceived）
 *   2. 调用方 fetch v3 新输入（disputes / endorseesGiven / slashedEndorseesCount / jurorVotes）
 *   3. 把全部数据传给本函数
 *   4. 拿到 ReputationV3Breakdown，按段位 hard cap 决策（boundary-tier.ts）
 *
 * 兼容性：v3 输入是 v2 输入的超集；v3 新字段 default 空数组 → factor / ratio = 0
 * → 等价于 v2 行为。所以 v2 调用方升级到 v3 不破坏。
 */
export function computeReputationV3(args: {
  // v2 inputs（必填）
  attestations: AttestationLike[];
  publications?: PublicationLike[];
  endorsementsReceived?: EndorsementLike[];

  // v3 新加（选填，缺省退化为 v2 行为）
  /** 该 agent 作为 defendant 的全部 dispute */
  disputes?: DisputeRecordLike[];
  /** 该 agent 作为 endorser 的全部 outgoing endorsements */
  endorseesGiven?: EndorsementLike[];
  /** endorseesGiven 中被 slash 过的数量（调用方扫链上事件聚合） */
  slashedEndorseesCount?: number;
  /** 该 agent 作为 juror 的全部投票 */
  jurorVotes?: JurorVoteLike[];

  /** 当前 agent 地址（小写归一化），用于 punishment factor 过滤 dispute */
  defendantAddress: `0x${string}`;

  /** rolling 12 个月内 OwnershipBoundary 触发数（调用方扫 attestation 聚合） */
  boundaryTriggers12mo?: number;

  now?: number;
}): ReputationV3Breakdown {
  const now = args.now ?? Date.now() / 1000;

  // v2 维度计算（完整复用）
  const economicV2 = computeEconomicScore(args.attestations, now);
  const intellectual = computeIntellectualScore(args.publications ?? [], now);
  const socialV2 = computeSocialScore(args.endorsementsReceived ?? [], now);

  // v3 punishment factor (Court guilty)
  const { factor: punishmentFactor, guiltyCount, innocentCount } =
    computePunishmentFactor(args.disputes ?? [], args.defendantAddress);

  // v3 slashed ratio (反向背书)
  const { ratio: slashedRatio } = computeSlashedRatio(
    args.endorseesGiven ?? [],
    args.slashedEndorseesCount ?? 0,
  );

  // v3 judicial 真实化
  const judicial = computeJudicialScoreV3(args.jurorVotes ?? [], now);

  // 叠加 v3 调整
  const economic: DimensionScore = {
    score: economicV2.score * (1 - punishmentFactor),
    detail: {
      ...economicV2.detail,
      punishmentFactor: punishmentFactor.toFixed(3),
      guiltyCount,
      innocentCount,
    },
  };

  const social: DimensionScore = {
    score: socialV2.score * (1 - slashedRatio),
    detail: {
      ...socialV2.detail,
      slashedRatio: slashedRatio.toFixed(3),
      slashedEndorsees: args.slashedEndorseesCount ?? 0,
    },
  };

  // v3 总分 (与 v2 同公式，但底层维度已经叠加了惩罚)
  const total =
    economic.score * DIM_WEIGHTS.economic +
    intellectual.score * DIM_WEIGHTS.intellectual +
    social.score * DIM_WEIGHTS.social +
    judicial.score * DIM_WEIGHTS.judicial;

  return {
    total,
    economic,
    intellectual,
    social,
    judicial,
    punishmentFactor,
    slashedRatio,
    hasGuiltyRecord: guiltyCount > 0,
    boundaryTriggers12mo: args.boundaryTriggers12mo ?? 0,
  };
}
