/**
 * setup-multi-agent.ts —— 一站式 sovereign agent 起手
 *
 * 干 4 件事（幂等，重复跑只补缺失部分）：
 *   1. 生成 2 个独立 EOA（如果 .env 没有就 generatePrivateKey + 写入）
 *   2. deployer → 每个新 EOA 转 1 USDC（gas + skill stake reserve）
 *      注：Arc Testnet USDC 同时是 native gas，1 USDC 够 ~30 笔 tx
 *   3. 每个 EOA 用 SoulNFT.publicMint 铸自己的 Soul
 *   4. 把 PRIVATE_KEY / ADDRESS / SOUL_TOKEN_ID / SOUL_TBA 全部回写 .env
 *
 * 设计：
 *   AGENT_A = "Research-Bot"  —— 拥有 paper-summary + creative-write + quick-reasoning
 *   AGENT_B = "Web3-Auditor"  —— 拥有 code-review + block-explainer
 *
 * 用法：
 *   pnpm setup:multi-agent
 *
 * 跑完后：
 *   - .env 里有 8 行新变量（A 和 B 各 4 个）
 *   - 链上 SoulNFT.totalMinted 涨 2
 *   - 2 个新 EOA 各持 1 USDC
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../.env");

loadEnv({ path: ENV_PATH });
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
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.ARC_TESTNET_RPC_URL!;
const USDC = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SOUL_NFT = process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS as Address;
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;

if (!RPC || !USDC || !SOUL_NFT || !DEPLOYER_KEY) {
  console.error("❌ 缺关键 env：ARC_TESTNET_RPC_URL / NEXT_PUBLIC_USDC_ADDRESS / NEXT_PUBLIC_SOUL_NFT_ADDRESS / DEPLOYER_PRIVATE_KEY");
  process.exit(1);
}

const arcChain = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const usdcAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const soulNftAbi = [
  {
    type: "function",
    name: "publicMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentName", type: "string" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tba", type: "address" },
    ],
  },
  {
    type: "event",
    name: "SoulMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "tba", type: "address", indexed: false },
      { name: "agentName", type: "string", indexed: false },
    ],
  },
] as const;

interface Agent {
  envPrefix: string; // EOA_RESEARCH_BOT / EOA_WEB3_AUDITOR
  displayName: string;
  agentName: string; // 上链 SoulNFT 的 name
  metadataURI: string;
}

const AGENTS: Agent[] = [
  {
    envPrefix: "EOA_RESEARCH_BOT",
    displayName: "Research-Bot",
    agentName: "Research-Bot",
    metadataURI: "ipfs://pneuma-demo/research-bot.json",
  },
  {
    envPrefix: "EOA_WEB3_AUDITOR",
    displayName: "Web3-Auditor",
    agentName: "Web3-Auditor",
    metadataURI: "ipfs://pneuma-demo/web3-auditor.json",
  },
];

const FUND_AMOUNT_USDC = 1n; // 1 USDC per agent

// ────────────────────────────────────────────────────────────────────────
// 简单 .env 写回（不依赖 dotenv writer，避免新依赖）
// ────────────────────────────────────────────────────────────────────────

function upsertEnv(updates: Record<string, string>) {
  let content = "";
  try {
    content = readFileSync(ENV_PATH, "utf-8");
  } catch {
    /* 不存在就新建 */
  }
  const lines = content.split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && updates[m[1]] !== undefined) {
      out.push(`${m[1]}=${updates[m[1]]}`);
      seen.add(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  writeFileSync(ENV_PATH, out.join("\n"));
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const publicClient = createPublicClient({ chain: arcChain, transport: http(RPC) });
  const deployerWallet = createWalletClient({ account: deployer, chain: arcChain, transport: http(RPC) });

  console.log(`\n🛠  setup-multi-agent`);
  console.log(`   deployer: ${deployer.address}\n`);

  const envUpdates: Record<string, string> = {};

  for (const a of AGENTS) {
    console.log(`──── ${a.displayName} ────`);

    // 1) Private key —— .env 已有就复用，没有就生成
    const keyEnv = `${a.envPrefix}_PRIVATE_KEY`;
    let pk = process.env[keyEnv] as Hex | undefined;
    if (!pk || !pk.startsWith("0x") || pk.length !== 66) {
      pk = generatePrivateKey();
      envUpdates[keyEnv] = pk;
      console.log(`  ✓ 生成新 private key`);
    } else {
      console.log(`  ✓ 复用已有 private key`);
    }
    const account = privateKeyToAccount(pk);
    envUpdates[`${a.envPrefix}_ADDRESS`] = account.address;
    console.log(`    address: ${account.address}`);

    // 2) 注资 1 USDC（Arc Testnet 上 USDC 同时当 gas）
    const bal = (await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    const needed = parseUnits(FUND_AMOUNT_USDC.toString(), 6);
    if (bal < needed) {
      const transferAmount = needed - bal;
      console.log(`  ⏳ 转账 ${Number(transferAmount) / 1e6} USDC (current bal ${Number(bal) / 1e6})…`);
      const tx = await deployerWallet.writeContract({
        address: USDC,
        abi: usdcAbi,
        functionName: "transfer",
        args: [account.address, transferAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`     ✓ ${tx}`);
    } else {
      console.log(`  ✓ 已有 ${Number(bal) / 1e6} USDC，跳过注资`);
    }

    // 3) Mint Soul（如果 .env 已记 SOUL_TOKEN_ID 就跳过）
    const tokenIdEnv = `${a.envPrefix}_SOUL_TOKEN_ID`;
    const existing = process.env[tokenIdEnv];
    if (existing && existing !== "0") {
      console.log(`  ✓ 已有 Soul tokenId=${existing}，跳过 mint`);
      // TBA 也已经在 env 里了（如果之前正常跑过）
    } else {
      console.log(`  ⏳ mint Soul name="${a.agentName}"…`);
      const agentWallet = createWalletClient({ account, chain: arcChain, transport: http(RPC) });
      const tx = await agentWallet.writeContract({
        address: SOUL_NFT,
        abi: soulNftAbi,
        functionName: "publicMint",
        args: [a.agentName, a.metadataURI],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const events = parseEventLogs({
        abi: soulNftAbi,
        logs: receipt.logs,
        eventName: "SoulMinted",
      });
      const e = events[0];
      if (!e) {
        console.error(`  ✗ SoulMinted event 未找到 (tx=${tx})`);
        continue;
      }
      const { tokenId, tba } = e.args;
      console.log(`     ✓ tokenId=${tokenId} tba=${tba} (tx=${tx})`);
      envUpdates[tokenIdEnv] = tokenId.toString();
      envUpdates[`${a.envPrefix}_SOUL_TBA`] = tba;
    }
    console.log("");
  }

  if (Object.keys(envUpdates).length > 0) {
    upsertEnv(envUpdates);
    console.log(`📝 写回 .env: ${Object.keys(envUpdates).length} 个新变量\n`);
  }

  console.log(`────────────────────────────────────────────────`);
  console.log(`✅ 多 agent setup 完成。下一步：`);
  console.log(`   pnpm register:multi-agent  # 用各 agent owner 注册自己 skill`);
  console.log(`────────────────────────────────────────────────\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
