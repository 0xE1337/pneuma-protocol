# @pneuma/skill-starter

> **5 minutes from zero → your AI agent earns USDC through x402 on Arc.**

Plug any AI agent (LLM-backed, deterministic, anything that speaks HTTP) into the
Pneuma marketplace. Once registered, callers discover you on-chain via
`SkillRegistry.listActiveSkills()`, pay you in **Arc native USDC** via x402, and
write attestations on-chain to your Soul TBA — all without you touching the protocol code.

---

## What you get

| File | What it does |
|---|---|
| `src/index.ts` | A Hono HTTP server with the `@pneuma/x402` middleware already wired. Replace one handler with your real logic. |
| `script/RegisterMySkill.s.sol` | One-shot Foundry script that registers your skill on-chain (writes a row to `SkillRegistry`). |
| `.env.example` | Every required env var with explanatory comments. |

---

## 5-minute Quickstart

### 0. Prerequisites

- Node.js 20+ and pnpm
- [Foundry](https://book.getfoundry.sh/) installed (`forge` on PATH)
- A throwaway wallet funded with **Arc native USDC** on Arc Testnet  
  (USDC on Arc is simultaneously native gas **and** the 6-decimal ERC-20 interface;
  grab test USDC from the [Circle faucet](https://faucet.circle.com))

### 1. Clone and install

```bash
git clone https://github.com/<your-fork>/pneuma-protocol
cd pneuma-protocol/packages/skill-starter
pnpm install
```

### 2. Configure env

```bash
cp .env.example .env.local
# edit .env.local — set DEPLOYER_PRIVATE_KEY + SKILL_NAME + SKILL_PRICE_USDC
# (price is in 6 decimals: e.g. 5 USDC = 5_000_000)
```

### 3. Register your skill on-chain

```bash
pnpm register
```

You'll see something like:

```
=== ✅ Skill registered ===
skillId: 7
```

Copy that number into `SKILL_ID=7` in `.env.local`.

### 4. Boot your service

```bash
pnpm dev
```

```
[My Awesome Agent] starting on :3010
[My Awesome Agent] skillId=7
[My Awesome Agent] x402 payments accepted via SkillRegistry 0x613a...
```

That's it. **You're now a discoverable, x402-payable Pneuma skill.**

### 5. Customize the handler

Open `src/index.ts` and replace the echo handler:

```typescript
app.post("/api/run", x402({...}), async (c) => {
  const body = await c.req.json<{ prompt: string }>();
  const callId = c.get("pneumaCallId");

  // → call YOUR LLM / database / external API here
  const result = await callOpenAI(body.prompt);

  return c.json({ result, callId });
});
```

Done. The middleware automatically:

- Returns HTTP 402 + a PaymentChallenge JSON to unpaid callers
- Verifies on-chain that the caller actually escrowed USDC (via `callId`)
- After your handler returns, calls `SkillRegistry.settleCall()` —
  which moves USDC to your wallet **and** writes a 5-star attestation to the
  caller's Soul TBA

---

## How callers reach you

Once registered, any of these work out of the box:

| Caller | Flow |
|---|---|
| **Pneuma Hub `/run`** (browser wallet) | User picks your skill → MetaMask signs `approve` + `escrow` → fetches your endpoint with `X-Payment` header |
| **Programmatic via `@pneuma/x402/client`** | Node.js / TypeScript SDK that handles the full x402 dance |
| **Any HTTP client** | Sees 402, posts back to escrow flow on-chain, retries with `X-Payment` |

---

## What if I want a public production endpoint?

- Replace the `endpoint` param in `RegisterMySkill.s.sol` with your real URL
  (must be HTTPS + CORS-enabled)
- Update via `SkillRegistry.updateSkill(skillId, newPrice, active)` — owner-only

---

## Going further

- Open the [Pneuma DESIGN.md](../../DESIGN.md) for the full protocol spec
- Look at `services/finance` and `services/text` in the monorepo for two real
  reference implementations

---

## License

MIT
