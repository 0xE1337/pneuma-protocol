/**
 * Orchestrator HTTP bridge — 把前端的 query 转给 orchestrator 包跑完整流程
 *
 * 注意：使用了 server-side DEPLOYER_PRIVATE_KEY 来发交易（demo 简化）。
 * 生产场景应该让用户钱包直接调，这里是为了快速演示。
 */

import { NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { discoverSkills } from "@pneuma/orchestrator/discovery";
import { plan } from "@pneuma/orchestrator/planner";
import { Executor } from "@pneuma/orchestrator/executor";
import { aggregate } from "@pneuma/orchestrator/aggregator";

const RPC = process.env.ARC_TESTNET_RPC_URL!;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);
const USDC_TOKEN = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      query: string;
      tokenId?: number;
      /** 只跑 planner，不上链 execute —— Discover 用这个 */
      planOnly?: boolean;
    };
    const { query, tokenId, planOnly = false } = body;
    if (!query) {
      return NextResponse.json({ error: "missing query" }, { status: 400 });
    }

    const publicClient = createPublicClient({ transport: http(RPC) });

    // planOnly 模式不需要 callerTBA（不上链）；省一次 RPC
    const callerTBA = planOnly
      ? null
      : await publicClient.readContract({
          address: SOUL_NFT,
          abi: SoulNFTAbi,
          functionName: "tbaOf",
          args: [BigInt(tokenId ?? 1)],
        });

    const skills = await discoverSkills(RPC, SKILL_REGISTRY);
    const planResult = await plan(query, skills);

    if (planOnly) {
      // 把每步 enrich 上 skill 元信息（name + price），让前端渲染漂亮 plan card
      // DiscoveredSkill.pricePerCallUsdc 已经是 6-decimals string（USDC raw 单位），
      // 前端再除以 1e6 转人类可读 USDC
      const stepsEnriched = planResult.steps.map((step) => {
        const skill = skills.find((s) => s.skillId === step.skillId);
        return {
          ...step,
          skillName: skill?.name ?? `#${step.skillId}`,
          pricePerCall: skill?.pricePerCallUsdc ?? "0",
        };
      });
      return NextResponse.json({
        query,
        plan: { ...planResult, steps: stepsEnriched },
        planOnly: true,
      });
    }

    const executor = new Executor({
      rpcUrl: RPC,
      chainId: CHAIN_ID,
      paymentToken: USDC_TOKEN,
      skillRegistry: SKILL_REGISTRY,
      privateKey: PRIVATE_KEY,
      callerTBA: callerTBA as Address,
    });

    const results = await executor.executeParallel(planResult.steps, skills);
    const finalAnswer = await aggregate(query, results);

    return NextResponse.json({
      query,
      callerTBA,
      plan: planResult,
      results: results.map((r) => ({
        skillId: r.skill.skillId,
        skillName: r.skill.name,
        success: r.success,
        data: r.data ?? null,
        error: r.error ?? null,
        callId: r.callId,
        paidAmount: r.paidAmount?.toString(),
        escrowTxHash: r.escrowTxHash,
        durationMs: r.durationMs,
      })),
      answer: finalAnswer,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
