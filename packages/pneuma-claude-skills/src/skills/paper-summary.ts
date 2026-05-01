/**
 * paper-summary —— 学术论文摘要
 *
 * caller 输入：
 *   - title:   论文标题（必填）
 *   - abstract: 摘要原文（必填，让 caller 先 fetch；agent 间互调时
 *               caller 用自己的 web tool 拉文本再喂过来）
 *   - field:   学科领域（可选，影响 Claude 强调点）
 *
 * 输出：
 *   - 中英双语摘要（≤ 200 字）
 *   - 3 条核心贡献
 *   - 适合在哪些场景引用
 *
 * 价格 0.10 USDC
 */

import type { SkillDefinition, SkillHandler } from "../types.js";

export const definition: SkillDefinition = {
  id: "paper-summary",
  name: "Paper Summary",
  description:
    "Compress an academic paper to bilingual TL;DR + 3 contributions + downstream-citation hints. Caller passes title + abstract; output is structured JSON.",
  category: "research",
  pricePerCall: 100_000n, // 0.10 USDC (6 decimals)
  defaultRating: 5,
  needsWebFetch: false,
  systemPrompt: `你是一个学术 agent，专门把论文摘要压缩成可下游引用的结构化卡。

风格要求：
- 中文 TL;DR ≤ 80 字，英文 TL;DR ≤ 60 词
- 3 条 contributions 用动词开头（"Proposes …" / "Shows …" / "Releases …"）
- citation hints 给 2-3 个真实可引用的下游研究方向
- 严禁编造数据、严禁说"我读过了"——你只看到了 caller 给你的 title + abstract

输出严格 JSON 格式：
{
  "tldr_zh": "...",
  "tldr_en": "...",
  "contributions": ["...", "...", "..."],
  "citation_hints": ["...", "..."]
}`,
};

export const handler: SkillHandler = async (input, { client, definition }) => {
  const title = String(input.title ?? "").slice(0, 500);
  const abstract = String(input.abstract ?? "").slice(0, 5000);
  const field = String(input.field ?? "general");

  if (!title || !abstract) {
    throw new Error("input.title 和 input.abstract 都是必填的");
  }

  const startedAt = Date.now();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    system: definition.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Field: ${field}
Title: ${title}

Abstract:
${abstract}

请输出 JSON。`,
      },
    ],
  });
  const claudeMs = Date.now() - startedAt;

  // 拿第一段 text content
  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  // 试图 parse JSON；失败 fallback 为 raw text
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
