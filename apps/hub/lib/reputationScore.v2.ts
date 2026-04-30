/**
 * reputationScore.v2 — 4 维 conviction-weighted reputation
 *
 * 这个文件保留是为了向后兼容现有 import 路径；公式实现已经抽到
 * `@pneuma/reputation-formula` npm 包。
 *
 * 第三方 dApp 复现 4 维 breakdown：
 *
 *   import { computeReputationV2 } from "@pneuma/reputation-formula";
 *   const breakdown = computeReputationV2({
 *     attestations,            // PneumaAttestation.getAttestationsByRecipient
 *     publications,            // PneumaCommons.getPublication × N
 *     endorsementsReceived,    // ReputationGraph.getEndorsement × M
 *   });
 */

export {
  computeReputationV2,
  computeEconomicScore,
  computeIntellectualScore,
  computeSocialScore,
  computeJudicialScore,
  DIM_WEIGHTS,
  type PublicationLike,
  type EndorsementLike,
  type DimensionScore,
  type ReputationV2Breakdown,
} from "@pneuma/reputation-formula";
