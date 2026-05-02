/**
 * claude-api.ts —— Anthropic SDK adapter for Pneuma skill handlers
 *
 * 顶层设计：原 packages/pneuma-claude-skills/src/claude-cli.ts 调本地 `claude -p`
 * 子进程，Vercel function 跑不了。这里写一个**接口 100% 兼容**的 SDK 版，
 * 让 5 个 skill module 的 handler 不改一行代码就能跑在 hub Vercel 上。
 *
 * 关键差异：
 *   - 本地 CLI 模式: 走用户 Claude Code 订阅，零 API key，按订阅费计费
 *   - SDK 模式:     走 ANTHROPIC_API_KEY，按 token 计费（演示成本可控）
 *
 * 接口必须跟 packages/pneuma-claude-skills/src/claude-cli.ts 的 callClaude /
 * callClaudeJson 完全一致，否则 skill handler 需要 import 路径改造。
 */

import Anthropic from "@anthropic-ai/sdk";

export interface CallClaudeArgs {
  systemPrompt: string;
  userMessage: string;
  timeoutMs?: number;
  jsonSchema?: object;
}

export interface CallClaudeResult {
  text: string;
  durationMs: number;
}

// 单例 client —— Vercel function 跨请求复用 connection pool 减少冷启动开销
let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY 未配置（请在 Vercel env 配置；本地开发放 apps/hub/.env.local）",
      );
    }
    client = new Anthropic({ apiKey, timeout: 60_000 });
  }
  return client;
}

/**
 * spawn 等价物：用 messages.create 调 Claude，return raw text。
 * jsonSchema 参数被忽略（SDK 没有 --json-schema flag；JSON 输出靠 systemPrompt
 * 强约束 + caller 端 JSON.parse）。
 */
export async function callClaude(args: CallClaudeArgs): Promise<CallClaudeResult> {
  const start = Date.now();
  const client = getClient();
  // 默认 model: claude-haiku-4-5 —— 演示成本最优（每 skill 0.03-0.20 USDC 价格够覆盖）。
  // 想要更高质量可以在 env 覆盖。
  const model = process.env.PNEUMA_SKILL_MODEL ?? "claude-haiku-4-5";
  const r = await client.messages.create({
    model,
    max_tokens: 1024,
    system: args.systemPrompt,
    messages: [{ role: "user", content: args.userMessage }],
  });
  // r.content 是 ContentBlock[]，第一个 text block 拿 text 字段
  const block = r.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  return { text, durationMs: Date.now() - start };
}

/**
 * JSON-mode wrapper —— 接口跟原 packages/pneuma-claude-skills/src/claude-cli.ts:124
 * 完全一致：返回 { data, durationMs, raw }。skill handler 期望这种 shape。
 *
 * 容错：模型偶尔会 wrap `\`\`\`json` fence 或前后多 preamble，用 indexOf("{") /
 * lastIndexOf("}") 切片再 parse。失败 fallback 给 raw text。
 */
export async function callClaudeJson<T = unknown>(
  args: CallClaudeArgs,
): Promise<{ data: T | string; durationMs: number; raw: string }> {
  const { text, durationMs } = await callClaude(args);
  const raw = text.trim();

  const objStart = raw.indexOf("{");
  const objEnd = raw.lastIndexOf("}");
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");

  let candidate = raw;
  if (objStart !== -1 && objEnd > objStart) {
    candidate = raw.slice(objStart, objEnd + 1);
  } else if (arrStart !== -1 && arrEnd > arrStart) {
    candidate = raw.slice(arrStart, arrEnd + 1);
  }

  try {
    const data = JSON.parse(candidate) as T;
    return { data, durationMs, raw };
  } catch {
    return { data: raw, durationMs, raw };
  }
}
