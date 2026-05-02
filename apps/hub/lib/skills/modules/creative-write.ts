/**
 * creative-write —— 创意写作（spawn 本地 `claude -p`）
 *
 * caller 输入：topic / genre / tone / lang / constraints
 *
 * 输出 JSON：primary + alternatives + notes
 *
 * 价格 0.05 USDC
 */

import type { SkillDefinition, SkillHandler } from "./types.js";

export const definition: SkillDefinition = {
  id: "creative-write",
  name: "Creative Write",
  description:
    "Generate a piece of creative writing in a chosen genre + tone + language, with 1-2 alternatives so caller can pick. Cheap (0.05 USDC) for rapid iteration.",
  category: "creative",
  pricePerCall: 50_000n,
  defaultRating: 5,
  systemPrompt: `你是一个创意写作 agent。

风格要求：
- 严格遵守 caller 的 constraints
- genre 决定形式：
    twitter-thread → 3-5 条 ≤ 280 字 tweet 串
    blog-intro     → 一段 80-150 字 hook
    product-tagline→ 一句 ≤ 20 字 slogan + 3 备选
    story-opening  → 一段 100-200 字小说开篇
- 输出 1 个 primary + 1-2 个 alternative
- 严禁说"希望你喜欢"

输出严格 JSON（不要 markdown fence、不要 preamble）：
{
  "primary": "...",
  "alternatives": ["...", "..."],
  "notes": "可选：写作思路简注（≤ 30 字）"
}`,
};

export const handler: SkillHandler = async (input, { definition, callClaude }) => {
  const topic = String(input.topic ?? "").slice(0, 500);
  const genre = String(input.genre ?? "blog-intro");
  const tone = String(input.tone ?? "professional");
  const lang = String(input.lang ?? "zh");
  const constraints = Array.isArray(input.constraints)
    ? (input.constraints as unknown[]).map(String).slice(0, 10)
    : [];

  if (!topic) throw new Error("input.topic 必填");

  const userMessage = `Topic: ${topic}
Genre: ${genre}
Tone: ${tone}
Language: ${lang}
Constraints: ${constraints.length ? JSON.stringify(constraints) : "(none)"}

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
