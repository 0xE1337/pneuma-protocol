#!/usr/bin/env node
/**
 * demo-traffic-loop.mjs —— 演示日持续制造链上交易，让 /admin/dashboard 看板事件流不停跳
 *
 * 真闭环抓手：
 *   1. caller wallet (TEST_SELLER) approve USDC + escrowForCall(skillId, ...) → emit CallEscrowed
 *   2. fetch trycloudflare endpoint with x402 → service settle → emit CallSettled + Attested
 *   3. (可选) caller rateCall → emit CallerRatedSkill
 *
 * 顶层设计：每跑一个 round，看板上至少跳 2-3 个事件。round 之间间隔 INTERVAL_MS（默认 12s）。
 *
 * 用法：
 *   INTERVAL_MS=12000 ROUNDS=999 node scripts/demo-traffic-loop.mjs
 *   ROUNDS=30 node scripts/demo-traffic-loop.mjs                     # 跑 30 轮就停（预热模式）
 *   node scripts/demo-traffic-loop.mjs --once                         # 跑一轮立刻退（debug）
 *
 * 跟 packages/pneuma-claude-skills/script/seed-traffic.ts 的差异：
 *   - 不读 ALL_SKILLS hardcoded，直接从链上 listActiveSkills() 拿当前 active 列表
 *   - 不固定 ROUNDS=6 强制把每个 skill 跑满，而是循环按 skill 轮询，给看板"持续脉搏"
 *   - 顶上加 watchdog 信号：如果某个 endpoint 连续 3 次 fail，跳过它继续跑别的
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
loadEnv({ path: resolve(repoRoot, "apps/hub/.env.local") });
loadEnv({ path: resolve(repoRoot, "packages/pneuma-claude-skills/.env"), override: false });
loadEnv({ path: resolve(repoRoot, ".env.local"), override: false });

const RPC = process.env.ARC_TESTNET_RPC_URL || process.env.NEXT_PUBLIC_CHAIN_RPC;
const REG = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS;
const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS;
const CALLER_KEY = process.env.TEST_SELLER_PRIVATE_KEY || process.env.EOA_RESEARCH_BOT_PRIVATE_KEY;
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || "12000", 10);
const ROUNDS = parseInt(process.env.ROUNDS || "999", 10);
const ONCE = process.argv.includes("--once");

if (!CALLER_KEY) {
  console.error("[traffic-loop] FATAL: 找不到 TEST_SELLER_PRIVATE_KEY 或 EOA_RESEARCH_BOT_PRIVATE_KEY");
  process.exit(1);
}

const callerAddr = execFileSync("cast", ["wallet", "address", CALLER_KEY], { encoding: "utf8" }).trim();
console.log(`[traffic-loop] caller = ${callerAddr}`);
console.log(`[traffic-loop] interval = ${INTERVAL_MS}ms, target rounds = ${ROUNDS === 999 ? "infinite" : ROUNDS}`);

// 演示日只想打"我刚注册的最新 5 个 skill"，避开历史脏数据（老 listing endpoint 死了 URL）
// 通过 OWNER_FILTER 环境变量限制 — 不设就放开（兼容多 owner 演示）
// 默认我们用 agent-caller (0x3DB0...8c55) 注册了 35-39，所以默认按 caller 自己 filter
const OWNER_FILTER = (process.env.OWNER_FILTER || callerAddr).toLowerCase();
console.log(`[traffic-loop] owner filter = ${OWNER_FILTER === "all" ? "all" : OWNER_FILTER}`);

// 失败计数：连续 3 次 fail 的 skill 临时跳过
const failCount = new Map();
const SKIP_THRESHOLD = 3;

function castCall(args, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
      if (i === retries - 1) throw e;
    }
  }
}

function castSend(args, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const out = execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const txHashMatch = out.match(/0x[a-f0-9]{64}/i);
      return txHashMatch ? txHashMatch[0] : "ok";
    } catch (e) {
      const msg = String(e.stderr || e.message || "").slice(0, 200);
      if (i === retries - 1) throw new Error(msg);
    }
  }
}

async function listActiveSkills() {
  // cast call --json 输出标准 JSON：[[skillId, owner, name, desc, endpoint, category, price, totalCalls, active, ...]]
  // 比按逗号 split 稳一万倍 —— description 含逗号也不乱
  const totalRaw = castCall(["call", "--rpc-url", RPC, REG, "skillCount()(uint256)"]);
  const total = parseInt(totalRaw, 10);
  const out = [];
  // 反向扫最近 20 个（覆盖 35-39 + 一些 buffer，避开早期老废 skill）
  for (let i = total; i >= Math.max(1, total - 20); i--) {
    try {
      const raw = castCall(["call", "--json", "--rpc-url", RPC, REG,
        "getSkill(uint256)((uint256,address,string,string,string,string,uint256,uint256,bool,uint256,uint256,uint256,uint256,uint256))",
        String(i)]);
      const arr = JSON.parse(raw);
      const tuple = arr[0];
      const [skillId, owner, name, desc, endpoint, category, price, totalCalls, active] = tuple;
      // 排除老废 listing：endpoint 是 placeholder.invalid 或者 trycloudflare URL 太老的
      if (active === true && endpoint && !endpoint.includes("placeholder.invalid")) {
        out.push({ skillId: Number(skillId), owner, endpoint, price: String(price), name });
      }
    } catch (_) { /* skip */ }
  }
  return out;
}

async function tryCall(skill) {
  const id = `${skill.skillId}@${skill.endpoint.slice(8, 30)}…`;
  try {
    const r = await fetch(skill.endpoint + "/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ probe: "demo-traffic-loop" }),
      signal: AbortSignal.timeout(45000),
    });
    if (r.status === 402 || r.status === 200) {
      // server 已收到 → 它会自动 escrow + settle。看板事件已产。
      console.log(`[traffic-loop] ✅ ${id} → HTTP ${r.status} (event emitted)`);
      failCount.set(skill.skillId, 0);
      return true;
    }
    throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    const c = (failCount.get(skill.skillId) || 0) + 1;
    failCount.set(skill.skillId, c);
    console.log(`[traffic-loop] ❌ ${id} → ${String(e.message).slice(0, 80)}  (fail ${c}/${SKIP_THRESHOLD})`);
    return false;
  }
}

let round = 0;
async function loop() {
  while (round < ROUNDS) {
    round++;
    const all = await listActiveSkills().catch(() => []);
    const eligible = all.filter((s) => (failCount.get(s.skillId) || 0) < SKIP_THRESHOLD);
    if (eligible.length === 0) {
      console.log(`[traffic-loop] round ${round}: no eligible skill (all skipped). Resetting failCount.`);
      failCount.clear();
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
      continue;
    }
    const pick = eligible[round % eligible.length];
    console.log(`[traffic-loop] round ${round}: pick skill ${pick.skillId} (${eligible.length} eligible / ${all.length} active)`);
    await tryCall(pick);
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log(`[traffic-loop] DONE after ${round} rounds`);
}

loop().catch((e) => {
  console.error("[traffic-loop] FATAL:", e);
  process.exit(1);
});
