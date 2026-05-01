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

// ────────────────────────── v3 inputs ──────────────────────────

/**
 * PneumaCourt.getDispute(disputeId) 单条返回 —— v3 用来算 punishmentFactor +
 * judicial accuracy。第三方 dApp 自行 decode 后传入。
 */
export interface DisputeRecordLike {
  disputeId: bigint;
  callId: bigint;
  plaintiff: `0x${string}`;
  defendant: `0x${string}`;
  jurors: readonly `0x${string}`[];
  /** 0=NONE, 1=VOTING, 2=RESOLVED */
  status: number;
  /** 0=PENDING, 1=GUILTY, 2=INNOCENT */
  verdict: number;
  /** unix seconds when filed */
  filedAt?: bigint;
}

/**
 * 一个 juror 在某 dispute 里的投票（PneumaCourt.jurorVerdict）—— v3 算
 * judicial accuracy 用：jurorVerdict 跟 dispute.verdict 对比。
 */
export interface JurorVoteLike {
  disputeId: bigint;
  /** 0=PENDING（未投）, 1=GUILTY, 2=INNOCENT */
  jurorVerdict: number;
  /** dispute 最终裁决（同 DisputeRecordLike.verdict） */
  finalVerdict: number;
  /** dispute filedAt 用于 decay */
  filedAt?: bigint;
}

/**
 * v3 4+1 维 + 段位钳制数据 + 总分 breakdown
 *
 * 与 v2 的关系：
 *   - economic / intellectual / social / judicial 仍是 0-100 维度分
 *   - 但 economic / social 已经叠加 punishmentFactor / slashedRatio
 *   - judicial 不再是 v2 的 placeholder=0，是真实 accuracy 计算
 *   - 加 hasGuiltyRecord + boundaryTriggers12mo 字段供调用方决策段位钳制
 */
export interface ReputationV3Breakdown extends ReputationV2Breakdown {
  /** Court guilty 统计衰减系数 (0-1)；越大越衰减 */
  punishmentFactor: number;
  /** 担保对象被 slash 的反向衰减系数 (0-1) */
  slashedRatio: number;
  /** 是否有 guilty 历史 —— 段位 hard cap 触发条件 */
  hasGuiltyRecord: boolean;
  /** rolling 12 个月内 OwnershipBoundary 触发数 */
  boundaryTriggers12mo: number;
}
