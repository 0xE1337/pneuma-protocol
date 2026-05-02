/**
 * quick-reasoning —— 任意问题，Claude 直接回答（spawn 本地 `claude -p`）
 *
 * 最便宜的 skill（0.03 USDC）。
 *
 * caller 输入：question / lang / max_words
 *
 * 输出 JSON：answer + confidence + caveat
 *
 * 价格 0.03 USDC
 */

import type { SkillDefinition, SkillHandler } from "./types.js";

export const definition: SkillDefinition = {
  id: "quick-reasoning",
  name: "Quick Reasoning",
  description:
    "Cheap one-shot reasoning. Agent answers a question directly with self-rated confidence. Says 'I don't know' instead of fabricating.",
  category: "general",
  pricePerCall: 30_000n,
  defaultRating: 5,
  systemPrompt: `你是一个事实导向的 reasoning agent。

风格要求：
- 答案 ≤ caller 指定 max_words
- confidence 自评：
    high   = 训练数据高频确定事实
    medium = 推理出来的合理结论
    low    = 不确定 / 可能过时 / 边缘领域
- 严禁假装知道你不知道的事；标 "low" 比硬编强
- 严禁加客套

输出严格 JSON（不要 markdown fence、不要 preamble）：
{
  "answer": "...",
  "confidence": "high",
  "caveat": null
}`,
};

export const handler: SkillHandler = async (input, { definition, callClaude }) => {
  const question = String(input.question ?? "").slice(0, 2000);
  const lang = String(input.lang ?? "zh");
  const maxWords = Math.min(Number(input.max_words ?? 200), 500);

  if (!question) throw new Error("input.question 必填");

  const userMessage = `Language: ${lang}
Max words: ${maxWords}

Question: ${question}

Output the JSON now.`;

  const { data, durationMs, raw } = await callClaude({
    systemPrompt: definition.systemPrompt,
    userMessage,
    timeoutMs: definition.timeoutMs ?? 60_000,
  });

  return {
    result: typeof data === "string" ? raw : (data as Record<string, unknown>),
    claudeMs: durationMs,
    rawText: raw,
  };
};
