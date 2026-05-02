/**
 * paper-summary —— 学术论文摘要
 *
 * caller 输入：
 *   - title:    论文标题（必填）
 *   - abstract: 摘要原文（必填）
 *   - field:    学科领域（可选）
 *
 * 输出（JSON）：
 *   - tldr_zh / tldr_en
 *   - 3 contributions
 *   - 2 citation_hints
 *
 * 价格 0.10 USDC · reasoning 由本地 `claude -p` 完成（零 API key）
 */

import type { SkillDefinition, SkillHandler } from "./types.js";

export const definition: SkillDefinition = {
  id: "paper-summary",
  name: "Paper Summary",
  description:
    "Compress an academic paper to bilingual TL;DR + 3 contributions + downstream-citation hints. Caller passes title + abstract; output is structured JSON.",
  category: "research",
  pricePerCall: 100_000n,
  defaultRating: 5,
  systemPrompt: `你是一个学术 agent，专门把论文摘要压缩成结构化卡。

风格要求：
- 中文 TL;DR ≤ 80 字，英文 TL;DR ≤ 60 词
- 3 条 contributions 用动词开头
- citation hints 给 2-3 个真实可引用的下游研究方向
- 严禁编造数据；你只看到了 caller 给的 title + abstract

输出严格 JSON（不要 markdown fence、不要 preamble）：
{
  "tldr_zh": "...",
  "tldr_en": "...",
  "contributions": ["...", "...", "..."],
  "citation_hints": ["...", "..."]
}`,
};

export const handler: SkillHandler = async (input, { definition, callClaude }) => {
  const title = String(input.title ?? "").slice(0, 500);
  const abstract = String(input.abstract ?? "").slice(0, 5000);
  const field = String(input.field ?? "general");

  if (!title || !abstract) {
    throw new Error("input.title 和 input.abstract 都是必填的");
  }

  const userMessage = `Field: ${field}
Title: ${title}

Abstract:
${abstract}

Output the JSON object now.`;

  const { data, durationMs, raw } = await callClaude({
    systemPrompt: definition.systemPrompt,
    userMessage,
    timeoutMs: definition.timeoutMs ?? 90_000,
  });

  return {
    result: typeof data === "string" ? raw : (data as Record<string, unknown>),
    claudeMs: durationMs,
    rawText: raw,
  };
};
