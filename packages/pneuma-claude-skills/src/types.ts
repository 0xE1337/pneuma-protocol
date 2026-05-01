/**
 * Shared types — 5 个 skill server 的接口契约。
 *
 * 设计原则：
 *   - 每个 skill 暴露一个 `definition`（元数据 + Claude prompt + tool hint）
 *     和一个 `handler`（接 caller body，返回真实结果）
 *   - server.ts 根据 env SKILL_NAME 选定 skill，挂 hono + x402 middleware
 *   - 同一脚手架跑 5 份进程（5 个端口），每份只跑一个 skill
 *
 * 这种 plug-in 风格让评委一眼看到 5 个真独立的 sovereign agent 进程，
 * 每个有自己的 PID / port / Anthropic 调用统计 —— 协议层"sovereign"叙事的工程证据。
 */

import type Anthropic from "@anthropic-ai/sdk";

export interface SkillDefinition {
  /** 唯一 ID（kebab-case；env 变量 SKILL_ID_<UPPERCASE_SNAKE> 与之对应） */
  id: SkillId;
  /** 链上注册用的人话名 */
  name: string;
  /** 链上 description（≤ 280 字） */
  description: string;
  /** 链上 category（用于 /discover 筛选） */
  category: string;
  /** 单次调用价格（USDC 6 decimals 整数） */
  pricePerCall: bigint;
  /** Claude system prompt —— 决定 agent 人格 */
  systemPrompt: string;
  /** 默认评分（5 = 满分；x402 middleware settle 时写 attestation 用） */
  defaultRating: number;
  /** 是否需要 web fetch 工具（影响 Claude tools 配置） */
  needsWebFetch: boolean;
}

export type SkillId =
  | "paper-summary"
  | "code-review"
  | "block-explainer"
  | "creative-write"
  | "quick-reasoning";

/**
 * Caller 发来的请求 body —— 每个 skill 不同字段；handler 自行 narrow
 */
export type SkillInput = Record<string, unknown>;

/**
 * Skill 返回的结果 —— callId / paidAmount 由 x402 middleware 注入，
 * handler 只管 result + tokens + durationMs
 */
export interface SkillOutput {
  result: string | Record<string, unknown>;
  /** Claude 输入 token 数（debug + 成本核算） */
  inputTokens?: number;
  /** Claude 输出 token 数 */
  outputTokens?: number;
  /** Claude 调用耗时 ms */
  claudeMs: number;
  /** 是否触发了工具调用 */
  toolUseCount?: number;
}

/**
 * Handler 签名 —— skill 实现者只需写这一个函数
 */
export type SkillHandler = (
  input: SkillInput,
  ctx: { client: Anthropic; definition: SkillDefinition },
) => Promise<SkillOutput>;
