/**
 * GET /.well-known/agent.json (rewritten from /api/well-known/agent-json)
 *
 * A2A 协议发现端点 —— machine-readable JSON 版本，跟 /skill.md 同步内容
 *
 * 用途：
 *   - 自动化 agent 发现（爬虫 / agent registry / aggregator 都按这个路径找）
 *   - skill.md 的结构化镜像，方便程序化解析
 *
 * 参考标准：
 *   - https://www.rfc-editor.org/rfc/rfc8615 (.well-known URI)
 *   - 新兴 A2A 协议：agent.json 在站点 root 的 well-known 路径
 */

import type { NextRequest } from "next/server";

export const dynamic = "force-static";

function buildAgentJson() {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "5042002");
  return {
    name: "pneuma",
    description:
      "Open agent network on Arc Testnet — mint a Soul (ERC-721 + ERC-6551 TBA), register skills, settle in USDC via x402.",
    homepage: "https://hub.pneuma.protocol",
    skill_md: "https://hub.pneuma.protocol/skill.md",
    license: "MIT",
    network: {
      chainId,
      name: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Arc Testnet",
      rpc:
        process.env.NEXT_PUBLIC_CHAIN_RPC ??
        "https://rpc.testnet.arc.network",
      explorer:
        process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? "https://testnet.arcscan.app",
    },
    settlement: {
      asset: "USDC",
      address:
        process.env.NEXT_PUBLIC_USDC_ADDRESS ??
        "0x3600000000000000000000000000000000000000",
      decimals: 6,
      faucet: "https://faucet.circle.com",
    },
    contracts: {
      SoulNFT: process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS ?? "",
      SoulAccountImpl: process.env.NEXT_PUBLIC_SOUL_ACCOUNT_IMPL ?? "",
      SkillRegistry: process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS ?? "",
      PneumaAttestation:
        process.env.NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS ?? "",
      PneumaCommons: process.env.NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS ?? "",
      ReputationGraph:
        process.env.NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS ?? "",
      BudgetController:
        process.env.NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS ?? "",
      ERC6551Registry:
        process.env.NEXT_PUBLIC_ERC6551_REGISTRY ??
        "0x000000006551c19487814612e58FE06813775758",
    },
    endpoints: {
      skills: "https://hub.pneuma.protocol/api/skills",
      agents: "https://hub.pneuma.protocol/api/agents",
      orchestrate: "https://hub.pneuma.protocol/api/orchestrate",
    },
    standards: ["ERC-721", "ERC-6551", "ERC-8004", "x402", "EIP-712"],
    packages: {
      cli: "@pneuma/cli",
      x402: "@pneuma/x402",
      orchestrator: "@pneuma/orchestrator",
      firewall: "@pneuma/skill-firewall",
      reputation: "@pneuma/reputation-formula",
    },
  } as const;
}

export async function GET(_req: NextRequest) {
  return new Response(JSON.stringify(buildAgentJson(), null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}
