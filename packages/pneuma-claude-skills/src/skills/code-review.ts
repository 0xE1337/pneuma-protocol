/**
 * code-review —— 真 Claude 代码评审
 *
 * caller 输入：
 *   - language:  编程语言（"typescript" / "solidity" / "python" 等，影响 Claude 重点）
 *   - diff:      git diff 文本（unified format，≤ 50KB）
 *   - context:   可选业务上下文，让 Claude 知道这段代码在干什么
 *
 * 输出：
 *   - severity-binned 评审清单（critical / high / medium / suggestion）
 *   - 每条带文件 + 行号 hint + 修复建议
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
  pricePerCall: 150_000n, // 0.15 USDC
  defaultRating: 5,
  needsWebFetch: false,
  systemPrompt: `你是一个资深 code reviewer，针对 caller 提交的 git diff 给出严苛评审。

风格要求：
- 严格按 4 档分类：critical（安全 / 数据丢失） / high（bug / 反模式） / medium（可维护性） / suggestion（风格）
- 每条提供 file:line hint（基于 diff 里的 +/- 行号）
- 不夸赞、不闲聊、不说"整体很好"——直接列具体问题
- 严禁假装理解 caller 没给的代码上下文，看不到的就标 "out of scope"

输出严格 JSON：
{
  "summary": "一句话整体判断",
  "critical": [{"file": "...", "line": 12, "issue": "...", "fix": "..."}],
  "high": [...],
  "medium": [...],
  "suggestion": [...]
}`,
};

export const handler: SkillHandler = async (input, { client, definition }) => {
  const language = String(input.language ?? "unknown");
  const diff = String(input.diff ?? "").slice(0, 50_000);
  const context = String(input.context ?? "");

  if (!diff || diff.length < 10) {
    throw new Error("input.diff 必须是非空的 git diff 文本");
  }

  const startedAt = Date.now();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: definition.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Language: ${language}
${context ? `Context: ${context}\n` : ""}
Diff:
\`\`\`
${diff}
\`\`\`

请评审，返回 JSON。`,
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
