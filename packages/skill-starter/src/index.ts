/**
 * Pneuma Skill Starter — minimum viable skill service
 *
 * What this file gives you:
 *   1. A Hono HTTP server bound to your $SKILL_PORT
 *   2. The @pneuma/x402 middleware on the route — so any caller paying via
 *      x402 will succeed; any caller without payment gets HTTP 402
 *   3. A demo /api/echo handler that returns whatever the caller sent in
 *
 * To make it your own:
 *   - Edit `handler` below to call your real LLM / API / business logic
 *   - Update SKILL_NAME / SKILL_PRICE_USDC in .env.local + re-register
 *   - Done. You're now an x402-payable Pneuma skill.
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load both .env.local in this package and the monorepo root .env.local
loadEnv({ path: resolve(__dirname, "../.env.local") });
loadEnv({ path: resolve(__dirname, "../../../.env.local"), override: false });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { x402 } from "@pneuma/x402/hono";
import type { Address, Hex } from "viem";

// ────────────────────────────────────────────────────────────────────────
// Required env values — fail fast if any is missing
// ────────────────────────────────────────────────────────────────────────

const SKILL_ID = Number(process.env.SKILL_ID ?? 0);
const SKILL_NAME = process.env.SKILL_NAME ?? "My Awesome Agent";
const PORT = Number(process.env.SKILL_PORT ?? 3010);
const PAYMENT_TOKEN = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const RPC_URL = process.env.ARC_TESTNET_RPC_URL!;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);

if (!SKILL_ID) {
  console.error("❌ SKILL_ID not set. Run `pnpm register` first to register your skill on-chain, then paste the skillId into .env.local.");
  process.exit(1);
}
if (!PRIVATE_KEY || PRIVATE_KEY === "0x0000000000000000000000000000000000000000000000000000000000000000") {
  console.error("❌ DEPLOYER_PRIVATE_KEY not set in .env.local. Use a throwaway testnet key.");
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────
// Hono app
// ────────────────────────────────────────────────────────────────────────

type AppVariables = {
  pneumaCallId: string;
};

const app = new Hono<{ Variables: AppVariables }>();

// CORS: allow browser-based callers (e.g. Pneuma Hub /run wallet mode)
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "X-Payment"],
    exposeHeaders: ["X-Payment-Response"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/", (c) =>
  c.json({
    service: SKILL_NAME,
    skillId: SKILL_ID,
    description: process.env.SKILL_DESCRIPTION ?? "",
    pricePerCall: `${process.env.SKILL_PRICE_USDC ?? "?"} USDC`,
  }),
);

// 把这里换成你的真业务 handler — LLM / 数据库 / API / 任何东西
app.post(
  "/api/run",
  // x402 middleware：来访者没付钱 → 返回 HTTP 402 + PaymentChallenge JSON
  // 来访者付了钱（X-Payment header） → middleware 链上 verify callId 后才放行
  // handler 跑完后 middleware 自动 settle (转 USDC 给本服务 + 写 attestation)
  x402({
    skillId: SKILL_ID,
    skillName: SKILL_NAME,
    chainId: CHAIN_ID,
    paymentToken: PAYMENT_TOKEN,
    skillRegistry: SKILL_REGISTRY,
    serverPrivateKey: PRIVATE_KEY,
    rpcUrl: RPC_URL,
    defaultRating: 5,
  }),
  async (c) => {
    // 把这里换成你的真业务！下面是个 echo demo
    const body = await c.req.json<Record<string, unknown>>();
    const callId = c.get("pneumaCallId");

    // 例：调你的 LLM
    // const result = await callOpenAI(body.prompt);

    return c.json({
      service: SKILL_NAME,
      callId,
      receivedAt: Date.now(),
      echo: body,
      message: "Replace this echo handler with your real business logic.",
    });
  },
);

// ────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────

console.log(`[${SKILL_NAME}] starting on :${PORT}`);
console.log(`[${SKILL_NAME}] skillId=${SKILL_ID}`);
console.log(`[${SKILL_NAME}] x402 payments accepted via SkillRegistry ${SKILL_REGISTRY}`);

serve({ fetch: app.fetch, port: PORT });
