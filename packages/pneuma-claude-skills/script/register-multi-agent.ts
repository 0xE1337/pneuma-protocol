/**
 * register-multi-agent.ts —— 用 2 个独立 agent owner 把 5 个 skill 分组注册到链上
 *
 * 分配（写死，跟 setup-multi-agent.ts 对齐）：
 *   Research-Bot (EOA_RESEARCH_BOT_PRIVATE_KEY)
 *     → paper-summary
 *     → creative-write
 *     → quick-reasoning
 *
 *   Web3-Auditor (EOA_WEB3_AUDITOR_PRIVATE_KEY)
 *     → code-review
 *     → block-explainer
 *
 * 这样 LLM planner 拆「评审 Solidity diff + 写推广文 + 解释概念」会**真跨 2 agent**：
 *   step 1 → Web3-Auditor 的 code-review
 *   step 2 → Research-Bot 的 creative-write
 *   step 3 → Research-Bot 的 quick-reasoning
 *
 * Endpoint 用 .tunnels.json 里 5 条 trycloudflare URL（quick tunnel 模式）。
 *
 * 用法：
 *   1. pnpm tunnels:up        # 在另一个终端起 5 条 tunnel
 *   2. pnpm register:multi-agent  # 跑这个，5 笔 tx
 *   3. 把 stdout 5 行 SKILL_ID_*=N 复制粘到 .env（覆盖旧值）
 *   4. pnpm deactivate:old   # 关掉旧版（旧 deployer-owned + mock）
 *   5. 重启 server
 */

import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../../../.env.local"), override: false });
loadEnv({
  path: resolve(__dirname, "../../../apps/hub/.env.local"),
  override: false,
});

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ALL_SKILLS } from "../src/skills/index.js";
import type { SkillId } from "../src/types.js";

const RPC = process.env.ARC_TESTNET_RPC_URL!;
const REG = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);

// Skill → owner agent 分配
const OWNER_OF: Record<SkillId, "RESEARCH_BOT" | "WEB3_AUDITOR"> = {
  "paper-summary": "RESEARCH_BOT",
  "creative-write": "RESEARCH_BOT",
  "quick-reasoning": "RESEARCH_BOT",
  "code-review": "WEB3_AUDITOR",
  "block-explainer": "WEB3_AUDITOR",
};

const arcChain = {
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const skillRegistryAbi = [
  {
    type: "function",
    name: "registerSkill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "category", type: "string" },
      { name: "pricePerCall", type: "uint256" },
      { name: "providerStake", type: "uint256" },
      { name: "slaTimeoutSec", type: "uint256" },
      { name: "slashBps", type: "uint256" },
      { name: "maxInputBytes", type: "uint32" },
      { name: "maxOutputBytes", type: "uint32" },
    ],
    outputs: [{ name: "skillId", type: "uint256" }],
  },
  {
    type: "event",
    name: "SkillRegistered",
    inputs: [
      { name: "skillId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "name", type: "string" },
      { name: "pricePerCall", type: "uint256" },
    ],
  },
] as const;

async function main() {
  // 加载 .tunnels.json
  const manifestPath = resolve(__dirname, "../.tunnels.json");
  if (!existsSync(manifestPath)) {
    console.error(`❌ .tunnels.json 不存在。先在另一个终端跑 pnpm tunnels:up`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    urls: Record<string, string>;
  };

  // 加载 2 agent owner keys
  const keys: Record<"RESEARCH_BOT" | "WEB3_AUDITOR", Hex> = {
    RESEARCH_BOT: process.env.EOA_RESEARCH_BOT_PRIVATE_KEY as Hex,
    WEB3_AUDITOR: process.env.EOA_WEB3_AUDITOR_PRIVATE_KEY as Hex,
  };
  if (!keys.RESEARCH_BOT || !keys.WEB3_AUDITOR) {
    console.error(`❌ EOA_RESEARCH_BOT_PRIVATE_KEY / EOA_WEB3_AUDITOR_PRIVATE_KEY 未设置。先跑 pnpm setup:multi-agent`);
    process.exit(1);
  }

  const publicClient = createPublicClient({ chain: arcChain, transport: http(RPC) });

  console.log(`\n🚀 注册 5 skill 给 2 个独立 agent owner`);
  console.log(`   chain:   ${CHAIN_ID}`);
  console.log(`   registry: ${REG}\n`);
  console.log(`   Research-Bot:  ${privateKeyToAccount(keys.RESEARCH_BOT).address}`);
  console.log(`   Web3-Auditor:  ${privateKeyToAccount(keys.WEB3_AUDITOR).address}\n`);

  const envLines: string[] = [];

  for (const skill of Object.values(ALL_SKILLS)) {
    const def = skill.definition;
    const ownerKey = keys[OWNER_OF[def.id]];
    const ownerAccount = privateKeyToAccount(ownerKey);
    const url = manifest.urls[def.id];
    if (!url) {
      console.error(`  ✗ ${def.id} —— .tunnels.json 没有这个 skill 的 URL`);
      continue;
    }
    const endpoint = `${url.replace(/\/$/, "")}/api/run`;

    const wallet = createWalletClient({
      account: ownerAccount,
      chain: arcChain,
      transport: http(RPC),
    });

    console.log(`  ⏳ ${def.name.padEnd(20)} ← ${OWNER_OF[def.id].padEnd(13)} → ${endpoint}`);
    try {
      const tx = await wallet.writeContract({
        address: REG,
        abi: skillRegistryAbi,
        functionName: "registerSkill",
        args: [
          def.name,
          def.description,
          endpoint,
          def.category,
          def.pricePerCall,
          0n,         // providerStake
          600n,       // slaTimeoutSec
          3000n,      // slashBps (30%)
          8192,       // maxInputBytes
          16384,      // maxOutputBytes
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const events = parseEventLogs({
        abi: skillRegistryAbi,
        logs: receipt.logs,
        eventName: "SkillRegistered",
      });
      const skillId = events[0]?.args.skillId;
      if (!skillId) throw new Error("SkillRegistered event 未找到");
      console.log(`     ✓ skillId=${skillId} · tx=${tx}`);
      const envKey = `SKILL_ID_${def.id.replace(/-/g, "_").toUpperCase()}`;
      envLines.push(`${envKey}=${skillId}`);
    } catch (e) {
      console.error(`     ✗ 失败:`, (e as Error).message.slice(0, 200));
    }
  }

  console.log(`\n────────────────────────────────────────────────────`);
  console.log(`📋 复制粘到 packages/pneuma-claude-skills/.env：\n`);
  console.log(envLines.join("\n"));
  console.log(`\n下一步：`);
  console.log(`  1. 上面 5 行写到 .env（覆盖旧的 SKILL_ID_*）`);
  console.log(`  2. pnpm deactivate:old 13 14 15 16 17  # 关掉旧 deployer-owned 版`);
  console.log(`  3. pnpm deactivate:old 1 2 3 4 5       # 关掉早期 mock`);
  console.log(`  4. pkill -f "tsx src/server.ts" && pnpm start:all  # 用新 SKILL_ID + owner key 重启`);
  console.log(`────────────────────────────────────────────────────\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
