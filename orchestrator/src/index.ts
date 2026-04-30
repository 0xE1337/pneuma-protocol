/**
 * Pneuma Orchestrator —— CLI 入口
 *
 * 使用：
 *   pnpm --filter @pneuma/orchestrator start "总结这段文本：xxx 同时查 ETH 价格"
 *
 * 工作流：
 *   1. 链上 SkillRegistry 发现可用 skill
 *   2. LLM 拆解任务 → plan
 *   3. 并行 x402 调用每个 skill（自动 escrow → service 调用 → settle → attest）
 *   4. LLM 聚合结果
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../.env.local") });

import { createPublicClient, http, type Address, type Hex } from "viem";
import { discoverSkills, discoverSkillsRanked } from "./discovery.js";
import { plan } from "./planner.js";
import { Executor } from "./executor.js";
import { aggregate } from "./aggregator.js";

const RPC = process.env.ARC_TESTNET_RPC_URL!;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);
const USDC_TOKEN = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const PNEUMA_ATTESTATION = process.env.NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS as Address | undefined;
const SOUL_NFT = process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS as Address;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;

const SoulNFTAbi = [
  {
    type: "function",
    name: "tbaOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

async function main() {
  const userQuery = process.argv.slice(2).join(" ").trim() || "查一下 ETH 现在多少钱，并总结一句这段：今天天气真好，阳光明媚，鸟语花香。";

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Pneuma Orchestrator");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`📥 用户请求：${userQuery}\n`);

  // 1. 读 caller TBA（demo 用 Soul tokenId 1）
  const publicClient = createPublicClient({ transport: http(RPC) });
  const callerTBA = await publicClient.readContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "tbaOf",
    args: [1n],
  });
  console.log(`🪪 Caller Soul TBA: ${callerTBA}\n`);

  // 2. 链上发现 + 声誉排序
  //    若 PNEUMA_ATTESTATION 已配，走 ranked 路径（高声誉在前 + 冷启动豁免）
  //    若未配，回退旧路径（保持老 demo 可跑）
  const skills = PNEUMA_ATTESTATION
    ? await (async () => {
        console.log("🔍 链上 SkillRegistry 发现 + PneumaAttestation 排序...");
        const ranked = await discoverSkillsRanked(RPC, SKILL_REGISTRY, PNEUMA_ATTESTATION);
        console.log(`   找到 ${ranked.length} 个 active skill（按声誉降序，新人保底）：`);
        ranked.forEach((s: typeof ranked[number]) => {
          const r = s.reputation;
          const tag = r.isColdStart
            ? "🆕 NEW"
            : `⭐ ${r.score.toFixed(1)} (${r.validCount} reviews, caller-avg ${r.avgRatingByCaller.toFixed(1)})`;
          console.log(
            `   - #${s.skillId} ${s.name} (${s.category}, ${Number(s.pricePerCallUsdc) / 1e6} USDC)  ${tag}`,
          );
        });
        return ranked;
      })()
    : await (async () => {
        console.log("🔍 链上 SkillRegistry 发现可用 skill (PNEUMA_ATTESTATION 未配，跳过声誉排序)...");
        const list = await discoverSkills(RPC, SKILL_REGISTRY);
        console.log(`   找到 ${list.length} 个 active skill：`);
        list.forEach((s) =>
          console.log(`   - #${s.skillId} ${s.name} (${s.category}, ${Number(s.pricePerCallUsdc) / 1e6} USDC)`),
        );
        return list;
      })();
  console.log();

  // 3. LLM 拆解
  console.log("🧠 LLM 拆解任务...");
  const planResult = await plan(userQuery, skills);
  console.log(`   ${planResult.reasoning}`);
  console.log(`   计划调用 ${planResult.steps.length} 个 skill`);
  planResult.steps.forEach((step, i) =>
    console.log(`   #${i + 1}: skill ${step.skillId} - ${step.reason}`),
  );
  console.log();

  if (planResult.steps.length === 0) {
    console.log("❌ 计划为空，结束");
    return;
  }

  // 4. 并行 x402 调用
  console.log("⚡ 并行 x402 调用...");
  const executor = new Executor({
    rpcUrl: RPC,
    chainId: CHAIN_ID,
    paymentToken: USDC_TOKEN,
    skillRegistry: SKILL_REGISTRY,
    privateKey: PRIVATE_KEY,
    callerTBA,
  });

  const results = await executor.executeParallel(planResult.steps, skills);
  console.log();

  // 5. LLM 聚合
  console.log("📦 LLM 聚合结果...\n");
  const finalAnswer = await aggregate(userQuery, results);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  💡 最终回答");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(finalAnswer);
  console.log();

  // 6. 链上凭证总结
  const totalUsd = results.reduce((sum, r) => sum + (r.paidAmount ?? 0n), 0n);
  const totalTx = results.filter((r) => r.success).length;
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  🔗 链上凭证");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  成功调用：${totalTx} / ${results.length}`);
  console.log(`  USDC 支付：${Number(totalUsd) / 1e6} USDC`);
  console.log(`  Attestations 已写入 Soul TBA：${callerTBA}`);
  console.log();
  results.filter((r) => r.success).forEach((r, i) => {
    console.log(`  Tx #${i + 1}: ${r.escrowTxHash}`);
    console.log(`         skill="${r.skill.name}", callId=${r.callId}`);
  });
  console.log();
}

main().catch((err) => {
  console.error("\n❌ orchestrator failed:", err);
  process.exit(1);
});
