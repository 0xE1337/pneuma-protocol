/**
 * @pneuma/reputation-formula
 *
 * 公开协议层：reputation 公式 + 数据 + 类型，零 deps，纯 TS。
 *
 * 第三方 dApp 重算同一分数的最小集成（一行 import + 一行 RPC + 一行 compute）：
 *
 *   import { computeReputation } from "@pneuma/reputation-formula";
 *   const attestations = await pneumaAttestation.read.getAttestationsByRecipient([tba]);
 *   const score = computeReputation(attestations).score;
 *
 * 4 维 (V6.0.3) 用 v2：
 *
 *   import { computeReputationV2 } from "@pneuma/reputation-formula";
 *   const breakdown = computeReputationV2({
 *     attestations,           // PneumaAttestation.getAttestationsByRecipient
 *     publications,            // PneumaCommons.getPublicationsByAuthor + 各 getPublication
 *     endorsementsReceived,    // ReputationGraph.getEndorsementsByEndorsee + getEndorsement
 *   });
 */

export * from "./types.js";
export {
  USDC_DECIMALS,
  ROLE_WEIGHTS,
  DECAY_LAMBDA,
  AGE_RAMP_DAYS,
  DIM_WEIGHTS,
} from "./constants.js";
export { computeReputation, formatScore } from "./v1.js";
export {
  computeEconomicScore,
  computeIntellectualScore,
  computeSocialScore,
  computeJudicialScore,
  computeReputationV2,
} from "./v2.js";
