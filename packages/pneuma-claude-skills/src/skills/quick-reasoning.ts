/**
 * quick-reasoning —— 任意问题，Claude 直接回答
 *
 * 最便宜的 skill（0.03 USDC），适合一句话回答 / fact-check / 简单 reasoning。
 *
 * caller 输入：
 *   - question:  问题（必填，≤ 2000 字）
 *   - lang:      "zh" / "en"（默认 zh）
 *   - max_words: 回答字数上限（默认 200）
 *
 * 输出：
 *   - 一段直接回答
 *   - confidence: "high" / "medium" / "low"（agent 自评）
 *   - 不知道就说不知道（不编）
 *
 * 价格 0.03 USDC
 */

import type { SkillDefinition, SkillHandler } from "../types.js";

export const definition: SkillDefinition = {
  id: "quick-reasoning",
  name: "Quick Reasoning",
  description:
    "Cheap one-shot reasoning. Agent answers a question directly with self-rated confidence. Says 'I don't know' instead of fabricating.",
  category: "general",
  pricePerCall: 30_000n, // 0.03 USDC
  defaultRating: 5,
  needsWebFetch: false,
  systemPrompt: `你是一个事实导向的 reasoning agent，直接回答 caller 的问题。

风格要求：
- 答案 ≤ caller 指定 max_words
- confidence 自评：
    high   = 训练数据里高频确定事实
    medium = 推理出来的合理结论
    low    = 不确定 / 可能过时 / 边缘领域
- 严禁假装知道你不知道的事；标 "low" 比硬编强
- 严禁加"希望我的回答对你有帮助"之类的客套

输出严格 JSON：
{
  "answer": "...",
  "confidence": "high" | "medium" | "low",
  "caveat": "..." | null
}`,
};

export const handler: SkillHandler = async (input, { client, definition }) => {
  const question = String(input.question ?? "").slice(0, 2000);
  const lang = String(input.lang ?? "zh");
  const maxWords = Math.min(Number(input.max_words ?? 200), 500);

  if (!question) throw new Error("input.question 必填");

  const startedAt = Date.now();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: definition.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Language: ${lang}
Max words: ${maxWords}

Question: ${question}

请回答，返回 JSON。`,
      },
    ],
  });
  const claudeMs = Date.now() - startedAt;

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  let result: string | Record<string, unknown> = text;
  try {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      result = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    /* keep raw */
  }

  return {
    result,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    claudeMs,
  };
};
