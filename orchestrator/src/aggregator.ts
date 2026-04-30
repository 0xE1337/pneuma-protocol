/**
 * Aggregator —— 把各 skill 的结果用 LLM 聚合成最终回答
 */

import { chat } from "./llm.js";
import type { ExecutionResult } from "./executor.js";

const SYSTEM_PROMPT = `你是 Pneuma 的结果聚合器。
你的任务：把多个独立 AI skill 的执行结果，聚合为对用户原始请求的统一回答。

要求：
- 用中文，简洁直接
- 如果有数字（价格 / 评分等）原样保留
- 如果某些 skill 失败了，明说哪些失败、哪些成功
- 不要编造 skill 没返回的数据
- 控制在 5 句以内`;

export async function aggregate(
  userQuery: string,
  results: ExecutionResult[],
): Promise<string> {
  if (results.length === 0) {
    return "（未调用任何 skill；可能问题不需要外部技能即可回答。）";
  }

  // 构造给 LLM 的 context
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

请生成最终回答。`;

  return await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    { temperature: 0.4, maxTokens: 400 },
  );
}
