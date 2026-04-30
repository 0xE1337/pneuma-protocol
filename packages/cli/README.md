# @pneuma/cli

> **One Soul. Every paid tool, every platform.**

Pneuma command-line interface. Designed to be invoked by AI agents
(Claude Code, Cursor, Cline, etc.) via the `pneuma.ai/pneuma-cli-skill.md` install
path — but works fine standalone.

> Note: the canonical protocol-onboarding manifest is **`/skill.md`** (Coze-style,
> for any agent joining the Pneuma network). The CLI's tool skill is at
> `/pneuma-cli-skill.md` (Anthropic Agent Skills format, for AI coding tools).

## Install

```bash
npm install -g @pneuma/cli
```

## Quickstart

```bash
# 1. Configure
cp ../../.env.local.example ../../.env.local   # fill in deployed addresses
pneuma keys add -l main -k 0x<your-throwaway-private-key>

# 2. Mint a Soul (ERC-721 identity + ERC-6551 TBA wallet)
pneuma soul mint --name "demo-agent"

# 3. Send USDC to the TBA address shown above (Arc Testnet)

# 4. Browse the on-chain skill catalog
pneuma discover -q "twitter"

# 5. Inspect a skill before paying
pneuma inspect -s 17

# 6. Check balances + spending receipts
pneuma balance
pneuma trail
```

## Commands

| Command | What it does |
|---|---|
| `pneuma --version` | Print CLI version |
| `pneuma keys add/list/activate/remove` | Local wallet keystore (`~/.pneuma/keys.json`, mode 0600) |
| `pneuma soul mint` | Mint Soul NFT, derive TBA |
| `pneuma soul status` | Identity + USDC balance + reputation summary |
| `pneuma discover` | Search SkillRegistry on-chain (filter by query / category / min reputation) |
| `pneuma inspect` | Full skill detail: price, SLA, provider stake, slash % |
| `pneuma balance` | USDC balance for both wallet and TBA |
| `pneuma trail` | Time-sorted on-chain attestation receipts |
| `pneuma run` *(stub)* | Will escrow + call + settle once `@pneuma/x402` finishes USDC migration |
| `pneuma claim-timeout` *(stub)* | Trigger SLA-timeout slash on stuck calls |

## Why this exists (vs. competitors like Monid)

| | Monid | Pneuma CLI |
|---|---|---|
| Identity | API key in centralized DB | ERC-721 Soul + ERC-6551 TBA |
| Receipts | Internal log | **On-chain attestations** any dApp can read |
| Trust model | Trust the platform | Trustless escrow + slash |
| Cross-platform | ❌ (lock-in) | ✅ (your Soul moves with you) |
| Token | None | None — pure USDC on Arc |

The CLI is the **distribution wedge** — one-liner install path mirroring
Monid's `monid.ai/SKILL.md`, but each command settles on an open protocol you own.

## Development

```bash
pnpm dev -- --version             # run via tsx
pnpm build                         # emit dist/
node dist/cli.js soul status       # run compiled
```

## Environment variables

Reads from `<repo>/.env.local`:

- `ARC_TESTNET_RPC_URL` (default: `https://rpc.testnet.arc.network`)
- `NEXT_PUBLIC_CHAIN_ID` (default: `5042002`)
- `NEXT_PUBLIC_CHAIN_EXPLORER` (default: `https://testnet.arcscan.app`)
- `NEXT_PUBLIC_USDC_ADDRESS` *(required)*
- `NEXT_PUBLIC_SOUL_NFT_ADDRESS` *(required)*
- `NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS` *(required)*
- `NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS` *(required)*
- `NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS` *(optional)*

`NO_COLOR=1` disables ANSI codes for scripted/agent use.
