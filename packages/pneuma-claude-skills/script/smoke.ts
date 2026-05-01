/**
 * smoke.ts —— 验证本地 `claude -p` 能不能调通 + JSON 输出符合期望
 *
 * 用法：
 *   pnpm smoke
 *
 * 跑前提：
 *   1. 你电脑上装了 Claude Code（`which claude` 有结果）
 *   2. Claude Code 已经登录过（OAuth keychain 有 token）
 *
 * 不需要任何 .env 配置。这个脚本是验证 spawn 链路是否正常的最小冒烟。
 */

import { callClaudeJson } from "../src/claude-cli.js";

interface SmokeResult {
  greeting?: string;
  language?: string;
  numbers?: number[];
}

async function main() {
  console.log("\n🔥 Smoke test: spawn `claude -p` 验证非交互式 reasoning + JSON 输出\n");

  const startedAt = Date.now();
  const { data, durationMs, raw } = await callClaudeJson<SmokeResult>({
    systemPrompt: `你是一个 smoke-test agent。严格输出 JSON，不要 markdown fence、不要 preamble。`,
    userMessage: `请输出一个 JSON 对象，包含三个字段：
{
  "greeting": "一句中文问候",
  "language": "你正在用的语言名（如 'zh-CN'）",
  "numbers": [1 到 5 的整数数组]
}

Output the JSON now.`,
    timeoutMs: 60_000,
  });
  const total = Date.now() - startedAt;

  console.log(`✓ Claude CLI 启动 + reasoning 用时：${durationMs}ms`);
  console.log(`✓ 总流程（含 spawn）：${total}ms\n`);

  console.log(`Raw output (head 300 chars):\n${raw.slice(0, 300)}\n`);

  if (typeof data === "string") {
    console.error("❌ JSON parse 失败 —— claude 输出可能多了 markdown fence 或解释文字");
    console.error("debug：完整 raw output 见上面");
    process.exit(1);
  }

  console.log("Parsed JSON：");
  console.log(JSON.stringify(data, null, 2));

  // 检查字段
  const checks = [
    { name: "greeting (string)", ok: typeof data.greeting === "string" && data.greeting.length > 0 },
    { name: "language (string)", ok: typeof data.language === "string" && data.language.length > 0 },
    { name: "numbers (array, length 5)", ok: Array.isArray(data.numbers) && data.numbers.length === 5 },
  ];
  console.log("\n字段检查：");
  for (const { name, ok } of checks) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  }

  const allOk = checks.every((c) => c.ok);
  console.log(allOk ? "\n✅ Smoke 通过 —— 你电脑上的 claude CLI + spawn 链路工作正常\n" : "\n❌ Smoke 部分失败 —— 看上面字段检查\n");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("\n❌ Smoke 失败：", (err as Error).message);
  console.error("\n排查建议：");
  console.error("  1. `which claude` —— 确认 Claude Code CLI 已装");
  console.error("  2. `claude` —— 启动一次确认 OAuth 已登录（如未登录会提示 login）");
  console.error("  3. `claude --version` —— 看版本");
  console.error("");
  process.exit(1);
});
