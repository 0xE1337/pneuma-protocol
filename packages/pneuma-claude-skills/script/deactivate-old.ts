/**
 * deactivate-old.ts —— 把旧 localhost 版 skill (8-12) deactivate
 *
 * 让 LLM planner 只能选新的公网 trycloudflare 版 (13-17)
 *
 * 用法：
 *   pnpm deactivate:old
 */

import { config as loadEnv } from "dotenv";
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
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ALL_SKILLS } from "../src/skills/index.js";

const RPC = process.env.ARC_TESTNET_RPC_URL!;
const REG = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;

const arcChain = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

// 这次要 deactivate 的 skill: 8-12（旧 localhost 版）
// 用 process.argv 也支持自定义 ID 列表：pnpm deactivate:old 8 9 10
const idsArg = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const targetIds = idsArg.length > 0 ? idsArg : [8, 9, 10, 11, 12];

const skillRegistryAbi = [
  {
    type: "function",
    name: "updateSkill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "uint256" },
      { name: "newPrice", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    outputs: [],
  },
] as const;

// 旧 5 个 skillId (8-12) 跟 ALL_SKILLS 5 个 definition 顺序一致
// 注册顺序：paper-summary=8, code-review=9, block-explainer=10, creative-write=11, quick-reasoning=12
const PRICE_BY_SLOT = Object.values(ALL_SKILLS).map((s) => s.definition.pricePerCall);

async function main() {
  const account = privateKeyToAccount(KEY);
  const publicClient = createPublicClient({ chain: arcChain, transport: http(RPC) });
  const walletClient = createWalletClient({
    account,
    chain: arcChain,
    transport: http(RPC),
  });

  console.log(`\n🛑 Deactivate skill IDs: ${targetIds.join(", ")}`);
  console.log(`   owner: ${account.address}\n`);

  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i];
    // 价格按 slot 推算（idsArg 自定义场景下用第一个 skill 的价格 fallback）
    const price = PRICE_BY_SLOT[i] ?? PRICE_BY_SLOT[0]!;
    try {
      console.log(`  ⏳ #${id} → deactivate (active=false, price=${price})…`);
      const tx = await walletClient.writeContract({
        address: REG,
        abi: skillRegistryAbi,
        functionName: "updateSkill",
        args: [BigInt(id), price, false],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`     ✓ ${tx}`);
    } catch (e) {
      console.log(`  ✗ #${id} 失败: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  console.log(`\n✅ 完成。\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
