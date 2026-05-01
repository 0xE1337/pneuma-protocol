/**
 * boundaryStats.ts — 从一组 attestation 算 OwnershipBoundary 触发统计
 *
 * 用于 ReputationBadge 的诚信段位渲染：
 *   - boundaryTriggers12mo: rolling 12 个月内 SYSTEM-rater 写入的 boundary attestation 数
 *
 * SYSTEM-rater attestation 由 SoulNFT 在 transfer 时合约层自动写入（防洗白核心抓手）；
 * 跟普通 PROVIDER/CALLER/JUROR 评分用 raterRole 字段区分。
 */

import { ROLLING_WINDOW_SECONDS } from "@pneuma/reputation-formula";
import { RATER_ROLE } from "@/lib/contracts";

interface AttestationLike {
  raterRole: number;
  timestamp: bigint;
  revoked: boolean;
}

/**
 * 数 rolling 12 个月窗口内被写入的 OwnershipBoundary 触发数。
 *
 * 12 个月外的触发自动滑出窗口 → 防止合规老用户秋后算账。
 *
 * @param attestations PneumaAttestation.getAttestationsByRecipient 返回
 * @param now 当前时间（unix seconds），默认 Date.now()/1000
 */
export function countBoundaryTriggers(
  attestations: readonly AttestationLike[],
  now: number = Date.now() / 1000,
): number {
  const cutoff = now - ROLLING_WINDOW_SECONDS;
  let count = 0;
  for (const a of attestations) {
    if (a.revoked) continue;
    if (a.raterRole !== RATER_ROLE.SYSTEM) continue;
    if (Number(a.timestamp) < cutoff) continue;
    count++;
  }
  return count;
}
