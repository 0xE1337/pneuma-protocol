/**
 * register-tunnels.ts —— 读 .tunnels.json，把 5 个 trycloudflare URL 一次性
 * 注册到链上。每条 URL 一个独立 SKILL_URL_<UPPER> env 变量喂给 register-all。
 *
 * 用法：
 *   pnpm tunnels:up        # 在另一个终端先跑这个起 5 条 tunnel + 写 .tunnels.json
 *   pnpm register:tunnels  # 等 .tunnels.json 出现后跑这个上链
 *
 * 设计要点：
 *   - 抓 .tunnels.json 用确定性的环境变量传给 register-all，避免编辑 .env
 *   - 跑前 ping 一遍每条 URL 验证 tunnel 真活着（避免链上注册了死 URL）
 *   - 注册完输出 5 个 SKILL_ID_*=N，复制到 .env 后重启 server
 */

import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../.env.local"), override: false });
loadEnv({ path: resolve(__dirname, "../../../.env.local"), override: false });
loadEnv({
  path: resolve(__dirname, "../../../apps/hub/.env.local"),
  override: false,
});

const manifestPath = resolve(__dirname, "../.tunnels.json");
if (!existsSync(manifestPath)) {
  console.error(`❌ .tunnels.json 不存在。先在另一个终端跑：

  pnpm tunnels:up

等它打印 "5/5 URL 已抓齐" 后再回来跑这个命令。
`);
  process.exit(1);
}

interface TunnelManifest {
  createdAt: string;
  urls: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as TunnelManifest;
const urls = manifest.urls ?? {};

const SKILL_IDS = [
  "paper-summary",
  "code-review",
  "block-explainer",
  "creative-write",
  "quick-reasoning",
];

const missing = SKILL_IDS.filter((id) => !urls[id]);
if (missing.length > 0) {
  console.error(`❌ .tunnels.json 缺这些 skill 的 URL：${missing.join(", ")}`);
  console.error(`   重跑 pnpm tunnels:up`);
  process.exit(1);
}

console.log(`\n📡 .tunnels.json 抓到时间：${manifest.createdAt}`);
console.log(`🔍 验证 5 个 tunnel URL 都活着…\n`);

let allOk = true;
for (const id of SKILL_IDS) {
  const url = urls[id];
  const r = spawnSync(
    "curl",
    ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "8", `${url}/`],
    { encoding: "utf-8" },
  );
  const code = r.stdout.trim();
  const ok = code === "200";
  console.log(`  ${ok ? "✓" : "✗"} ${id.padEnd(20)} ${url} → ${code}`);
  if (!ok) allOk = false;
}

if (!allOk) {
  console.error(`
❌ 至少一个 tunnel URL 不通。
   1. 先确认 5 个 skill server 还在跑（pnpm start:all）
   2. 再确认 5 条 cloudflared tunnel 还在跑（pnpm tunnels:up 那个进程）
`);
  process.exit(1);
}

console.log(`\n✅ 5 个 URL 都通了。开始链上注册（5 笔 tx，gas 费 deployer 钱包出）…\n`);

// 把每条 URL 通过 SKILL_URL_<UPPER> 环境变量喂给 register-all
const env = { ...process.env };
for (const id of SKILL_IDS) {
  const key = `SKILL_URL_${id.replace(/-/g, "_").toUpperCase()}`;
  env[key] = urls[id];
}
// 保险：清掉 PUBLIC_BASE_URL 防 named-tunnel 模式抢路径
delete env.PUBLIC_BASE_URL;

const child = spawnSync("npx", ["tsx", resolve(__dirname, "register-all.ts")], {
  stdio: "inherit",
  env,
});

if (child.status !== 0) process.exit(child.status ?? 1);

console.log(`
────────────────────────────────────────────────────────────
🎯 注册完成。下一步必做：

  1. 把 stdout 5 行 SKILL_ID_*=N 复制粘到 .env（覆盖旧值）

  2. 重启 5 个 skill server（让新 SKILL_ID_* 生效）：
       pkill -f "tsx src/server.ts"
       pnpm start:all

  3. 跑 smoke 验证一笔真调用：
       curl -s https://<URL>/api/run （注意 hub /run 才能真签 escrow）

  4. ⚠ 演示期保持「pnpm tunnels:up」那个进程不要关
     —— 5 条 trycloudflare URL 是临时的，关掉重启 URL 全换，链上 endpoint 就废
────────────────────────────────────────────────────────────
`);
