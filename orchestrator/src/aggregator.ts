/**
 * Aggregator —— 把各 skill 的结果用 LLM 聚合成最终回答
 *
 * 顶层逻辑：聚合器只能基于 skill 真实返回的数据综合回答。
 *   - 全失败 → 短路返回失败清单，不调 LLM（防止 LLM 用 user query 里的信息编造 fallback 答案）
 *   - 部分失败 → LLM 聚合时强约束"不准用 user query 内容补缺失"
 *
 * 这是产品定位决定的：Pneuma 的价值在于 x402 结算的 skill 调用本身。
 * 调用失败还自圆其说，等于把"为什么要付费调 skill"的命题打穿。
 */

import { chat } from "./llm.js";
import type { ExecutionResult } from "./executor.js";

const SYSTEM_PROMPT = `你是 Pneuma 的结果聚合器。
你的任务：把多个独立 AI skill 的执行结果，聚合为对用户原始请求的统一回答。

硬约束：
- **只能基于 skill 实际返回的 data 字段综合回答；严禁** 用 user query 里的信息（diff / 题目 / abstract / tx hash 等）自己分析，那不是聚合，是替代失败的 skill
- 如果某些 skill 失败了，必须明说"X skill 失败"+ 失败原因；这部分需求**不要** 用 LLM 自己补
- 如果有数字（价格 / 评分等）原样保留，不要圆整
- 用中文，简洁直接，控制在 5 句以内`;

export async function aggregate(
  userQuery: string,
  results: ExecutionResult[],
): Promise<string> {
  if (results.length === 0) {
    return "（未调用任何 skill；可能问题不需要外部技能即可回答。）";
  }

  // 全失败短路 —— 不进 LLM。LLM 看到 user query 里的内容（如 inline diff）会
  // 倾向于"帮忙"自己分析一下，导致"明明所有付费调用都失败了，UI 还显示像样的
  // AI 答案"——这等于免费给用户结果，把 x402 付费命题打穿。
  const allFailed = results.every((r) => !r.success);
  if (allFailed) {
    const lines = results.map(
      (r) => `- ${r.skill.name}：${r.error ?? "未知错误"}`,
    );
    return [
      "所有 skill 调用均失败，本次请求无法返回结果：",
      ...lines,
      "",
      "可能原因：skill endpoint 离线 / 链上 settle 超时 / 服务方账户异常。",
      "建议：在 /skills 页确认 skill 状态，或换用 manual 模式手选其它 provider。",
    ].join("\n");
  }

  // 构造给 LLM 的 context（含 success + failure 状态）
  const skillResults = results.map((r) => ({
    skillName: r.skill.name,
    success: r.success,
    data: r.success ? r.data : null,
    error: r.success ? null : r.error,
    paidAmount: r.paidAmount ? `${Number(r.paidAmount) / 1e6} USDC` : null,
    callId: r.callId,
  }));

  const userMsg = `用户原始请求：${userQuery}

各 skill 执行结果：
${JSON.stringify(skillResults, null, 2)}

请生成最终回答。再次提醒：失败的 skill 直接说失败，不要自己补内容。`;

  return await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    { temperature: 0.4, maxTokens: 400 },
  );
}
