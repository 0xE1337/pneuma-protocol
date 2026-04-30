/**
 * v2 — 4-Dimensional Conviction-Weighted Reputation
 *
 * V6.0.3 把 reputation 从单一 economic 公式扩展为 4 个独立维度，对应"agent
 * 社会"的 4 种价值贡献：
 *
 *   1. Economic     — 付费交易历史（v1 复用 PneumaAttestation）
 *   2. Intellectual — PneumaCommons 发布 + 被引用
 *   3. Social       — ReputationGraph 被担保 stake + 担保人数
 *   4. Judicial     — PneumaCourt 陪审员表现（V6.1，目前 placeholder = 0）
 *
 * 总分 = 4 维加权和（DIM_WEIGHTS）
 *
 * 设计原则：
 *   - 公式 + 数据全公开 → 任意 dApp 可重算同一分数
 *   - 每个维度独立 sqrt + age + decay，防单维度刷量主导总分
 *   - retracted publication / inactive endorsement 不计入
 */

import { USDC_DECIMALS, AGE_RAMP_DAYS, DECAY_LAMBDA, DIM_WEIGHTS } from "./constants.js";
import { computeReputation } from "./v1.js";
import type {
  AttestationLike,
  PublicationLike,
  EndorsementLike,
  DimensionScore,
  ReputationV2Breakdown,
} from "./types.js";

const USDC_SCALE = 10 ** USDC_DECIMALS;

// ───────────────────────── Economic (v1 复用) ─────────────────────────

export function computeEconomicScore(
  attestations: AttestationLike[],
  now: number = Date.now() / 1000,
): DimensionScore {
  const v1 = computeReputation(attestations, now);
  return {
    score: v1.score,
    detail: {
      validCount: v1.validCount,
      totalVolumeUsdc: (Number(v1.totalVolumeRaw) / USDC_SCALE).toFixed(2),
      avgRatingCaller: v1.avgRatingByCaller.toFixed(2),
      avgRatingProvider: v1.avgRatingByProvider.toFixed(2),
      idleDays: v1.idleDays.toFixed(1),
    },
  };
}

// ───────────────────────── Intellectual (V6.0.1) ─────────────────────────

/**
 * Intellectual = sqrt(totalCitations) × ageFactor × decay × 8（clamp ≤ 100）
 *
 * - sqrt 抑制单 publication 刷量
 * - ageFactor 鼓励持续贡献
 * - 0 citation 时给底分 = min(10, count × 2) 鼓励发布
 */
export function computeIntellectualScore(
  publications: PublicationLike[],
  now: number = Date.now() / 1000,
): DimensionScore {
  const valid = publications.filter((p) => !p.retracted);
  if (valid.length === 0) {
    return { score: 0, detail: { publications: 0, citations: 0 } };
  }

  const totalCitations = valid.reduce((s, p) => s + Number(p.citationCount), 0);

  if (totalCitations === 0) {
    const baseScore = Math.min(10, valid.length * 2);
    return {
      score: baseScore,
      detail: {
        publications: valid.length,
        citations: 0,
        baseFromPublishing: baseScore.toFixed(1),
      },
    };
  }

  const earliest = valid.reduce(
    (min, p) => (p.publishedAt < min ? p.publishedAt : min),
    valid[0]!.publishedAt,
  );
  const latest = valid.reduce(
    (max, p) => (p.publishedAt > max ? p.publishedAt : max),
    valid[0]!.publishedAt,
  );

  const ageDays = Math.max(0, (now - Number(earliest)) / 86400);
  const idleDays = Math.max(0, (now - Number(latest)) / 86400);
  const ageFactor = Math.min(1, ageDays / AGE_RAMP_DAYS);
  const decayFactor = Math.max(0, 1 - DECAY_LAMBDA * idleDays);

  const sqrtCitations = Math.sqrt(totalCitations);
  const rawScore = sqrtCitations * ageFactor * decayFactor * 8;
  const score = Math.min(100, rawScore);

  return {
    score,
    detail: {
      publications: valid.length,
      citations: totalCitations,
      avgCitationsPerPub: (totalCitations / valid.length).toFixed(2),
      ageFactor: ageFactor.toFixed(2),
      decayFactor: decayFactor.toFixed(2),
      idleDays: idleDays.toFixed(1),
    },
  };
}

// ───────────────────────── Social (V6.0.2) ─────────────────────────

/**
 * Social = sqrt(totalActiveStakeUsdc) × diversity × ageFactor × 6（clamp ≤ 100）
 *
 * - diversity = min(uniqueEndorsers / 5, 1)，5+ 担保人 = 满 diversity
 * - 仅 active 担保计入；withdraw 后即时归零
 */
export function computeSocialScore(
  endorsementsReceived: EndorsementLike[],
  now: number = Date.now() / 1000,
): DimensionScore {
  const active = endorsementsReceived.filter((e) => e.active);

  if (active.length === 0) {
    return { score: 0, detail: { activeEndorsements: 0, totalStakeUsdc: 0 } };
  }

  const totalStakeRaw = active.reduce((s, e) => s + Number(e.stakedAmount), 0);
  const totalStakeUsdc = totalStakeRaw / USDC_SCALE;

  const diversity = Math.min(active.length / 5, 1);

  const earliest = active.reduce(
    (min, e) => (e.startedAt < min ? e.startedAt : min),
    active[0]!.startedAt,
  );
  const ageDays = Math.max(0, (now - Number(earliest)) / 86400);
  const ageFactor = Math.min(1, ageDays / AGE_RAMP_DAYS);

  const rawScore = Math.sqrt(totalStakeUsdc) * diversity * ageFactor * 6;
  const score = Math.min(100, rawScore);

  return {
    score,
    detail: {
      activeEndorsements: active.length,
      totalStakeUsdc: totalStakeUsdc.toFixed(2),
      diversity: diversity.toFixed(2),
      ageFactor: ageFactor.toFixed(2),
    },
  };
}

// ───────────────────────── Judicial (V6.1 placeholder) ─────────────────────────

/** V6.1 PneumaCourt ship 后实现 */
export function computeJudicialScore(_juryHistory: unknown[] = []): DimensionScore {
  return {
    score: 0,
    detail: {
      verdicts: 0,
      accuracy: "—",
      note: "V6.1 Roadmap (PneumaCourt)",
    },
  };
}

// ───────────────────────── Combined v2 ─────────────────────────

export function computeReputationV2(args: {
  attestations: AttestationLike[];
  publications?: PublicationLike[];
  endorsementsReceived?: EndorsementLike[];
  juryHistory?: unknown[];
  now?: number;
}): ReputationV2Breakdown {
  const now = args.now ?? Date.now() / 1000;

  const economic = computeEconomicScore(args.attestations, now);
  const intellectual = computeIntellectualScore(args.publications ?? [], now);
  const social = computeSocialScore(args.endorsementsReceived ?? [], now);
  const judicial = computeJudicialScore(args.juryHistory ?? []);

  const total =
    economic.score * DIM_WEIGHTS.economic +
    intellectual.score * DIM_WEIGHTS.intellectual +
    social.score * DIM_WEIGHTS.social +
    judicial.score * DIM_WEIGHTS.judicial;

  return { total, economic, intellectual, social, judicial };
}
