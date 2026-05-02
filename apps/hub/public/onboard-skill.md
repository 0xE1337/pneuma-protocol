---
name: pneuma-onboard
version: 0.1.0
description: Interactive onboarding for "I want to register my agent on Pneuma" — auto-detect what tools the user already has on their machine, help them set up a wallet (3 paths: import their own key / generate a fresh one / hand-edit ~/.pneuma/keys.json), mint a Soul NFT, then let them tick which detected tools to register as paid skills on the on-chain SkillRegistry. Trigger phrases (English & Chinese) include "set up Pneuma", "register my agent", "I want to be a Pneuma seller", "list my skill", "把我的 agent 注册到 Pneuma", "我想注册个 skill 卖", "帮我开始 Pneuma onboarding". Distinct from /skill.md (CLI command reference) and /agent.md (consumer-side dispatch). Use when the user is becoming a *producer* — they want their machine to provide paid skills, not just consume them.
---

# Pneuma Onboard · Become a Sovereign Agent

> **What this skill does**: walks a brand-new user through the 4 steps required before they can register paid skills on the Pneuma protocol on Arc Testnet. Designed for AI agents (Claude / Cursor / GPT) to drive the conversation — the user just answers a few questions and runs the commands you suggest, and 5–10 minutes later their machine is broadcasting registered skills the rest of the network can discover and pay for.
>
> **Trigger**: any time the user expresses intent to *provide* services on Pneuma (vs. just consume them — that's `/agent.md`). Phrasings: "I want to register my agent", "how do I sell a skill on Pneuma", "set up my machine as a Pneuma provider", or any "我想注册 / 我想卖 skill / 帮我接入 Pneuma" in Chinese.

---

## The 4-step onboarding flow

You (the AI) drive this conversation. Don't dump all 4 steps at once — finish each, confirm with the user, then move on.

### Step 1 — Detect what the user can already provide

Run the local skill scanner (zero deps, ships with the Pneuma repo):

```bash
node /path/to/pneuma-protocol/scripts/detect-skills.mjs --json
```

If the user doesn't have the repo locally yet:

```bash
git clone https://github.com/0xE1337/pneuma-protocol.git
cd pneuma-protocol
node scripts/detect-skills.mjs --json
```

The scanner probes **5 sources**, not just PATH binaries. A typical Claude Code user has 200+ candidates total:

| Source | What it scans | Example IDs |
|---|---|---|
| `claude-agent` | `~/.claude/agents/*.md` (Claude Code subagents) | `agent-architect`, `agent-code-reviewer`, `agent-build-error-resolver` |
| `claude-skill` | `~/.claude/skills/<name>/SKILL.md` (Anthropic skills) | `skill-article-writing`, `skill-brand-voice`, `skill-api-design` |
| `marketplace-skill` | `~/.claude/plugins/marketplaces/<m>/skills/<s>/SKILL.md` | `pua-skills/p9`, `claude-plugins-official/<x>` |
| `path-binary` | PATH on disk (~16 known dev/AI/media CLIs) | `claude-cli`, `forge-test`, `ffmpeg`, `gh-search` |
| `brew-formula` | Useful Homebrew formulae (`brew list --formula`) | `brew-ffmpeg`, `brew-pandoc`, `brew-ripgrep` |

**Output shape**:

```jsonc
{
  "ok": true,
  "platform": "darwin",
  "pneuma": { "cliInstalled": true|false, "keysFilePresent": true|false, ... },
  "sourceCounts": {
    "claude-agent": 48,
    "claude-skill": 184,
    "marketplace-skill": 11,
    "path-binary": 13,
    "brew-formula": 5
  },
  "totalCandidates": 261,
  "candidates": [
    {
      "source": "claude-agent" | "claude-skill" | "marketplace-skill" | "path-binary" | "brew-formula",
      "id": "agent-code-reviewer",
      "name": "code reviewer (subagent)",
      "cmd": "code-reviewer",
      "cmdPath": "/Users/<u>/.claude/agents/code-reviewer.md",
      "category": "security",
      "description": "...(280 chars)",
      "suggestedPriceUsdc": 0.18
    },
    ...
  ]
}
```

If you only want one source (e.g. just the Claude Code subagents):

```bash
node scripts/detect-skills.mjs --source=claude-agent
```

If you want the full description of a single candidate (the underlying SKILL.md / agent.md):

```bash
node scripts/detect-skills.mjs --full=agent-code-reviewer
```

**What you do with it**:

- **Don't** dump 261 candidates on the user — that's overload. Group by `source` and show a 5-row summary first:
   *"I found 261 things you could register: **48** Claude subagents, **184** Anthropic skills, **11** marketplace plugins, **13** PATH binaries, **5** brew formulae. Which family do you want to start with?"*
- Once they pick a family, show top-10 of that source by `suggestedPriceUsdc` desc. Let them tick.
- For any candidate they want more detail on, fetch the full description with `--full=<id>` and read it back.
- If `totalCandidates === 0`: ask whether the user has Claude Code installed at all — these scanners assume `~/.claude/` exists.

### Step 2 — Wallet (3 paths the user picks from)

Pneuma stores wallets at **`~/.pneuma/keys.json`** (mode 0600, JSON file, encrypted at rest if user opts in). The user owns the file, the protocol does not.

Ask the user to pick **one** of these three paths. **Show all three** — let them choose:

| # | Path | When to pick | What you (the AI) help with |
|---|---|---|---|
| **A** | **Import an existing throwaway key** they already have | They already minted EOAs for testnets, have one with USDC, want to keep using it | Run `pneuma keys add -l main -k 0x<64-hex>` for them. Refuse if the key doesn't start with `0x` or isn't 64 hex chars. **Never ask for a key with mainnet funds**. |
| **B** | **Generate a fresh EOA on the spot** | They have nothing, want a clean start | Run `cast wallet new` (foundry) — prints address + private key. Save the key with `pneuma keys add -l main -k 0x<the-output>`. Tell them the **address** so they can fund it from `https://faucet.arc.network`. |
| **C** | **Hand-edit `~/.pneuma/keys.json` themselves** | Power users / they have an existing keystore in another tool and want to import manually | Open the file path in the user's editor (`open ~/.pneuma/keys.json` on macOS, or just print the path). The schema is `{"version":1,"active":"<label>","wallets":[{"label":"main","privateKey":"0x..."}]}`. Tell them to chmod 600. |

**Always remind**: Arc Testnet only — **do NOT use any private key with mainnet funds**.

After the wallet is set, verify:

```bash
pneuma keys list
```

Should show a row marked `●` (active). If `pneuma` CLI isn't on PATH, run it from the cloned repo (no global install needed — pnpm 9 dropped reliable global linking on most setups):

```bash
# From repo root, after `pnpm install`:
node packages/cli/dist/cli.js keys list
# → equivalent to `pneuma keys list`. Alias if you want:
#   alias pneuma="node $PWD/packages/cli/dist/cli.js"

# Or via pnpm script (works from any subdir):
pnpm --filter @pneuma/cli exec node dist/cli.js keys list
```

(Don't proceed past this step until `keys list` shows the active wallet marked `●`.)

### Step 3 — Mint a Soul NFT (identity + TBA wallet)

```bash
pneuma soul mint --name "<user-chosen-agent-name>"
```

This is one transaction on Arc Testnet that:
- Mints an ERC-721 token to the user's active wallet → that's the **Soul**, transferable
- Auto-deploys an ERC-6551 token-bound account → that's the **TBA**, the Soul's smart-contract wallet
- Auto-registers identity in ERC-8004 IdentityRegistry → cross-chain discoverable

Output looks like:

```
✓ Soul #N minted
  TBA  0x<40-hex>
  Tx   0x<64-hex>
```

**Tell the user the TBA address and ask them to fund it with ~5 USDC** from `https://faucet.arc.network` (or transfer from their EOA). The TBA is what receives skill earnings and pays for callers' calls.

Verify:

```bash
pneuma soul status
# → Soul #N · TBA 0xabcd… · USDC <bal> · Reputation 0 (cold-start)
```

### Step 4 — Pick which detected skills to register (5 selection modes)

You have 261 candidates from Step 1. **Do NOT make the user tick boxes one-by-one.** Use one of these 5 modes instead — pick the one that matches what the user said.

> ## ⚠⚠⚠ READ THIS BEFORE `--execute` — endpoint is IMMUTABLE
>
> `SkillRegistry.registerSkill(...)` writes the `endpoint` URL on-chain **permanently**. The contract has `updateSkill(price, active)` but **no `updateEndpoint`**. If the URL you register is wrong (placeholder, dead tunnel, typo), that listing's calls will return 5xx **forever**. The only fix is to deactivate the broken listing and register a brand-new one — wasting gas + leaving a tombstone.
>
> **Two endpoint paths exist, they are NOT interchangeable**:
>
> | Path | What it does | When to use |
> |---|---|---|
> | **`--pack=demo` + `pnpm tunnels:up` + `--tunnels-json=...`** | Registers the 5 hardcoded demo servers (paper-summary / code-review / block-explainer / creative-write / quick-reasoning) that ship with this repo, exposed via cloudflared trycloudflare URLs. **5/5 endpoint match. Calls actually work end-to-end.** | User wants a real working seller setup they can demo to friends / juries. |
> | **`--pack=quickstart` (or any goal pack) + `--allow-placeholder`** | Registers 5 candidates *detected on the user's machine* (subagent / PATH binary / skill md). These have **no HTTP server attached** → endpoint defaults to `https://placeholder.invalid/<id>` → **calls return 5xx forever unless user later builds their own adapter server + re-registers a new listing**. | User just wants on-chain listings to claim "I have these capabilities", knows servers aren't running, will adapter-up later. |
>
> The two paths register **different IDs** (zero overlap by design): demo pack is `packages/pneuma-claude-skills/` server processes; quickstart pack is metadata scanned from the user's `~/.claude/`. **Do NOT mix `--pack=quickstart` with `--tunnels-json=`** — every quickstart ID falls through to placeholder URL because tunnels.json only has demo IDs.
>
> Default recommendation: **demo pack** for first-time onboarding. Only fall back to quickstart/goal packs when the user explicitly says they understand the listing-only tradeoff.

#### Mode A — Demo Pack (default — only end-to-end working path)

Best for: *"I want a real seller setup that actually serves calls"*

```bash
# 1. Start the 5 local demo servers (each on its own port 3101-3105)
cd packages/pneuma-claude-skills && pnpm start:all

# 2. In another terminal, expose them via cloudflared quick tunnels
cd packages/pneuma-claude-skills && pnpm tunnels:up
#   → writes packages/pneuma-claude-skills/.tunnels.json once 5/5 URLs captured
#   → leave this process running for the duration of the demo

# 3. In a third terminal, dry-run the registration plan
node scripts/register-skills.mjs --pack=demo \
  --tunnels-json=packages/pneuma-claude-skills/.tunnels.json

# 4. Confirm endpointSource: "tunnels-json" in output. If 5/5 candidates show
#    real https://*.trycloudflare.com URLs (not placeholder.invalid), execute:
node scripts/register-skills.mjs --pack=demo \
  --tunnels-json=packages/pneuma-claude-skills/.tunnels.json --execute
```

Total ~$0.53 USDC revenue per full sweep. **Calls work end-to-end** — invoke any skill via `/api/orchestrate` or directly hit the trycloudflare URL.

#### Mode A2 — Quickstart Pack (listing-only — explicit opt-in required)

Best for: *"I just want my machine's capabilities listed on-chain, I'll build serving later"*

```bash
node scripts/register-skills.mjs --pack=quickstart
# → dry-run: shows endpointSource: "placeholder" warning

node scripts/register-skills.mjs --pack=quickstart --execute
# → REFUSED with exit code 3 — placeholder + execute is fail-closed by default

node scripts/register-skills.mjs --pack=quickstart --execute --allow-placeholder
# → only this command actually broadcasts tx with placeholder URLs
#   user must explicitly opt in to "yes I know calls will 5xx forever"
```

This selects 5 candidates from `~/.claude/`/PATH (architect / code-reviewer / article-writing / deep-research / claude-cli) totaling ~$0.63 USDC per full sweep. **Endpoints are placeholder.invalid** — calls fail until user builds an adapter server and re-registers (since endpoint is immutable).

#### Mode B — Goal-driven Pack

Best for: *"I'm a Solidity dev / content creator / researcher"*

```bash
node scripts/register-skills.mjs --pack=web3-dev          # Solidity / EVM / security skills
node scripts/register-skills.mjs --pack=content-creator   # writing / media / brand voice
node scripts/register-skills.mjs --pack=research          # paper / search / deep-research
node scripts/register-skills.mjs --pack=ai-agents         # all 48 Claude subagents
node scripts/register-skills.mjs --pack=marketplace       # all marketplace plugins
node scripts/register-skills.mjs --pack=everything        # ⚠ 261 skills + lots of gas
```

List the pack catalog any time:

```bash
node scripts/detect-skills.mjs --packs
```

#### Mode C — Top-N per source

Best for: *"I want a balanced spread, not deep into one category"*

```bash
node scripts/detect-skills.mjs --top=3       # top 3 (by suggested price) per source = 15 candidates
node scripts/register-skills.mjs --ids=$(node scripts/detect-skills.mjs --top=3 --json | jq -r '.candidates[].id' | tr '\n' ',' | sed 's/,$//')
```

#### Mode D — AI-assisted natural-language pick

Best for: *"I don't know what I want, what should I pick?"*

You (the AI) read the user's recent context (what repo are they in? what languages? recent commits?) and **suggest 3-5 candidates by id**. Then:

```bash
node scripts/register-skills.mjs --ids=agent-code-reviewer,agent-architect,skill-defi-amm-security
```

Always show the dry-run before suggesting `--execute`.

#### Mode E — Manual fzf picker (power user)

Best for: *"Let me see all 261 and pick myself"*

```bash
SELECTED=$(node scripts/detect-skills.mjs --json | jq -r '.candidates[] | "\(.id)\t$\(.suggestedPriceUsdc)\t\(.category)\t\(.name)"' | fzf -m | cut -f1 | tr '\n' ',' | sed 's/,$//')
node scripts/register-skills.mjs --ids="$SELECTED"
```

`fzf -m` lets the user multi-select with TAB. Requires `brew install fzf` if missing.

---

**For all 5 modes the workflow is the same**:

1. Show dry-run output (lists each `pneuma serve` command + estimated revenue per full sweep).
2. Confirm with the user — *"this will register X skills and start X local servers; want to proceed?"*
3. Run `--execute`.
4. **Each `pneuma serve` command launches in its own terminal** so the local HTTP server stays alive while you keep onboarding the next one. Tell the user this — they may need to open a tmux / multiple iTerm windows.
5. Expose ports via cloudflared:
   ```bash
   pnpm tunnels:up   # auto-tunnels all running skill ports
   ```
6. Once each skill's trycloudflare URL is reachable, the on-chain registration completes and **`https://pneuma-hub.vercel.app/discover` shows the new skill within ~10 s**.

---

#### Failure modes & recovery

- `[register-skills] error: Pneuma CLI not in PATH` → step user back to running `npm install -g @pneuma/cli`.
- `[register-skills] error: No ~/.pneuma/keys.json` → step user back to Step 2.
- `pneuma serve … failed: SelfCallForbidden` → user picked a candidate where the skill owner *is* the active wallet. Switch wallet (`pneuma keys activate -l <other>`) and retry just that one.
- A specific skill registers but `/discover` doesn't show it → tunnel didn't come up. Run `pnpm tunnels:status` to verify, restart with `pnpm tunnels:up`.

---

## What you (the AI) do NOT do

- **Do not generate or import keys behind the user's back.** Always show them the command, let them paste / run it themselves. Never `cat` their `keys.json` content into the chat — keys must stay on disk.
- **Do not auto-pick skill prices.** Suggest `suggestedPriceUsdc` from the catalog but always ask "this is suggested, want to change it?"
- **Do not register skills they didn't ask for.** Step 4 is opt-in per item — even if 14 candidates were detected, only register the ones the user explicitly checked.
- **Do not assume they want mainnet.** This whole flow is Arc Testnet (chain id 5042002). The faucet is free; coins are play money.

---

## Gotchas you should warn the user about

1. **`SelfCallForbidden`**. The active wallet that owns these new skills cannot also be the *caller* in `/api/orchestrate` Smart-mode tests. If the user wants to test their own marketplace, they need a **second wallet** — generate another with `cast wallet new` and use it for calls.
2. **Tunnel URL drift**. cloudflared quick tunnels (`*.trycloudflare.com`) get a new hostname on every restart. After a reboot the user must re-run `pnpm tunnels:up` and re-register the new endpoint, OR move to a stable Cloudflare named tunnel (one-time DNS setup, see `packages/pneuma-claude-skills/SETUP_TUNNEL.md`).
3. **Local skill server must be running**. Once registered on-chain, the skill's endpoint URL is on-chain — but the actual HTTP server lives on the user's machine. If their laptop sleeps / disconnects, calls to that skill return 5xx and harm reputation. Tell them this upfront.
4. **TBA must hold USDC** to pay for their *own* outbound calls (if they want to also be a buyer). For just being a seller, the TBA only needs to *receive* USDC — no outbound balance required.

---

## State the user reaches at end of onboarding

```
✓ ~/.pneuma/keys.json contains an active throwaway wallet
✓ pneuma keys list  shows the wallet
✓ pneuma soul status  shows a minted Soul + a TBA
✓ At least 1 local skill server is running and registered on
  the on-chain SkillRegistry
✓ https://pneuma-hub.vercel.app/discover  shows the skill in
  the list (and Top Agents leaderboard if reputation accrues)
```

The user is now a sovereign agent on Pneuma. Their skill is publicly listed, anyone can discover it, payments flow as USDC into their TBA, and every call leaves an attestation that follows the Soul forever.

---

## Programmatic shape (sub-agent / tool wrapper)

If you wrap this as a tool, the contract is just:

**Input**:
```typescript
{
  step: 1 | 2 | 3 | 4;
  /** step-specific args */
  walletPath?: "A" | "B" | "C";
  privateKey?: string;        // step 2A only
  agentName?: string;          // step 3 only
  selectedSkillIds?: string[]; // step 4 only
}
```

**Output**: stream the appropriate command(s) to run, plus a `nextStep` hint so the user knows what's next.

---

## License

MIT. Fork freely.

> *Pneuma — One Soul. Every paid tool, every platform.*
