/**
 * register-tunnel.ts —— 重注册 5 个 skill，endpoint 切到 Cloudflare Tunnel 公网 URL
 *
 * 这是 register-all.ts 的 wrapper：
 *   1. 强制要求 PUBLIC_BASE_URL（避免误注册成 localhost）
 *   2. 跑前 ping 一下公网 hostname 确认 tunnel 真通了
 *   3. 注册完 stdout 输出新 SKILL_ID_* + 提示要更新 .env + 重启 server
 *
 * 用法：
 *   PUBLIC_BASE_URL=https://abc-xyz.cfargotunnel.com pnpm register:tunnel
 *
 * 前置（详见 SETUP_TUNNEL.md）：
 *   - cloudflared tunnel run pneuma-skills 已经在另一个终端跑着
 *   - 5 个 skill server 已经在 :3101-3105 跑着（pnpm start:all）
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../.env.local"), override: false });
loadEnv({ path: resolve(__dirname, "../../../.env.local"), override: false });
loadEnv({
  path: resolve(__dirname, "../../../apps/hub/.env.local"),
  override: false,
});

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "";

if (!PUBLIC_BASE_URL || !PUBLIC_BASE_URL.startsWith("https://")) {
  console.error(`
❌ 必须设置 PUBLIC_BASE_URL 环境变量为 https URL。

正确用法：
  PUBLIC_BASE_URL=https://abc-xyz.cfargotunnel.com pnpm register:tunnel

如果还没建 tunnel，先看 SETUP_TUNNEL.md 跑完 step 1-7。
`);
  process.exit(1);
}

const SKILL_PATHS = [
  "paper-summary",
  "code-review",
  "block-explainer",
  "creative-write",
  "quick-reasoning",
];

console.log(`\n🔍 验证 tunnel 公网 URL 通不通……`);
console.log(`   base: ${PUBLIC_BASE_URL}\n`);

let allOk = true;
for (const path of SKILL_PATHS) {
  const url = `${PUBLIC_BASE_URL}/${path}/`;
  const r = spawnSync(
    "curl",
    ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "5", url],
    { encoding: "utf-8" },
  );
  const code = r.stdout.trim();
  const ok = code === "200";
  console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(20)} ${url}  → ${code}`);
  if (!ok) allOk = false;
}

if (!allOk) {
  console.error(`
❌ 至少一个 skill endpoint 公网不通。

排查：
  1. cloudflared tunnel run pneuma-skills 还在跑吗？
  2. pnpm start:all 5 个 server 都活吗？(curl http://localhost:3101/ 验证)
  3. ~/.cloudflared/config.yml 的 ingress path 是不是 /<skill-id>/.* ?
  4. PUBLIC_BASE_URL 拼写对不对？
`);
  process.exit(1);
}

console.log(`\n✅ 5 个 endpoint 公网都通了。开始链上重注册……\n`);

// 委托给 register-all.ts —— 复用所有上链逻辑
const child = spawnSync(
  "npx",
  ["tsx", resolve(__dirname, "register-all.ts")],
  {
    stdio: "inherit",
    env: { ...process.env, PUBLIC_BASE_URL },
  },
);

if (child.status !== 0) process.exit(child.status ?? 1);

console.log(`
────────────────────────────────────────────────────────────
🎯 重注册完成。下一步必做：

  1. 把上面 stdout 5 行 SKILL_ID_*=N 复制粘到 .env（覆盖旧值）

  2. 重启 5 个 skill server 让新 skillId 生效：
       pkill -f "tsx src/server.ts"
       pnpm start:all

  3. 等 30 秒，刷新 hub /discover —— 应该看到新 5 个公网 endpoint

  4. （可选）旧 5 个 localhost skill 在链上仍 active；
     可用 deactivate 工具关掉，避免 LLM 把它们也加进 plan
────────────────────────────────────────────────────────────
`);
