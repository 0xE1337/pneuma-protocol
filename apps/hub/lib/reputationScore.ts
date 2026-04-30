/**
 * reputationScore — 单维度（economic）conviction-weighted reputation
 *
 * 这个文件保留是为了向后兼容现有 import 路径；公式实现已经抽到
 * `@pneuma/reputation-formula` npm 包，前端 + 第三方 dApp 共用同一份代码。
 *
 * 第三方 dApp 复现同一分数（一行 import + 一行 RPC + 一行 compute）：
 *
 *   import { computeReputation } from "@pneuma/reputation-formula";
 *   const attestations = await client.readContract({
 *     address: PNEUMA_ATTESTATION,
 *     abi: PneumaAttestationAbi,
 *     functionName: "getAttestationsByRecipient",
 *     args: [tba],
 *   });
 *   const score = computeReputation(attestations).score;
 */

export {
  computeReputation,
  formatScore,
  type AttestationLike,
  type ReputationBreakdown,
} from "@pneuma/reputation-formula";
