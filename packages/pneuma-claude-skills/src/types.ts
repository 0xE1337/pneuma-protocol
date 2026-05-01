/**
 * Shared types — 5 个 skill server 的接口契约。
 *
 * 设计原则：
 *   - 每个 skill 暴露一个 `definition`（元数据 + system prompt）
 *     和一个 `handler`（接 caller body，返回真实结果）
 *   - server.ts 根据 env SKILL_NAME 选定 skill，挂 hono + x402 middleware
 *   - 同一脚手架跑 5 份进程（5 个端口），每份只跑一个 skill
 *   - reasoning backend 是**本地 Claude Code CLI**（spawn `claude -p`），
 *     不是 Anthropic API 调用——零 API key + 走用户订阅
 */

import type { CallClaudeArgs, CallClaudeResult } from "./claude-cli.js";

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
  /** Claude CLI 子进程超时（ms），默认 90000 */
  timeoutMs?: number;
}

export type SkillId =
  | "paper-summary"
  | "code-review"
  | "block-explainer"
  | "creative-write"
  | "quick-reasoning";

/** Caller 发来的请求 body —— 每个 skill 不同字段；handler 自行 narrow */
export type SkillInput = Record<string, unknown>;

/**
 * Skill 返回的结果 —— callId / paidAmount 由 x402 middleware 注入，
 * handler 只管 result + durationMs
 */
export interface SkillOutput {
  /** Claude 输出的结构化结果（已 parse 的 JSON 或 raw 字符串） */
  result: string | Record<string, unknown>;
  /** Claude CLI 子进程耗时 ms（含启动 + reasoning） */
  claudeMs: number;
  /** Claude raw stdout（debug 用；可选） */
  rawText?: string;
}

/**
 * Handler 签名 —— skill 实现者只需写这一个函数。
 *
 * ctx.callClaude 是已经包装过的 spawn helper：
 *   const { data, durationMs, raw } = await ctx.callClaude({
 *     systemPrompt: definition.systemPrompt,
 *     userMessage: "...",
 *   });
 */
export type SkillHandler = (
  input: SkillInput,
  ctx: SkillHandlerContext,
) => Promise<SkillOutput>;

export interface SkillHandlerContext {
  definition: SkillDefinition;
  /**
   * spawn `claude -p` 跑一次 reasoning，自动 JSON parse（失败 fallback raw）。
   * 详见 ./claude-cli.ts 的 callClaudeJson
   */
  callClaude: <T = unknown>(args: CallClaudeArgs) => Promise<{
    data: T | string;
    durationMs: number;
    raw: string;
  }>;
}

// 让 callClaude 类型直接 export 出来给 skill 文件复用
export type { CallClaudeArgs, CallClaudeResult };
