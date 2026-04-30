/**
 * Pneuma 全链路 smoke test
 *
 * 验证 D2 闭环：
 *   1. PneumaClient 调 service-finance（自动 escrow + retry）
 *   2. 服务端 settle 触发 attestation
 *   3. 链上读 PneumaAttestation 看到该 Soul 的履历
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env.local") });

import { PneumaClient } from "@pneuma/x402/client";
import { createPublicClient, http, type Address, type Hex } from "viem";

const RPC = process.env.ARC_TESTNET_RPC_URL!;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);
const USDC_TOKEN = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const ATTESTATION = process.env.NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS as Address;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const SOUL_NFT = process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS as Address;

// DEPLOYER 的 Soul tokenId 是 1，对应 TBA 在前面 mint 时已生成
// 直接通过 SoulNFT.tbaOf() 链上查
const SoulNFTAbi = [
  {
    type: "function",
    name: "tbaOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const PneumaAttestationAbi = [
  {
    type: "function",
    name: "countByRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAttestationsByRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "skillId", type: "uint256" },
          { name: "paymentHash", type: "bytes32" },
          { name: "rating", type: "uint8" },
          { name: "paidAmount", type: "uint256" },
          { name: "skillName", type: "string" },
          { name: "skillCategory", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "revoked", type: "bool" },
        ],
      },
    ],
  },
] as const;

async function main() {
  console.log("=== Pneuma Smoke Test ===\n");

  const publicClient = createPublicClient({ transport: http(RPC) });

  // 读 DEPLOYER 的 Soul TBA
  const callerTBA = await publicClient.readContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "tbaOf",
    args: [1n],
  });
  console.log(`Soul tokenId 1 → TBA: ${callerTBA}`);

  // 部署前的 attestation count
  const beforeCount = await publicClient.readContract({
    address: ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "countByRecipient",
    args: [callerTBA],
  });
  console.log(`Attestations BEFORE call: ${beforeCount}\n`);

  // 创建 PneumaClient
  const client = new PneumaClient({
    rpcUrl: RPC,
    chainId: CHAIN_ID,
    paymentToken: USDC_TOKEN,
    skillRegistry: SKILL_REGISTRY,
    privateKey: PRIVATE_KEY,
  });
  console.log(`Client wallet: ${client.address}\n`);

  // 调用 finance service
  console.log("→ Calling service-finance via x402...");
  const result = await client.callSkill<{ symbol: string; priceUSD: number; timestamp: number; callId: string }>({
    endpoint: "http://localhost:3001/api/price",
    callerTBA,
    body: { symbol: "ETH" },
  });

  console.log("\n=== HTTP Response ===");
  console.log(`  symbol:    ${result.data.symbol}`);
  console.log(`  priceUSD:  ${result.data.priceUSD}`);
  console.log(`  callId:    ${result.callId}`);
  console.log(`  paidAmount: ${result.paidAmount} (${Number(result.paidAmount) / 1e6} USDC)`);
  console.log(`  escrow tx: ${result.escrowTxHash}`);

  // 等服务端 settle 完成（异步触发的）
  console.log("\n→ Waiting 5s for server settle to confirm on-chain...");
  await new Promise((r) => setTimeout(r, 5000));

  const afterCount = await publicClient.readContract({
    address: ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "countByRecipient",
    args: [callerTBA],
  });
  console.log(`Attestations AFTER call: ${afterCount}`);

  if (afterCount > beforeCount) {
    console.log(`\n✅ Attestation written on-chain (${afterCount - beforeCount} new)`);

    const attestations = await publicClient.readContract({
      address: ATTESTATION,
      abi: PneumaAttestationAbi,
      functionName: "getAttestationsByRecipient",
      args: [callerTBA],
    });
    const last = attestations[attestations.length - 1];
    console.log(`\n=== Latest attestation ===`);
    console.log(`  skillName:  ${last.skillName}`);
    console.log(`  category:   ${last.skillCategory}`);
    console.log(`  rating:     ${last.rating}`);
    console.log(`  paidAmount: ${Number(last.paidAmount) / 1e6} USDC`);
    console.log(`  attester:   ${last.attester} (= SkillRegistry)`);
    console.log(`  uid:        ${last.uid}`);
    console.log(`  paymentHash: ${last.paymentHash}`);
  } else {
    console.log(`\n❌ No new attestation. Settle may have failed. Check finance service logs.`);
    process.exit(1);
  }

  console.log("\n=== ✅ D2 Smoke Test PASSED ===");
}

main().catch((err) => {
  console.error("\n❌ smoke test failed:", err);
  process.exit(1);
});
