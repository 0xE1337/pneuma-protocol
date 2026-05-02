#!/usr/bin/env node
/**
 * start-all.mjs —— 一次起 5 个 skill 进程
 *
 * 每个 skill 一个独立 node 子进程：
 *   - 自己的 PID
 *   - 自己的端口
 *   - 自己的 stdout 前缀（彩色，方便区分）
 *   - 自己的 owner private key（Sovereign agent 视角：每 skill 用真 owner 签 settle）
 *
 * 任一进程挂了，supervisor 自动重启（最多 5 次，超过就放弃报错）。
 *
 * 用法：
 *   node script/start-all.mjs
 *
 * 或 pnpm script:
 *   pnpm start:all
 */

import { config as loadEnv } from "dotenv";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// 加载 .env 拿 owner private keys
loadEnv({ path: resolve(repoRoot, ".env") });

// Skill → owner agent 名（必须跟 register-multi-agent.ts OWNER_OF 对齐）
const OWNER_OF = {
  "paper-summary": "RESEARCH_BOT",
  "creative-write": "RESEARCH_BOT",
  "quick-reasoning": "RESEARCH_BOT",
  "code-review": "WEB3_AUDITOR",
  "block-explainer": "WEB3_AUDITOR",
};

const SKILLS = [
  { id: "paper-summary", port: 3101, color: "\x1b[36m" }, // cyan
  { id: "code-review", port: 3102, color: "\x1b[35m" }, // magenta
  { id: "block-explainer", port: 3103, color: "\x1b[33m" }, // yellow
  { id: "creative-write", port: 3104, color: "\x1b[32m" }, // green
  { id: "quick-reasoning", port: 3105, color: "\x1b[34m" }, // blue
];
const RESET = "\x1b[0m";

const MAX_RESTARTS = 5;

function startSkill(skill) {
  let restarts = 0;

  function spawnIt() {
    const tag = `${skill.color}[${skill.id}:${skill.port}]${RESET}`;

    // 注入 SKILL_OWNER_KEY_<UPPER> = 对应 agent 的 EOA_*_PRIVATE_KEY
    const ownerName = OWNER_OF[skill.id]; // RESEARCH_BOT 或 WEB3_AUDITOR
    const ownerKey = ownerName ? process.env[`EOA_${ownerName}_PRIVATE_KEY`] : undefined;
    const ownerKeyEnvVar = `SKILL_OWNER_KEY_${skill.id.replace(/-/g, "_").toUpperCase()}`;

    const child = spawn("npx", ["tsx", "src/server.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SKILL_ID: skill.id,
        PORT_OVERRIDE: String(skill.port),
        ...(ownerKey ? { [ownerKeyEnvVar]: ownerKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(`${tag} ${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`${tag} ${chunk}`);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`${tag} 正常退出`);
        return;
      }
      restarts++;
      if (restarts > MAX_RESTARTS) {
        console.error(`${tag} 已重启 ${MAX_RESTARTS} 次仍失败，放弃。`);
        return;
      }
      console.warn(
        `${tag} 退出 code=${code}，1 秒后重启（${restarts}/${MAX_RESTARTS}）`,
      );
      setTimeout(spawnIt, 1000);
    });
  }

  spawnIt();
}

console.log("\n🚀 启动 5 个 Pneuma Claude skill 进程");
console.log("   每个进程独立 PID + 端口 + Anthropic 调用栈");
console.log("   任一进程挂了自动重启（最多 5 次）\n");

for (const skill of SKILLS) {
  startSkill(skill);
}

// Ctrl+C 时正确清理
process.on("SIGINT", () => {
  console.log("\n收到 SIGINT，关停所有子进程…");
  process.exit(0);
});
