#!/usr/bin/env node
/**
 * start-tunnels.mjs —— 起 5 条 cloudflared quick tunnel（无需登录）
 *
 * 每条 tunnel 暴露 1 个本地端口为公网 https://random-words.trycloudflare.com URL，
 * 不需要 Cloudflare 账号 / OAuth / 域名。
 *
 * 唯一约束：每次 spawn 出来的 URL 不一样，**重启 = URL 全换**。
 * 演示期保持 5 个 tunnel 进程不重启就稳定。
 *
 * 用法：
 *   node script/start-tunnels.mjs
 *
 * 输出：
 *   1. 5 条 tunnel 各自占一个 stdout 段（彩色 prefix 区分）
 *   2. 5 个 URL 全部抓到后写到 packages/pneuma-claude-skills/.tunnels.json
 *   3. 进程保持前台运行——Ctrl+C 全部关闭
 *
 * 完成后另一个 terminal 跑：
 *   pnpm register:tunnels   # 自动读 .tunnels.json + 链上重注册
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const SKILLS = [
  { id: "paper-summary", port: 3101, color: "\x1b[36m" },
  { id: "code-review", port: 3102, color: "\x1b[35m" },
  { id: "block-explainer", port: 3103, color: "\x1b[33m" },
  { id: "creative-write", port: 3104, color: "\x1b[32m" },
  { id: "quick-reasoning", port: 3105, color: "\x1b[34m" },
];
const RESET = "\x1b[0m";

// 抓到的 URL 累计存这里
const tunnelUrls = {};

// trycloudflare.com URL 在 stdout 里出现的模式
//
// 关键修复 (2026-05-02)：原来 /https:\/\/[a-z0-9-]+\.trycloudflare\.com/ 太宽松，
// 把 cloudflared 错误日志里的 `Post "https://api.trycloudflare.com/tunnel": EOF`
// 也匹配上 (api 也是 [a-z0-9-]+)，并发起 tunnel 限流时 4/5 失败但 4/5 都把
// `https://api.trycloudflare.com` 当成自己的 tunnel URL 写进 .tunnels.json。
// 后续 register 5/5 命中废 URL，全部上链废 listing。
//
// 修法：排除 `api.trycloudflare.com` 这个已知的 false positive。真 quick tunnel
// 的 URL 形如 `https://<adj>-<noun>-<verb>-<noun>.trycloudflare.com`。
const URL_REGEX = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i;

function startTunnel(skill) {
  const tag = `${skill.color}[${skill.id}]${RESET}`;

  const child = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://localhost:${skill.port}`, "--no-autoupdate"],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );

  function processChunk(chunk) {
    const text = chunk.toString();
    process.stdout.write(`${tag} ${text}`);
    // 抓 URL（只第一次）
    if (!tunnelUrls[skill.id]) {
      const m = text.match(URL_REGEX);
      if (m) {
        tunnelUrls[skill.id] = m[0];
        console.log(
          `\n${tag} ✅ URL captured: ${m[0]}  (${Object.keys(tunnelUrls).length}/5)\n`,
        );
        if (Object.keys(tunnelUrls).length === SKILLS.length) {
          // 5 个全到齐 → 写 manifest
          const manifestPath = resolve(repoRoot, ".tunnels.json");
          writeFileSync(
            manifestPath,
            JSON.stringify(
              {
                createdAt: new Date().toISOString(),
                urls: tunnelUrls,
              },
              null,
              2,
            ),
          );
          console.log(`\n🎯 5/5 URL 已抓齐，写入 ${manifestPath}`);
          console.log(`\n下一步另一个 terminal 跑：`);
          console.log(`   pnpm register:tunnels`);
          console.log(`\n演示期保持当前进程开着不要 Ctrl+C —— 关掉 URL 就废\n`);
        }
      }
    }
  }

  child.stdout.on("data", processChunk);
  child.stderr.on("data", processChunk);

  child.on("exit", (code) => {
    console.error(`${tag} ⚠ tunnel 退出 code=${code}`);
  });
}

console.log("\n🌐 起 5 条 cloudflared quick tunnel（无需登录）");
console.log("   每个 skill 一条独立 https://*.trycloudflare.com URL");
console.log("   抓齐后自动写 .tunnels.json，再跑 pnpm register:tunnels");
console.log("   ⚠ 串行间隔 4s 启动 —— 避免并发触发 trycloudflare API 限流 (EOF)\n");

// 串行间隔启动：cloudflared quick tunnel 走 https://api.trycloudflare.com/tunnel
// POST 申请，5 个并发请求会触发限流，4/5 返回 EOF。间隔 4s 让限流窗口过去。
for (const [i, skill] of SKILLS.entries()) {
  setTimeout(() => startTunnel(skill), i * 4000);
}

process.on("SIGINT", () => {
  console.log("\n收到 SIGINT，关停所有 tunnel …");
  process.exit(0);
});
