/**
 * register-all.ts —— 把 5 个 Claude skill 一次性注册到 SkillRegistry
 *
 * 使用：
 *   PUBLIC_BASE_URL=https://skills.pneuma.dev pnpm register
 *
 * 或者本地 dev（但链上 endpoint 写 localhost 评委访问不到，仅做联调用）：
 *   PUBLIC_BASE_URL=http://localhost pnpm register
 *
 * 输出：
 *   - 5 行 SKILL_ID_<UPPER>=<id> 片段，复制粘到 .env / .env.local
 *   - 每条注册的 tx hash，可点 explorer 验
 *
 * 设计要点：
 *   - 每个 skill endpoint 用 ${PUBLIC_BASE_URL}/${skill-id}/api/run
 *     这样 Cloudflare Tunnel 的子路径 mapping 就能直接路由到对应端口
 *   - providerStake 0（demo 阶段不锁押金；生产应锁 5+ USDC）
 *   - slaTimeoutSec 600 秒（10 分钟，给 Claude reasoning + tunnel 延迟留余量）
 *   - slashBps 3000（30%，跟 ANTI_SYBIL_DESIGN.md 推荐对齐）
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../.env.local"), override: false });
loadEnv({ path: resolve(__dirname, "../../../.env.local"), override: false });

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

const RPC_URL = process.env.ARC_TESTNET_RPC_URL!;
const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);

if (!RPC_URL) throw new Error("ARC_TESTNET_RPC_URL 未设置");
if (!SKILL_REGISTRY) throw new Error("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS 未设置");
if (!PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY 未设置");

// SkillRegistry minimal ABI（只用 registerSkill + 事件）
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
      { name: "name", type: "string", indexed: false },
      { name: "endpoint", type: "string", indexed: false },
      { name: "pricePerCall", type: "uint256", indexed: false },
    ],
  },
] as const;

const arcChain = {
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: arcChain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account,
    chain: arcChain,
    transport: http(RPC_URL),
  });

  console.log(`\n🚀 注册 5 个 Claude skill 到 SkillRegistry`);
  console.log(`   chain:    ${CHAIN_ID}`);
  console.log(`   registry: ${SKILL_REGISTRY}`);
  console.log(`   owner:    ${account.address}`);
  console.log(`   baseUrl:  ${PUBLIC_BASE_URL}\n`);

  const envLines: string[] = [];

  for (const skill of Object.values(ALL_SKILLS)) {
    const def = skill.definition;
    const endpoint = `${PUBLIC_BASE_URL}/${def.id}/api/run`;

    console.log(`  ⏳ ${def.name} (${def.id}) → ${endpoint}`);
    try {
      const txHash = await walletClient.writeContract({
        address: SKILL_REGISTRY,
        abi: skillRegistryAbi,
        functionName: "registerSkill",
        args: [
          def.name,
          def.description,
          endpoint,
          def.category,
          def.pricePerCall,
          0n, // providerStake
          600n, // slaTimeoutSec
          3000n, // slashBps (30%)
          8192, // maxInputBytes
          16384, // maxOutputBytes
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const events = parseEventLogs({
        abi: skillRegistryAbi,
        logs: receipt.logs,
        eventName: "SkillRegistered",
      });
      const skillId = events[0]?.args.skillId;
      if (!skillId) throw new Error("SkillRegistered event 未找到");

      console.log(`     ✓ skillId=${skillId} · tx=${txHash}`);
      const envKey = `SKILL_ID_${def.id.replace(/-/g, "_").toUpperCase()}`;
      envLines.push(`${envKey}=${skillId}`);
    } catch (err) {
      console.error(`     ✗ 失败:`, (err as Error).message);
    }
  }

  console.log(`\n────────────────────────────────────────────────────`);
  console.log(`📋 把以下行复制粘贴到 packages/pneuma-claude-skills/.env：\n`);
  console.log(envLines.join("\n"));
  console.log(`\n────────────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
