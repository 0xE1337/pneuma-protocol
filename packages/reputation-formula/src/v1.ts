/**
 * v1 — Economic conviction-weighted reputation
 *
 * 公式：
 *   score = sqrt(volume_usdc) × ageFactor × repMultiplier × decayFactor
 *           × weightedAvgRating × 5    (clamp to [0, 100])
 *
 *   - volume_usdc    ：累计 paidAmount / 10^6（USDC 6 decimals）
 *   - ageFactor      ：min(1, daysSinceFirst / 30)
 *   - repMultiplier  ：1 + 0.1·log₂(validCount + 1) − 0.5·revokedRatio
 *   - decayFactor    ：max(0, 1 − 0.023·idleDays)
 *   - weightedAvgRating：按 raterRole 加权平均（CALLER 1.5×, PROVIDER 1.0×,
 *     JUROR 2.0×；SYSTEM 视为 1.0×）
 *
 * 设计意图：
 *   - sqrt 抑制刷小单
 *   - log₂ 鼓励持续活跃
 *   - decay 惩罚 idle
 *   - revokedRatio 惩罚被撤销
 *   - role weight 防 provider 自刷（CALLER 是真金白银付费方，权重更高）
 *
 * 与协议层关系：所有 input 都来自 PneumaAttestation 合约 view function，
 * 公式纯前端可重算 → 任何 dApp 一行 import + 一行 RPC 即可复现同一分数。
 */

import { USDC_DECIMALS, ROLE_WEIGHTS, AGE_RAMP_DAYS, DECAY_LAMBDA } from "./constants.js";
import type { AttestationLike, ReputationBreakdown } from "./types.js";

const USDC_SCALE = 10 ** USDC_DECIMALS;

/**
 * 单 recipient（TBA 或 EOA）的 conviction-weighted reputation
 *
 * @param attestations 该 recipient 的所有 attestation（合约 getAttestationsByRecipient 返回）
 * @param now 当前时间 unix seconds（默认系统时间，测试可注入）
 */
export function computeReputation(
  attestations: AttestationLike[],
  now: number = Date.now() / 1000,
): ReputationBreakdown {
  const valid = attestations.filter((a) => !a.revoked);

  if (valid.length === 0) return zeroBreakdown();

  const totalVolumeRaw = valid.reduce((s, a) => s + a.paidAmount, 0n);
  const totalVolumeUsdc = Number(totalVolumeRaw) / USDC_SCALE;
  const volumeFactor = Math.sqrt(totalVolumeUsdc);

  const earliest = valid.reduce(
    (min, a) => (a.timestamp < min ? a.timestamp : min),
    valid[0]!.timestamp,
  );
  const latest = valid.reduce(
    (max, a) => (a.timestamp > max ? a.timestamp : max),
    valid[0]!.timestamp,
  );

  const ageDays = Math.max(0, (now - Number(earliest)) / 86400);
  const idleDays = Math.max(0, (now - Number(latest)) / 86400);

  const ageFactor = Math.min(1, ageDays / AGE_RAMP_DAYS);

  const totalCount = attestations.length;
  const revokedCount = attestations.filter((a) => a.revoked).length;
  const revokedRatio = totalCount > 0 ? revokedCount / totalCount : 0;
  const logBoost = Math.log2(valid.length + 1) * 0.1;
  const repMultiplier = Math.max(0, 1 + logBoost - 0.5 * revokedRatio);

  const decayFactor = Math.max(0, 1 - DECAY_LAMBDA * idleDays);

  // raterRole 加权平均星级
  const callerAtt = valid.filter((a) => a.raterRole === 1);
  const providerAtt = valid.filter((a) => a.raterRole === 0);
  const avgRatingByCaller =
    callerAtt.length > 0
      ? callerAtt.reduce((s, a) => s + a.rating, 0) / callerAtt.length
      : 0;
  const avgRatingByProvider =
    providerAtt.length > 0
      ? providerAtt.reduce((s, a) => s + a.rating, 0) / providerAtt.length
      : 0;

  const totalWeight = valid.reduce(
    (sum, a) => sum + (ROLE_WEIGHTS[a.raterRole] ?? 1),
    0,
  );
  const weightedRatingSum = valid.reduce(
    (sum, a) => sum + a.rating * (ROLE_WEIGHTS[a.raterRole] ?? 1),
    0,
  );
  const weightedAvgRating = totalWeight > 0 ? weightedRatingSum / totalWeight : 0;

  const rawScore =
    volumeFactor * ageFactor * repMultiplier * decayFactor * weightedAvgRating;
  const score = Math.min(100, Math.max(0, rawScore * 5));

  return {
    score,
    volumeFactor,
    ageFactor,
    repMultiplier,
    decayFactor,
    avgRatingByCaller,
    avgRatingByProvider,
    validCount: valid.length,
    totalVolumeRaw,
    idleDays,
  };
}

function zeroBreakdown(): ReputationBreakdown {
  return {
    score: 0,
    volumeFactor: 0,
    ageFactor: 0,
    repMultiplier: 0,
    decayFactor: 1,
    avgRatingByCaller: 0,
    avgRatingByProvider: 0,
    validCount: 0,
    totalVolumeRaw: 0n,
    idleDays: 0,
  };
}

/** UI 短文本格式化（小数位自适应） */
export function formatScore(s: number): string {
  return s >= 1 ? s.toFixed(1) : s.toFixed(2);
}
