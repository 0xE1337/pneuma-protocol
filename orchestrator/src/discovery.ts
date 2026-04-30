/**
 * 链上 skill 发现 —— 直接读 SkillRegistry，不通过任何中心化 catalog
 *
 * 提供两个入口：
 *   - discoverSkills()       —— 旧入口，纯 SkillRegistry 读取，向后兼容
 *   - discoverSkillsRanked() —— 新入口，叠加 PneumaAttestation 声誉数据并排序
 *                              high-rep（成熟）skill 在前，cold-start（新人）skill 平铺到末尾
 *                              确保新 skill 仍有曝光机会
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { SkillRegistryAbi } from "@pneuma/x402";
import { fetchReputations, type ReputationScore } from "./reputation.js";

export interface DiscoveredSkill {
  skillId: number;
  owner: Address;
  name: string;
  description: string;
  endpoint: string;
  category: string;
  pricePerCallUsdc: string; // 6 decimals string (USDC = 1e6 per dollar)
  totalCalls: number;
}

/** 带声誉信息的 skill —— discoverSkillsRanked() 返回 */
export interface RankedSkill extends DiscoveredSkill {
  reputation: ReputationScore;
}

const ListAbi = [
  ...SkillRegistryAbi,
  {
    type: "function",
    name: "listActiveSkills",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "skillId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "endpoint", type: "string" },
          { name: "category", type: "string" },
          { name: "pricePerCall", type: "uint256" },
          { name: "totalCalls", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export async function discoverSkills(
  rpcUrl: string,
  skillRegistry: Address,
): Promise<DiscoveredSkill[]> {
  const publicClient = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;

  const raw = await publicClient.readContract({
    address: skillRegistry,
    abi: ListAbi,
    functionName: "listActiveSkills",
  });

  return raw.map((s) => ({
    skillId: Number(s.skillId),
    owner: s.owner,
    name: s.name,
    description: s.description,
    endpoint: s.endpoint,
    category: s.category,
    pricePerCallUsdc: s.pricePerCall.toString(),
    totalCalls: Number(s.totalCalls),
  }));
}

/**
 * 带声誉排序的 skill 发现
 *
 * 排序规则（两段式）：
 *   1. mature skills（validCount >= COLD_START_THRESHOLD）按 reputation.score 降序
 *   2. cold-start skills（validCount < threshold）平铺到列表末尾，保持注册顺序
 *
 * 这样保证：
 *   - LLM planner 看到的 skill 列表里高声誉的在前，自然倾向选老兵
 *   - 但新人 skill 仍在列表里可见，没被一刀切，配合冷启动豁免逻辑
 *   - 同 category 的多个 skill，LLM 拿到声誉差异后可做"同类选最优"决策
 *
 * @param rpcUrl                Arc Testnet RPC
 * @param skillRegistry         SkillRegistry 合约地址
 * @param pneumaAttestation     PneumaAttestation 合约地址（NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS）
 */
export async function discoverSkillsRanked(
  rpcUrl: string,
  skillRegistry: Address,
  pneumaAttestation: Address,
): Promise<RankedSkill[]> {
  const skills = await discoverSkills(rpcUrl, skillRegistry);
  if (skills.length === 0) return [];

  // 拉所有 owner 的声誉数据（去重避免重复读链）
  const uniqueOwners = Array.from(new Set(skills.map((s) => s.owner))) as Address[];
  const repMap = await fetchReputations(rpcUrl, pneumaAttestation, uniqueOwners);

  const ranked: RankedSkill[] = skills.map((s) => ({
    ...s,
    reputation:
      repMap.get(s.owner) ?? {
        score: 0,
        validCount: 0,
        totalVolumeWei: 0n,
        idleDays: 0,
        avgRatingByCaller: 0,
        isColdStart: true,
        recentComments: [],
      },
  }));

  // 两段式排序
  const mature = ranked
    .filter((s) => !s.reputation.isColdStart)
    .sort((a, b) => b.reputation.score - a.reputation.score);
  const cold = ranked.filter((s) => s.reputation.isColdStart);

  return [...mature, ...cold];
}
