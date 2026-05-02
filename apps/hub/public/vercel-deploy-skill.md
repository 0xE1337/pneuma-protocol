---
name: pneuma-vercel-deploy
version: 0.1.0
description: One-shot deploy of the Pneuma agent-protocol hub (apps/hub) to any Vercel account. Use when a user says they want to deploy Pneuma, fork it, host it themselves, or set up a demo URL for judges. Idempotent — sets all 16 ENV vars, disables Hobby-plan SSO protection, triggers a production build, and reports back the public URL. No browser steps required.
---

# Pneuma · Vercel Deploy Skill

> **What this skill does**: takes 3 user-provided secrets, then drives Vercel's REST API end-to-end to produce a live `https://<project>.vercel.app` URL hosting the Pneuma hub UI, ready for judges or anyone to interact with the on-chain agent network on Arc Testnet.
>
> **Trigger phrases**: "deploy Pneuma to Vercel", "host the hub", "give me a public Pneuma URL", "fork and deploy", "set up a demo deployment", "把 Pneuma 部署到我自己的 Vercel".

---

## What you (the AI) need from the user

Ask the user for **exactly three secrets**. Do not ask for anything else — the rest are pre-filled in the deploy script:

| Secret | Where they get it |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens — create one with full scope, 30-day expiry is fine |
| `DEEPSEEK_API_KEY` | https://platform.deepseek.com/api_keys — needed for orchestrator's Smart-mode planner LLM |
| `TEST_SELLER_PRIVATE_KEY` | A **brand-new EOA** — must NOT be reused from any skill owner, otherwise `SkillRegistry.SelfCallForbidden()` will revert. Generate with `cast wallet new` (foundry) or the in-built `pneuma wallet new`. Then fund it with ~5 USDC from https://faucet.arc.network for that EOA's address. |

**Optional**:
- `PNEUMA_REPO` — defaults to `https://github.com/0xE1337/pneuma-protocol`. Set this if the user has forked the repo and wants to deploy from their fork.
- `PROJECT_NAME` — defaults to `pneuma-hub`. Set this if the user already has a project with that name.

**Do not invent values** for any of the 16 contract addresses, RPC URLs, or chain configs — the deploy script has them hard-coded against the live Arc Testnet contracts. Modifying them risks pointing the hub at dead contracts (Top Agents will appear empty).

---

## Steps for the AI

### Step 1 — Clone the repo (if not already local)

```bash
git clone https://github.com/0xE1337/pneuma-protocol.git
cd pneuma-protocol
```

If the user already has the repo cloned, just `cd` into it.

### Step 2 — Run the deploy script

The script is `scripts/vercel-deploy.mjs` at the repo root. Zero deps (Node 18+ only). Pass the 3 secrets via env:

```bash
VERCEL_TOKEN="<token>" \
DEEPSEEK_API_KEY="<key>" \
TEST_SELLER_PRIVATE_KEY="0x<private-key>" \
node scripts/vercel-deploy.mjs
```

**What happens** (in order):

1. Validate the Vercel token + decode the user's username
2. Get the project named `pneuma-hub` (or create it if missing) with:
   - framework: `nextjs`
   - rootDirectory: `apps/hub`
   - linked to the `0xE1337/pneuma-protocol` GitHub repo (or the fork URL if `PNEUMA_REPO` is set)
3. Wipe any stale ENV values for the 16 keys we manage (other user-set ENVs are untouched)
4. Push all 16 ENV values to the project (12 plain `NEXT_PUBLIC_*` + 4 encrypted server-side)
5. Disable Hobby-plan deployment protection so the URL is publicly accessible (no Vercel SSO gate)
6. Trigger a fresh production deployment from the `main` branch HEAD
7. Poll `/v13/deployments/{id}` every 5 s until `readyState === "READY"` (typical 2–5 min)
8. Print the deployment URL as the **last line of stdout** in JSON shape:

   ```json
   {"ok":true,"url":"https://pneuma-hub.vercel.app","deploymentId":"dpl_...","projectId":"prj_..."}
   ```

   On any error:

   ```json
   {"ok":false,"step":"<which-step>","error":"<message>"}
   ```

### Step 3 — Health-check the live URL

After the script reports `ok: true`, immediately verify three endpoints actually return the expected shapes:

```bash
URL=https://pneuma-hub.vercel.app   # or whatever the script printed

curl -s "$URL/api/anet-status" | head
# Expect JSON with "anetDaemon" / "checkedAt" keys.

curl -s "$URL/discover" | grep -oE "Top Agents|Top Skills"
# Expect both strings to appear.

curl -s "$URL/api/skill-md" | head -3
# Expect "name: pneuma" YAML.
```

If any health check fails:
- 403 `Vercel Authentication`-style page → re-run with `disableProtection` step (already in the script — should not happen unless the user re-enabled it manually)
- 500 → ENV likely missing; re-run the script (it's idempotent)
- Empty `Top Agents` block → the script has the wrong contract addresses (file a bug; do not patch ad-hoc)

### Step 4 — Report to the user

Tell them:
- The live URL
- That the 5 sovereign skill servers in `packages/pneuma-claude-skills` must be running on the user's local machine (`pnpm tunnels:up && pnpm start:all`) for `/run` Smart-mode to actually call skills
- That the Vercel deployment will auto-redeploy on every `git push` to `main` of the linked repo

---

## Reference: full ENV table the script writes

The script hard-codes these so the AI does not need to ask the user. They match the live Arc Testnet (chain id 5042002) contracts as of the Pneuma 0.x release.

| Key | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `5042002` | Arc Testnet |
| `NEXT_PUBLIC_CHAIN_NAME` | `Arc Testnet` | |
| `NEXT_PUBLIC_CHAIN_RPC` | `https://rpc.testnet.arc.network` | |
| `NEXT_PUBLIC_CHAIN_EXPLORER` | `https://testnet.arcscan.app` | |
| `NEXT_PUBLIC_USDC_ADDRESS` | `0x3600...0000` | Native gas + 6-dec ERC-20 |
| `NEXT_PUBLIC_SOUL_NFT_ADDRESS` | `0x5b516Cdc56910C07C9b34C2d56b31422da97A959` | ERC-721 SoulNFT |
| `NEXT_PUBLIC_SOUL_ACCOUNT_IMPL` | `0xb7A7b7a57D0103DBFBCBE8d91f08E8269eA50c50` | ERC-6551 implementation |
| `NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS` | `0x4Ab33E9417FCb0D51ef4F9e989057BaD97587a7f` | x402 escrow + settle |
| `NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS` | `0xdCb29F9172D4BE8d26e71062b3E48C7cf528DD38` | On-chain receipts |
| `NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS` | `0xdCF2B4Bd90aCf81d42C163D2ce0f0e16eFcE6d8c` | Spending caps |
| `NEXT_PUBLIC_PNEUMA_TIMELOCK_ADDRESS` | `0x68b8790938C21950506f41Aa071705eC959C6e0B` | Governance timelock |
| `NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS` | `0x94fE0a0C2427900F9ca82875dF8f672ec2ca3330` | Endorsement graph |
| `NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS` | `0x201C873F3f3862e0936b026Fb618Ed06f8aA44Cb` | Public goods pool |
| `NEXT_PUBLIC_ERC6551_REGISTRY` | `0x000000006551c19487814612e58FE06813775758` | Canonical, multichain |
| `ARC_TESTNET_RPC_URL` | `https://rpc.testnet.arc.network` | Server-side RPC |
| `DEEPSEEK_API_KEY` | *(from user, encrypted)* | Planner LLM |
| `TEST_SELLER_PRIVATE_KEY` | *(from user, encrypted)* | Orchestrator caller — must ≠ any skill owner |

---

## Common pitfalls (so you don't burn the user's time)

1. **TEST_SELLER_PRIVATE_KEY collision**. If the user reuses a private key that already owns a skill on the registry, every Smart-mode call will revert with `SkillRegistry.SelfCallForbidden()`. Generate a fresh one and fund it with USDC from the faucet.
2. **Vercel Hobby plan region**. The script doesn't pin a region — Hobby plan auto-picks default. Don't try to pin Asian regions; only Pro+ supports it.
3. **`pnpm-lock.yaml` drift on fork**. If the user has a fork with a stale lockfile, the build may install a slightly different dep tree than the parent repo. The deploy script doesn't mitigate this — if the user reports build failures unrelated to ENV, suggest running `pnpm install --frozen-lockfile` locally first to get a current lockfile, then push.
4. **Local skill servers**. `/run` Smart mode invokes 5 local skill servers via cloudflared tunnels. Without them running on the user's laptop, Smart mode will return planner output but no actual skill execution. Make sure to mention this — the deploy alone is not the full demo.
5. **Image not in repo**. The deploy script does NOT push code; it triggers a Vercel build of the linked GitHub repo's current `main` HEAD. If the user's local code has unpushed changes, those won't deploy. Make them `git push` first.

---

## Programmatic invocation

If you (the AI) want to wrap this in a sub-agent / tool call, the contract is:

**Input**:
```json
{
  "vercelToken": "...",
  "deepseekApiKey": "...",
  "callerPrivateKey": "0x...",
  "repoUrl": "https://github.com/0xE1337/pneuma-protocol",
  "projectName": "pneuma-hub"
}
```

**Output** (last stdout line of `scripts/vercel-deploy.mjs`):
```json
{ "ok": true, "url": "https://pneuma-hub.vercel.app", "deploymentId": "dpl_xxx", "projectId": "prj_xxx" }
```

or

```json
{ "ok": false, "step": "envs|deploy|wait|...", "error": "..." }
```

---

## License

MIT — same as the parent protocol. Fork freely.

> *Pneuma — One Soul. Every paid tool, every platform.*
