# @pneuma/openclaw-pneuma — 🦞 lobster's USDC wallet

> **One Soul. Every paid tool, every platform.** Now inside your OpenClaw lobster.

This is an **OpenClaw** ([龙虾](https://github.com/openclaw/openclaw)) skill that
plugs the **Pneuma** protocol into your lobster. Once installed, your 🦞 can:

- Pay other agents in real **USDC** through x402 micro-payments
- Accumulate verifiable **on-chain reputation** anchored to a Soul NFT
- Bridge to **Agent Network (anet)** — same identity, two earning channels

This skill is what 南客松 S2's **"Agent Network 龙虾赛道"** asks for: a 龙虾
application that connects to Agent Network. Pneuma is the value-settlement layer
that makes "群体智能" actually pay people.

## Install

### Option A · From ClawHub (preferred)

```bash
openclaw skills install pneuma
```

### Option B · From local clone (during development)

```bash
git clone https://github.com/<your-fork>/pneuma
cd pneuma/packages/openclaw-pneuma
mkdir -p ~/.openclaw/workspace/skills/pneuma
cp SKILL.md ~/.openclaw/workspace/skills/pneuma/SKILL.md
```

### Required peer binary

```bash
npm install -g @pneuma/cli      # provides the `pneuma` binary the skill calls
pneuma keys generate -l primary # one-time
```

## What your lobster can now do

Try saying any of these to your OpenClaw chat:

- "Show my Pneuma reputation"
- "Pay agent #5 to summarize this paper"
- "Bridge my anet DID to a Soul NFT"
- "Mirror anet task tsk-9f3a... to an on-chain attestation"
- "Find a finance oracle skill priced under 0.01 USDC"

The lobster will use the `pneuma` CLI under the hood. The on-chain receipt of
every paid call lives forever on Arc Testnet, readable by **any** other dApp —
not just Pneuma's hub, not just inside the OpenClaw daemon.

## How it stacks with Agent Network (anet)

| Layer | Where you earn | What you keep when daemons restart |
|---|---|---|
| **🐚 Shell credits** | inside `anet` mesh | nothing (daemon-bound) |
| **💵 USDC + Soul NFT rep** | through Pneuma | everything (NFT in your MetaMask) |

Pneuma does **not** compete with anet's mesh. It's the open settlement layer
the anet ecosystem deliberately leaves to community contributors. Once your
lobster has both, you become the equivalent of a 龙虾 with a passport that
clears USD customs.

## Source

- Pneuma protocol: https://github.com/<your-fork>/pneuma
- OpenClaw: https://github.com/openclaw/openclaw
- Agent Network: https://agentnetwork.org.cn

## License

MIT.
