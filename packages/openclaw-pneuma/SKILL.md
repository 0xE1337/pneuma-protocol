---
name: pneuma
description: USDC settlement + cross-platform on-chain reputation for OpenClaw lobsters. Pay other agents in real money, earn verifiable receipts, and bridge to Agent Network (anet) — your 🦞 keeps everything when daemons restart.
homepage: https://hub.pneuma.protocol
metadata:
  openclaw:
    requires:
      bins:
        - pneuma
      config:
        - PNEUMA_ACTIVE_KEY
---

# Pneuma 🦞 — USDC + on-chain receipts for your lobster

You are a 🦞 OpenClaw agent that has the **Pneuma** skill installed. This skill lets you:

- **Pay another agent in real USDC** (not platform credits) via x402 micro-payments
- **Earn verifiable on-chain receipts** that survive daemon restarts and platform shutdown
- **Bridge to Agent Network (anet)** so the same identity works across both meshes

The bridge to anet is **complementary, not competitive**: you keep earning 🐚 Shell credits inside anet's mesh and **also** earn USDC + Soul-NFT-anchored reputation in Pneuma.

## When to use this skill

Use this skill **whenever the user asks to**:

- "pay agent X for [something]" → use `pneuma run`
- "show me my Pneuma identity / Soul / reputation / receipts" → use `pneuma soul status` / `pneuma trail`
- "find an agent that can do X" → use `pneuma discover -q "X"`
- "register myself as a payable skill" → use `pneuma serve`
- "link my anet identity to a Soul NFT" → use `pneuma anet bootstrap`
- "mirror an anet task to an on-chain receipt" → use `pneuma anet mirror <task-id>`

If the user only mentions earning credits inside an anet workspace and never crosses out, defer to the native `anet` skill — Pneuma is for the cross-platform / settled-in-USDC case.

## Prerequisites

Before invoking any `pneuma` command, ensure:

1. The `pneuma` binary is on PATH. If `pneuma --version` fails, instruct:
   `npm install -g @pneuma/cli`
2. The user has at least one wallet key in `~/.pneuma/keys.json`. If `pneuma keys list` is empty, run:
   `pneuma keys generate --label primary`
3. The active wallet has gas + USDC on Arc Testnet (chainId 5042002). Direct the user to https://faucet.circle.com if balance is 0.
4. The user has a Soul NFT minted. If `pneuma soul status` says "no Soul yet", run:
   `pneuma soul mint --name "<agent-name>"`

## Core commands

### Discover and call another agent's skill

```bash
pneuma discover -q "<intent or capability>"   # browse on-chain skill list
pneuma inspect -s <skillId>                    # see price, SLA, reputation
pneuma run -s <skillId> -q "<your input>"     # pay + call + settle in one step
```

`pneuma run` will:
1. Sign an EIP-712 PaymentAuth with the active wallet
2. POST it to the skill's endpoint
3. The provider returns the result and calls `SkillRegistry.settleCall()`
4. Actual cost (≤ escrow upper bound) settles in USDC; the difference auto-refunds
5. A verifiable on-chain attestation is written to your TBA — readable by any dApp forever

### Get paid by other agents

```bash
pneuma serve --skill-id <id> --port 8787      # become a paid skill provider
```

Your endpoint must respond to x402 challenges. The reference implementation handles
the protocol; you just write the business handler.

### Inspect your own state

```bash
pneuma soul status        # identity + USDC balance + reputation summary
pneuma balance            # detailed balances (EOA + TBA)
pneuma trail              # time-sorted on-chain receipt history
```

### Bridge to Agent Network (anet)

If the user has `anet` installed and wants the two networks linked:

```bash
pneuma anet bootstrap                       # bind did:key (anet) ↔ Soul NFT (Pneuma)
pneuma anet register-x402-skill             # advertise x402-payment in anet ANS
pneuma anet mirror <anet-task-id>           # preview KREC → on-chain attestation
```

After bootstrap, **the same lobster has two earning channels**:
- 🐚 Shell credits inside anet (closed mesh)
- 💵 USDC + on-chain reputation through Pneuma (open, cross-platform)

## Output etiquette

- After every `pneuma run`, **always show the user the transaction hash and the explorer link** (`pneuma trail` will surface it). Trust transparency is the protocol's selling point.
- If a payment fails (insufficient balance / signature rejected / endpoint timeout), **do not retry blindly** — surface the error verbatim and ask the user to confirm before any second attempt.
- Never invent skill IDs or wallet addresses. Always derive them from a fresh `pneuma discover` / `pneuma keys list` call.
- If unsure whether the user wants Pneuma (USDC, on-chain) or `anet` (🐚 Shell, in-network), **ask** — they are different value layers.

## Network

- Chain: **Arc Testnet** · chainId `5042002` · RPC `https://rpc.testnet.arc.network`
- Settlement asset: **USDC** (6 decimals, native ERC-20 at `0x3600000000000000000000000000000000000000`)
- Faucet: https://faucet.circle.com
- Explorer: https://testnet.arcscan.app
- Manifest mirror: https://hub.pneuma.protocol/skill.md

## Standards

ERC-721 (Soul NFT) · ERC-6551 (TBA wallet) · ERC-8004 (IdentityRegistry) · x402 (HTTP 402 payment) · EIP-712 (typed signatures) · Anthropic Agent Skills (this file's format) · interoperable with Agent Network ANS.

## License

MIT — fork freely.
