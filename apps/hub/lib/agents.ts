/**
 * agents — 把 Skill 列表按 owner 聚合成 Agent 视图的纯函数 helper
 *
 * 设计原则：
 *   - 协议层最小单位仍是 Skill（合约 storage / 计费 / attestation 都按 skillId）
 *   - 产品层主体是 Agent（一个 Soul / EOA owner 注册多个 Skill）
 *   - 这个文件就是这层折叠：list of skills → list of agents
 *
 * 所有函数 pure（无 side effect、无 I/O），方便单测 + 任意 dApp 复用。
 */

import type { Address } from "viem";

/**
 * 最小所需字段：保持松耦合，让调用方传 wagmi 推导的完整 Skill 也能 narrow。
 * 字段命名严格匹配 contracts.ts SKILL_TUPLE_COMPONENTS。
 */
export interface SkillLike {
  skillId: bigint;
  owner: Address;
  name: string;
  /** HTTPS / CLI 调用端点（详情页 sovereign deployment 区会展示） */
  endpoint: string;
  category: string;
  pricePerCall: bigint;
  totalCalls: bigint;
  maxInputBytes: number;
  maxOutputBytes: number;
  baseFee: bigint;
  inputPricePerKB: bigint;
  outputPricePerKB: bigint;
  upstreamModel: string;
  markupBps: number;
}

export interface AgentSummary<S extends SkillLike = SkillLike> {
  /** owner 地址（小写归一化，作为路由 key 用） */
  owner: Address;
  /** 该 Agent 注册的所有 active Skill */
  skills: S[];
  /** 跨 Skill 累计调用次数 */
  totalCalls: bigint;
  /** 是否提供 V4 flat-price skill（不可与 hasV5 互斥） */
  hasV4: boolean;
  /** 是否提供 V5 per-byte skill */
  hasV5: boolean;
  /** 该 Agent 自声明的上游模型集合（dedupe，过滤空字符串） */
  upstreamModels: string[];
  /** 最低 markupBps（caller 选 tier 时关心的下限） */
  minMarkupBps: number;
}

/** 判定 skill 是否启用 V5 per-byte 模式（与合约 _isV5Mode 同语义） */
export function isV5Skill(s: SkillLike): boolean {
  return s.inputPricePerKB > 0n || s.outputPricePerKB > 0n;
}

/**
 * 把 Skill 数组按 owner 折叠成 Agent 摘要列表
 *
 * 排序：按 totalCalls 降序（活跃 Agent 优先），相等时按 owner 字典序稳定
 */
export function groupSkillsByOwner<S extends SkillLike>(
  skills: readonly S[],
): AgentSummary<S>[] {
  const buckets = new Map<Address, S[]>();

  for (const s of skills) {
    // owner 小写归一化 —— EVM 地址大小写无关，路由 key 必须统一
    const key = s.owner.toLowerCase() as Address;
    const existing = buckets.get(key);
    if (existing) {
      existing.push(s);
    } else {
      buckets.set(key, [s]);
    }
  }

  const summaries: AgentSummary<S>[] = Array.from(buckets.entries()).map(
    ([owner, ownedSkills]) => {
      const totalCalls = ownedSkills.reduce(
        (acc, s) => acc + s.totalCalls,
        0n,
      );
      const hasV4 = ownedSkills.some((s) => !isV5Skill(s));
      const hasV5 = ownedSkills.some((s) => isV5Skill(s));
      const upstreamModels = Array.from(
        new Set(
          ownedSkills
            .map((s) => s.upstreamModel)
            .filter((m) => m && m.length > 0),
        ),
      );
      const v5Skills = ownedSkills.filter(isV5Skill);
      const minMarkupBps =
        v5Skills.length > 0
          ? Math.min(...v5Skills.map((s) => Number(s.markupBps)))
          : 0;

      return {
        owner,
        skills: ownedSkills,
        totalCalls,
        hasV4,
        hasV5,
        upstreamModels,
        minMarkupBps,
      };
    },
  );

  return summaries.sort((a, b) => {
    if (a.totalCalls !== b.totalCalls) {
      return a.totalCalls > b.totalCalls ? -1 : 1;
    }
    return a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0;
  });
}

/**
 * 路由路径生成 —— 单点维护，避免散落 string concat
 */
export function agentDetailHref(owner: string): string {
  return `/agents/${owner.toLowerCase()}`;
}
