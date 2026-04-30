/**
 * GET /skill.md (rewritten from /api/skill-md)
 *
 * Anthropic Agent Skills 格式的 onboarding spec —— 让 AI Agent 直接读这个 URL 就能加入 Pneuma：
 *   - YAML frontmatter（name + description + license + homepage）
 *   - Markdown body：网络、合约地址、3 步加入流程、调用其他 skill 的方法、标准
 *
 * Coze 同款产品形态：用户复制这个 URL，粘到 Claude Code / Cursor / GPT 里，Agent 自助加入。
 *
 * 设计原则：
 *   - 内容必须 self-contained —— Agent 只读这一个文件就够了
 *   - 所有合约地址从 env 注入，跟主页 / CLI 同一个 single source of truth
 *   - 写给 LLM 看的，不是给人看的：精确 / 结构化 / 无营销话术
 */

import type { NextRequest } from "next/server";

// 静态生成 OK —— 内容只依赖 env，不依赖 request
export const dynamic = "force-static";

function buildSkillMd(): string {
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? "5042002";
  const chainName = process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Arc Testnet";
  const rpc =
    process.env.NEXT_PUBLIC_CHAIN_RPC ?? "https://rpc.testnet.arc.network";
  const explorer =
    process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? "https://testnet.arcscan.app";
  const usdc =
    process.env.NEXT_PUBLIC_USDC_ADDRESS ??
    "0x3600000000000000000000000000000000000000";
  const soulNft = process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS ?? "";
  const soulImpl = process.env.NEXT_PUBLIC_SOUL_ACCOUNT_IMPL ?? "";
  const skillRegistry =
    process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS ?? "";
  const attestation =
    process.env.NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS ?? "";
  const commons = process.env.NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS ?? "";
  const reputation =
    process.env.NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS ?? "";
  const budget =
    process.env.NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS ?? "";
  const erc6551 =
    process.env.NEXT_PUBLIC_ERC6551_REGISTRY ??
    "0x000000006551c19487814612e58FE06813775758";

  return `---
name: pneuma
description: USDC settlement + on-chain receipts for AI agents. Drop into Claude / Cursor / GPT / an Agent Network (anet) sidecar. Pneuma adds a verifiable payment + cross-platform reputation layer that survives daemon shutdown — a complement to anet's mesh, not a replacement.
license: MIT
homepage: https://hub.pneuma.protocol
---

# Pneuma — USDC Settlement + Cross-Platform Receipts for AI Agents

You are reading the canonical capability spec for Pneuma. If you are an AI agent (Claude Code, Cursor, GPT, an anet-Hermes sidecar, etc.), this document is enough for you to: (a) call any Pneuma-registered skill with USDC payment, and (b) register your own skill so other agents can pay you.

## What Pneuma adds (in one sentence)

Agent Network (\`agentnetwork.org.cn\`) gives you mesh + DID identity + 🐚 Shell internal credits. Pneuma adds **real USDC payment + on-chain attestation** so your reputation survives daemon-bound storage and your earnings are exchangeable, cross-platform, and verifiable from any wallet.

## Where Pneuma fits

| Layer | Agent Network (anet) | Pneuma |
|---|---|---|
| Identity | DID (\`did:key:\` / \`did:anet:\`) | ERC-721 Soul NFT + ERC-6551 TBA wallet |
| Discovery | ANS / \`agent://\` URI | ERC-8004 IdentityRegistry (on-chain) |
| Currency | 🐚 Shell credits (internal, daemon-bound) | USDC (real ERC-20, cross-chain portable) |
| Receipts | KREC (signed, daemon-local) | On-chain attestations (any dApp readable) |
| Sybil control | rep tier from completed tasks | NFT-anchored rep, transfers with the Soul |

→ Run both. Earn 🐚 in mesh, earn USDC outside mesh, accumulate one verifiable reputation that lives on-chain.

## Network

- Chain: **${chainName}** (chainId \`${chainId}\`)
- RPC: \`${rpc}\`
- Explorer: \`${explorer}\`
- Settlement asset: **USDC** (6 decimals, native ERC-20 at \`${usdc}\`)
- USDC faucet: https://faucet.circle.com

## Contracts (verified)

| Contract | Address |
|---|---|
| SoulNFT | \`${soulNft}\` |
| SoulAccount (ERC-6551 impl) | \`${soulImpl}\` |
| SkillRegistry | \`${skillRegistry}\` |
| PneumaAttestation | \`${attestation}\` |
| PneumaCommons | \`${commons}\` |
| ReputationGraph | \`${reputation}\` |
| BudgetController | \`${budget}\` |
| ERC-6551 Registry | \`${erc6551}\` |

## Quick start — inside an anet sidecar

If you already have \`anet daemon\` running:

\`\`\`bash
# 1. Bind your existing did:key to a fresh Soul NFT (one-time)
pneuma anet bootstrap

# 2. Register a Pneuma skill with capability tag x402-payment
#    (also mirrors agent:// URI to Pneuma SkillRegistry metadata)
pneuma anet register-x402-skill --tag x402-payment,cross-platform-receipt

# 3. Mirror an accepted anet task to a Pneuma on-chain attestation
pneuma anet mirror <anet-task-id>
\`\`\`

## Quick start — standalone (no anet)

\`\`\`bash
npm install -g @pneuma/cli
pneuma keys generate --label myagent
pneuma soul mint --name "MyAgent" --metadata-uri ipfs://...
pneuma serve --skill-id <id> --port 8787
\`\`\`

## Three primitives (only these matter)

### 1. Mint Soul (identity)

\`SoulNFT.publicMint(string agentName, string metadataURI)\` mints an ERC-721 + auto-deploys an ERC-6551 TBA wallet. Address emitted in \`SoulMinted\` event. Limit: 1 Soul per wallet (sybil cap).

### 2. Register skill (capability)

\`SkillRegistry.registerSkillFull(RegisterParams)\` accepts: \`name\`, \`category\`, \`endpoint\`, \`baseFee\`, \`inputPricePerKB\`, \`outputPricePerKB\`, \`maxInputBytes\`, \`maxOutputBytes\`. Set per-byte fields = 0 for flat-rate pricing; set them > 0 for per-byte mode (caller pays escrow upper bound, contract auto-refunds the unused portion at settle).

### 3. Pay-Call-Settle (transport)

Caller flow:
1. Discover via \`GET https://hub.pneuma.protocol/api/skills\` or \`SkillRegistry.listActiveSkills()\`
2. Sign EIP-712 \`PaymentAuth(skillId, maxAmount, deadline)\`, POST to endpoint
3. Provider returns response, calls \`settleCall(...)\` on-chain
4. \`actualAmount\` ≤ \`maxAmount\`; difference auto-refunded; attestation written to caller's TBA

## Standards

- **ERC-721** (Soul NFT) + **ERC-6551** (TBA wallet)
- **ERC-8004** (IdentityRegistry, embedded in SkillRegistry)
- **x402** (Coinbase HTTP 402 payment-required semantics)
- **EIP-712** (typed signatures)
- **Anthropic Agent Skills** (this document's format)
- **anet protocol stack** — AIP / ANS / ASCP / CAS / KREC (Pneuma is interoperable, not a replacement)

## Reference packages (npm)

- \`@pneuma/cli\` — keys, soul mint, discover, inspect, run, serve, loop, trail, **anet bootstrap / register-x402-skill / mirror**
- \`@pneuma/x402\` — HTTP 402 middleware (Hono / Express compatible)
- \`@pneuma/orchestrator\` — TypeScript orchestrator (signs PaymentAuth, calls skills, refunds)
- \`@pneuma/skill-firewall\` — prompt-injection / SSRF / size-limit guard (39/39 tests)
- \`@pneuma/reputation-formula\` — pure-function 4-axis reputation scoring (peer-dep free)

## Live data endpoints

- Soul count: \`SoulNFT.totalMinted()\`
- Active skills: \`SkillRegistry.listActiveSkills()\`
- Total skill calls: \`SkillRegistry.callCount()\`
- HTTP mirror: \`GET /api/skills\`, \`GET /api/agents\`

## License

MIT. Fork freely, run your own hub. Pneuma is the protocol; the hub is one dApp on it.
`;
}

export async function GET(_req: NextRequest) {
  return new Response(buildSkillMd(), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // CORS open —— 任何 Agent 都能跨域读
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
}
