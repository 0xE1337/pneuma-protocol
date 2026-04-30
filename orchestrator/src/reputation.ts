/**
 * reputation —— 链上读 PneumaAttestation 计算 skill provider 声誉分
 *
 * 公式与 apps/hub/lib/reputationScore.ts 完全一致（开放协议第一性原则——
 * 任意第三方 dApp 拿同样的 attestation 数组应能复现同一分数）：
 *
 *   weight = sqrt(volume) × ageFactor × repMultiplier × decayFactor × weightedAvgRating
 *
 *   - volume        ：累计 USDC 流水（attestation.paidAmount 之和）
 *   - ageFactor     ：min(1, daysSinceFirst / 30)
 *   - repMultiplier ：1 + 0.1 × log2(validCount + 1) - 0.5 × revokedRatio
 *   - decayFactor   ：max(0, 1 - 0.023 × idleDays)
 *   - rater 权重    ：PROVIDER 1.0 / CALLER 1.5 / JUROR 2.0
 *
 * 设计原则：
 *   - 与 hub 前端公开公式一致 → 任意第三方 dApp 复现的开放协议第一性原则
 *   - 冷启动豁免：valid attestation 数 < COLD_START_THRESHOLD 时不参与排序，平铺到列表末尾
 *     这样新人 skill 仍能被 LLM planner 看到、被随机分配到流量
 *
 * TODO（黑客松后）：
 *   apps/hub/lib/reputationScore.ts 与本文件公式重复，应抽到 packages/reputation 共享。
 *   现状是为了保持 orchestrator 包独立、不引入新 workspace 依赖而复制。
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";

// ─────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────

/** rater 角色权重 —— CALLER 真金白银付费方权重更高 */
const ROLE_WEIGHTS: Record<number, number> = {
  0: 1.0, // PROVIDER
  1: 1.5, // CALLER
  2: 2.0, // JUROR (roadmap)
  3: 0.0, // SYSTEM —— boundary attestation 不计入声誉
};

const DECAY_LAMBDA = 0.023;
const AGE_RAMP_DAYS = 30;

/** 冷启动豁免阈值：低于此 valid attestation 数的 skill 标记为 NEW，不参与排序 */
export const COLD_START_THRESHOLD = 3;

/** 最近评论提取上限 —— 喂给 LLM planner 的样本数（避免 prompt 爆炸） */
export const MAX_RECENT_COMMENTS = 5;

// ─────────────────────────────────────────────────────────────────
// PneumaAttestation ABI（仅 read 部分）
// ─────────────────────────────────────────────────────────────────

const PneumaAttestationAbi = [
  {
    type: "function",
    name: "getAttestationsByRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipientTBA", type: "address" }],
    outputs: [
      {
        name: "result",
        type: "tuple[]",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "skillId", type: "uint256" },
          { name: "paymentHash", type: "bytes32" },
          { name: "rating", type: "uint8" },
          { name: "paidAmount", type: "uint256" },
          { name: "skillName", type: "string" },
          { name: "skillCategory", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "revoked", type: "bool" },
          { name: "raterRole", type: "uint8" },
          { name: "comment", type: "string" },
        ],
      },
    ],
  },
] as const;

// ─────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────

export interface AttestationLike {
  rating: number; // 1-5
  paidAmount: bigint;
  timestamp: bigint;
  revoked: boolean;
  raterRole: number; // 0=PROVIDER, 1=CALLER, 2=JUROR, 3=SYSTEM
  comment?: string; // v3 — 真用户文字评论（≤280 字符）；可空
}

/** v3: 最近评论 — LLM planner 决策用的高信息密度信号 */
export interface RecentComment {
  rating: number;
  comment: string;
  timestamp: bigint;
  raterRole: number; // CALLER (1) 评论可信度高于 PROVIDER (0) 自评
}

export interface ReputationScore {
  /** 综合分数（0-100 归一化） */
  score: number;
  /** 有效（未撤销且非 SYSTEM）attestation 数 */
  validCount: number;
  /** 累计 USDC 流水（最小单位，6 decimals） */
  totalVolumeWei: bigint;
  /** 距上次活跃天数 */
  idleDays: number;
  /** Caller 评分加权平均（最客观，因为是付费方写的） */
  avgRatingByCaller: number;
  /** 是否处于冷启动期（validCount < COLD_START_THRESHOLD） */
  isColdStart: boolean;
  /**
   * v3: 最近文字评论（按时间倒序，最多 MAX_RECENT_COMMENTS 条）
   * 优先 CALLER 评论（付费方写的更客观），同来源按 timestamp DESC
   * LLM planner 拿这些文字做"评论里描述的问题是否影响我这次任务"判断
   */
  recentComments: RecentComment[];
}

// ─────────────────────────────────────────────────────────────────
// 计算（与 apps/hub 完全同公式）
// ─────────────────────────────────────────────────────────────────

export function computeReputation(
  attestations: AttestationLike[],
  now: number = Date.now() / 1000,
): ReputationScore {
  // SYSTEM (raterRole=3) attestation 不计入声誉，过滤掉
  const ratingAtts = attestations.filter((a) => a.raterRole !== 3);
  const valid = ratingAtts.filter((a) => !a.revoked);

  if (valid.length === 0) {
    return {
      score: 0,
      validCount: 0,
      totalVolumeWei: 0n,
      idleDays: 0,
      avgRatingByCaller: 0,
      isColdStart: true,
      recentComments: [],
    };
  }

  const totalVolumeWei = valid.reduce((s, a) => s + a.paidAmount, 0n);
  const totalVolumeUsdc = Number(totalVolumeWei) / 1e6;
  const volumeFactor = Math.sqrt(totalVolumeUsdc);

  const earliest = valid.reduce(
    (min, a) => (a.timestamp < min ? a.timestamp : min),
    valid[0].timestamp,
  );
  const latest = valid.reduce(
    (max, a) => (a.timestamp > max ? a.timestamp : max),
    valid[0].timestamp,
  );

  const ageDays = Math.max(0, (now - Number(earliest)) / 86400);
  const idleDays = Math.max(0, (now - Number(latest)) / 86400);

  const ageFactor = Math.min(1, ageDays / AGE_RAMP_DAYS);

  const totalCount = ratingAtts.length;
  const revokedCount = ratingAtts.filter((a) => a.revoked).length;
  const revokedRatio = totalCount > 0 ? revokedCount / totalCount : 0;
  const logBoost = Math.log2(valid.length + 1) * 0.1;
  const repMultiplier = Math.max(0, 1 + logBoost - 0.5 * revokedRatio);

  const decayFactor = Math.max(0, 1 - DECAY_LAMBDA * idleDays);

  const callerAtt = valid.filter((a) => a.raterRole === 1);
  const avgRatingByCaller =
    callerAtt.length > 0
      ? callerAtt.reduce((s, a) => s + a.rating, 0) / callerAtt.length
      : 0;

  const totalWeight = valid.reduce(
    (sum, a) => sum + (ROLE_WEIGHTS[a.raterRole] ?? 1),
    0,
  );
  const weightedRatingSum = valid.reduce(
    (sum, a) => sum + a.rating * (ROLE_WEIGHTS[a.raterRole] ?? 1),
    0,
  );
  const weightedAvgRating =
    totalWeight > 0 ? weightedRatingSum / totalWeight : 0;

  const rawScore =
    volumeFactor * ageFactor * repMultiplier * decayFactor * weightedAvgRating;
  const score = Math.min(100, Math.max(0, rawScore * 5));

  // v3: 提取最近评论喂给 LLM planner
  // 排序原则：CALLER 评论优先（付费方写的最客观），同来源按 timestamp DESC
  // 这是 anti-sybil 的关键 — score 能刷，文字评论难刷，让 LLM 综合两者判断
  const recentComments = pickRecentComments(valid);

  return {
    score,
    validCount: valid.length,
    totalVolumeWei,
    idleDays,
    avgRatingByCaller,
    isColdStart: valid.length < COLD_START_THRESHOLD,
    recentComments,
  };
}

/**
 * 从有效 attestation 列表里挑出最有信息量的 N 条评论喂给 LLM。
 *
 * 选择原则：
 *   1. comment 必须非空（空评论对 LLM 决策无用）
 *   2. CALLER (raterRole=1) 优先 —— 真付费方评论
 *   3. 同 raterRole 内按 timestamp 倒序（最新优先）
 *   4. 取前 MAX_RECENT_COMMENTS 条（默认 5）
 *
 * 不在公式里加权，只是给 LLM 看的"原始证据"。
 */
function pickRecentComments(valid: AttestationLike[]): RecentComment[] {
  const withComment = valid.filter((a) => (a.comment ?? "").length > 0);

  // 排序：CALLER (1) 在前 → PROVIDER (0) → JUROR (2)；同 role 按 timestamp DESC
  const ROLE_PRIORITY = (role: number): number =>
    role === 1 ? 0 : role === 0 ? 1 : 2;

  withComment.sort((a, b) => {
    const pa = ROLE_PRIORITY(a.raterRole);
    const pb = ROLE_PRIORITY(b.raterRole);
    if (pa !== pb) return pa - pb;
    return Number(b.timestamp - a.timestamp);
  });

  return withComment.slice(0, MAX_RECENT_COMMENTS).map((a) => ({
    rating: a.rating,
    comment: a.comment ?? "",
    timestamp: a.timestamp,
    raterRole: a.raterRole,
  }));
}

// ─────────────────────────────────────────────────────────────────
// 链上批量读
// ─────────────────────────────────────────────────────────────────

/**
 * 批量读多个 recipient 的 attestation 并算分
 *
 * @param rpcUrl       Arc Testnet RPC
 * @param attestation  PneumaAttestation 合约地址
 * @param recipients   要查询的地址数组（skill provider 的 owner / TBA）
 * @returns Map<recipient, ReputationScore>
 */
export async function fetchReputations(
  rpcUrl: string,
  attestation: Address,
  recipients: Address[],
): Promise<Map<Address, ReputationScore>> {
  if (recipients.length === 0) return new Map();

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  }) as PublicClient;

  const now = Date.now() / 1000;
  const results = new Map<Address, ReputationScore>();

  // 并行读取所有 recipient 的 attestation
  const reads = await Promise.all(
    recipients.map(async (addr) => {
      try {
        const raw = await publicClient.readContract({
          address: attestation,
          abi: PneumaAttestationAbi,
          functionName: "getAttestationsByRecipient",
          args: [addr],
        });
        return { addr, raw };
      } catch (err) {
        // 单个 recipient 读取失败不应阻塞其他人，记录并返回空
        console.warn(`  ⚠ reputation fetch failed for ${addr}: ${(err as Error).message}`);
        return { addr, raw: [] as readonly unknown[] };
      }
    }),
  );

  for (const { addr, raw } of reads) {
    const atts: AttestationLike[] = (raw as readonly {
      rating: number;
      paidAmount: bigint;
      timestamp: bigint;
      revoked: boolean;
      raterRole: number;
      comment: string;
    }[]).map((a) => ({
      rating: Number(a.rating),
      paidAmount: a.paidAmount,
      timestamp: a.timestamp,
      revoked: a.revoked,
      raterRole: Number(a.raterRole),
      comment: a.comment, // v3 — 透传文字评论给 pickRecentComments
    }));
    results.set(addr, computeReputation(atts, now));
  }

  return results;
}
