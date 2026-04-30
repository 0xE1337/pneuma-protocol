/**
 * 公式输入/输出类型 —— 与 Pneuma 链上合约 view function 返回结构对齐
 *
 * 命名后缀 "Like" 表示这是结构子集：合约返回的 struct 字段 superset，
 * 但公式只用到这些字段。第三方 dApp 自行 viem decode 后传入即可。
 */

/** PneumaAttestation.getAttestationsByRecipient(tba) 单条返回 */
export interface AttestationLike {
  /** 1-5 评分 */
  rating: number;
  /** USDC 6-decimals 最小单位（合约字段 paidAmount） */
  paidAmount: bigint;
  /** unix seconds */
  timestamp: bigint;
  /** 是否被撤销（撤销后 weight 0） */
  revoked: boolean;
  /** 0=PROVIDER, 1=CALLER, 2=JUROR, 3=SYSTEM */
  raterRole: number;
}

/** PneumaCommons.getPublication(pubId) 单条返回 */
export interface PublicationLike {
  pubId: bigint;
  citationCount: bigint;
  publishedAt: bigint;
  retracted: boolean;
}

/** ReputationGraph.getEndorsement(endorsementId) 单条返回 */
export interface EndorsementLike {
  /** USDC 6-decimals 最小单位 */
  stakedAmount: bigint;
  active: boolean;
  startedAt: bigint;
}

/** v1（economic-only）breakdown */
export interface ReputationBreakdown {
  /** 主分数（0-100 归一化展示用） */
  score: number;
  volumeFactor: number;
  ageFactor: number;
  repMultiplier: number;
  decayFactor: number;
  avgRatingByCaller: number;
  avgRatingByProvider: number;
  validCount: number;
  totalVolumeRaw: bigint;
  idleDays: number;
}

/** v2 单维度评分输出 */
export interface DimensionScore {
  /** 0-100 归一化 */
  score: number;
  /** 该维度细分指标（debug + UI 用） */
  detail: Record<string, number | string>;
}

/** v2 4 维 + 总分 breakdown */
export interface ReputationV2Breakdown {
  /** 综合分数（4 维加权和，0-100） */
  total: number;
  economic: DimensionScore;
  intellectual: DimensionScore;
  social: DimensionScore;
  judicial: DimensionScore;
}
