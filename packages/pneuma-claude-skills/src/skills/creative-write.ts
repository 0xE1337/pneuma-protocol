/**
 * creative-write —— 创意写作
 *
 * caller 输入：
 *   - topic:      主题（必填，≤ 500 字）
 *   - genre:      "twitter-thread" / "blog-intro" / "product-tagline" / "story-opening"
 *   - tone:       "playful" / "professional" / "dark" / "warm"（可选）
 *   - lang:       "zh" / "en"（默认 zh）
 *   - constraints: 可选硬约束数组（如 ["不超过 280 字", "不要 emoji"]）
 *
 * 输出：
 *   - 一段创意文本
 *   - 备选 1-2 段（让 caller 挑）
 *
 * 价格 0.05 USDC（最便宜，鼓励频繁试）
 */

import type { SkillDefinition, SkillHandler } from "../types.js";

export const definition: SkillDefinition = {
  id: "creative-write",
  name: "Creative Write",
  description:
    "Generate a piece of creative writing in a chosen genre + tone + language, with 1-2 alternatives so caller can pick. Cheap (0.05 USDC) for rapid iteration.",
  category: "creative",
  pricePerCall: 50_000n, // 0.05 USDC
  defaultRating: 5,
  needsWebFetch: false,
  systemPrompt: `你是一个创意写作 agent，按 caller 给的 genre + tone + lang 写一段文本。

风格要求：
- 严格遵守 caller 的 constraints 数组（每条都要 enforce）
- genre 决定形式：
    twitter-thread → 3-5 条 ≤ 280 字 tweet 串
    blog-intro     → 一段 80-150 字 hook 段
    product-tagline→ 一句 ≤ 20 字 slogan + 3 备选
    story-opening  → 一段 100-200 字小说开篇
- 输出 1 个 primary 版本 + 1-2 个 alternative，让 caller 自己挑
- 严禁说"我希望你喜欢"这种废话

输出严格 JSON：
{
  "primary": "...",
  "alternatives": ["...", "..."],
  "notes": "可选：写作思路简注（≤ 30 字）"
}`,
};

export const handler: SkillHandler = async (input, { client, definition }) => {
  const topic = String(input.topic ?? "").slice(0, 500);
  const genre = String(input.genre ?? "blog-intro");
  const tone = String(input.tone ?? "professional");
  const lang = String(input.lang ?? "zh");
  const constraints = Array.isArray(input.constraints)
    ? (input.constraints as unknown[]).map(String).slice(0, 10)
    : [];

  if (!topic) throw new Error("input.topic 必填");

  const startedAt = Date.now();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: definition.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}
Genre: ${genre}
Tone: ${tone}
Language: ${lang}
Constraints: ${constraints.length ? JSON.stringify(constraints) : "(none)"}

请写，返回 JSON。`,
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
