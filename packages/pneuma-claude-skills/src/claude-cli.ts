/**
 * claude-cli.ts —— spawn 本地 `claude -p` 跑非交互式 reasoning
 *
 * 关键设计：**不调用 Anthropic API**，而是 spawn 本地 Claude Code CLI。
 * 这样：
 *   - 不需要 ANTHROPIC_API_KEY 环境变量
 *   - 不产生额外 per-token 计费（用户付的是 Claude Code 订阅费）
 *   - 每次 reasoning 的人物 = 用户 Claude Code 当前账号本人
 *
 * 这是 Pneuma 协议「sovereign agent 跑在用户自己电脑上」叙事的工程兑现：
 * 我电脑上的 AI agent 真的就是我自己订阅的那个 Claude，评委付钱给我，
 * 我用我的订阅算力替他干活，agent ↔ agent ↔ 真实结算闭环。
 *
 * 参考实现：pneuma-court-p2p/src/court_agent/jurors/_runner.py:_ask_claude_cli
 */

import { spawn } from "node:child_process";

export interface CallClaudeArgs {
  /** Skill 的 system prompt（人格 + 输出格式约束） */
  systemPrompt: string;
  /** Caller 这次请求的 user message */
  userMessage: string;
  /** 超时（ms）—— Claude Code 启动 + reasoning 通常 5-20 秒，给 90s 余量 */
  timeoutMs?: number;
  /** 可选 JSON schema —— 用 claude --json-schema 强制结构化输出 */
  jsonSchema?: object;
}

export interface CallClaudeResult {
  /** Claude 输出的 raw text（JSON 模式下也是字符串） */
  text: string;
  /** Claude CLI 进程耗时 ms（含启动 + reasoning） */
  durationMs: number;
}

/**
 * spawn `claude -p` 子进程跑一次非交互式 reasoning，回 stdout 字符串。
 *
 * 注意：
 *   - 不传 `--bare`，因为 bare 模式禁用 OAuth keychain（会强制要求 API key）
 *   - 通过 stdin 喂 userMessage，避免命令行参数长度限制 + shell escape 问题
 *   - 超时后强杀进程，防止 stuck
 */
export async function callClaude(args: CallClaudeArgs): Promise<CallClaudeResult> {
  const {
    systemPrompt,
    userMessage,
    timeoutMs = 90_000,
    jsonSchema,
  } = args;

  const cliArgs = [
    "-p", // 非交互模式（即 --print）
    "--append-system-prompt",
    systemPrompt,
  ];

  if (jsonSchema) {
    cliArgs.push("--json-schema", JSON.stringify(jsonSchema));
  }

  const startedAt = Date.now();

  return new Promise<CallClaudeResult>((resolve, reject) => {
    const child = spawn("claude", cliArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `claude CLI 超时 ${timeoutMs}ms（stderr 头部：${stderr.slice(0, 200)}）`,
        ),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `claude CLI 启动失败：${err.message}（请确认本地装了 Claude Code：\`which claude\`）`,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (code !== 0) {
        reject(
          new Error(
            `claude CLI 退出 code=${code}: ${(stderr || stdout).slice(0, 300)}`,
          ),
        );
        return;
      }
      resolve({ text: stdout, durationMs });
    });

    // 通过 stdin 把 user message 喂进去
    child.stdin.write(userMessage);
    child.stdin.end();
  });
}

/**
 * 便利函数：让 Claude 输出 JSON，自动 strip markdown fences + parse。
 *
 * Claude Code 即使 system prompt 说"only JSON"，偶尔还是会包 ```json ... ``` 围栏；
 * 这个函数自动剥离。如果传了 jsonSchema，CLI 会强制 valid JSON，但 fence 仍可能在。
 */
export async function callClaudeJson<T = unknown>(
  args: CallClaudeArgs,
): Promise<{ data: T | string; durationMs: number; raw: string }> {
  const { text, durationMs } = await callClaude(args);
  const raw = text.trim();

  // 尝试找到第一个 { 或 [ 到对应的最后一个 } 或 ]
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
    // parse 失败 fallback 给 raw text
    return { data: raw, durationMs, raw };
  }
}
