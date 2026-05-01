/**
 * code-review —— 真 Claude 代码评审（spawn 本地 `claude -p`）
 *
 * caller 输入：
 *   - language:  "typescript" / "solidity" / ...
 *   - diff:      git diff（≤ 50KB）
 *   - context:   可选业务上下文
 *
 * 输出 JSON：
 *   - severity-binned 评审清单（critical / high / medium / suggestion）
 *
 * 价格 0.15 USDC
 */

import type { SkillDefinition, SkillHandler } from "../types.js";

export const definition: SkillDefinition = {
  id: "code-review",
  name: "Code Review",
  description:
    "Senior reviewer pass on a git diff. Returns severity-binned findings (critical / high / medium / suggestion) with file + line hints + fix suggestions.",
  category: "engineering",
  pricePerCall: 150_000n,
  defaultRating: 5,
  systemPrompt: `你是一个资深 code reviewer，针对 caller 提交的 git diff 给出严苛评审。

风格要求：
- 严格按 4 档分类：critical（安全 / 数据丢失） / high（bug / 反模式） / medium（可维护性） / suggestion（风格）
- 每条提供 file:line hint（基于 diff +/- 行号）
- 不夸赞、不闲聊；直接列具体问题
- 严禁假装理解 caller 没给的代码上下文

输出严格 JSON（不要 markdown fence、不要 preamble）：
{
  "summary": "一句话整体判断",
  "critical": [{"file": "...", "line": 12, "issue": "...", "fix": "..."}],
  "high": [],
  "medium": [],
  "suggestion": []
}`,
};

export const handler: SkillHandler = async (input, { definition, callClaude }) => {
  const language = String(input.language ?? "unknown");
  const diff = String(input.diff ?? "").slice(0, 50_000);
  const context = String(input.context ?? "");

  if (!diff || diff.length < 10) {
    throw new Error("input.diff 必须是非空的 git diff 文本");
  }

  const userMessage = `Language: ${language}
${context ? `Context: ${context}\n` : ""}
Diff:
\`\`\`
${diff}
\`\`\`

Output the JSON now.`;

  const { data, durationMs, raw } = await callClaude({
    systemPrompt: definition.systemPrompt,
    userMessage,
    timeoutMs: definition.timeoutMs ?? 120_000, // diff 大时给更长时间
  });

  return {
    result: typeof data === "string" ? raw : (data as Record<string, unknown>),
    claudeMs: durationMs,
    rawText: raw,
  };
};
