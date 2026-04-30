/**
 * Pneuma Service: Finance Oracle
 *
 * 演示用的 mock 价格服务 — 接 x402 中间件，每次调用收 2 USDC（Arc Testnet 原生 USDC，6 decimals）。
 * 真实场景里这里会接交易所 API；hackathon 阶段返回静态价格表。
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 从 services/finance/src/index.ts 往上 4 级到 pneuma-protocol/，加载 .env.local
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env.local") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { x402 } from "@pneuma/x402/hono";
import { skillFirewall } from "@pneuma/skill-firewall/hono";
import type { Hex, Address } from "viem";

const PORT = Number(process.env.FINANCE_PORT ?? 3001);
const SKILL_ID = 1;

/** Mock 价格表（单位：USD），真实场景接 CoinGecko / Chainlink */
const MOCK_PRICES: Record<string, number> = {
  ETH: 3520.45,
  BTC: 95103.22,
  USDC: 1.0,
  USDT: 0.999,
  ARC: 0.0521,
  SOL: 198.7,
  PNEUMA: 0.42,
};

// Hono Variables 类型扩展：x402 middleware 把 callId 写到 c.set("pneumaCallId", ...)
// 声明类型后 handler 里 c.get 才能拿到正确的 string 类型
type AppVariables = {
  pneumaCallId: string;
};

const app = new Hono<{ Variables: AppVariables }>();

// CORS：允许浏览器钱包模式下，前端直接从用户钱包签名 escrow 后 fetch 本服务
// X-Payment 是 x402 协议的非标准 header，必须显式列入允许 + exposed 头
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
    service: "Finance Oracle",
    skillId: SKILL_ID,
    description: "Real-time crypto price feed (mocked)",
    pricePerCall: "2 USDC",
  }),
);

app.post(
  "/api/price",
  x402({
    skillId: SKILL_ID,
    skillName: "Finance Oracle",
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002),
    paymentToken: process.env.NEXT_PUBLIC_USDC_ADDRESS as Address,
    skillRegistry: process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address,
    serverPrivateKey: process.env.DEPLOYER_PRIVATE_KEY as Hex,
    rpcUrl: process.env.ARC_TESTNET_RPC_URL!,
    defaultRating: 5,
  }),
  // 第一道防线：链下 input 消毒。finance 接收的是 ticker symbol，正常 < 32 字符，
  // 默认 8 KB 完全够用。即便如此 prompt-injection / command-injection / SSRF
  // 仍然加上 —— 防 caller 在 symbol 字段塞奇怪 payload 试探 handler 内部 fetch。
  skillFirewall({
    rules: ["prompt-injection", "command-injection", "ssrf", "size-limit:8192"],
    onBlock: async (verdict, input) => {
      console.warn(
        `[finance/firewall] blocked rule=${verdict.rule} callId=${input.callId ?? "n/a"} reason=${verdict.reason ?? "n/a"}`,
      );
    },
  }),
  async (c) => {
    const body = await c.req.json<{ symbol: string }>();
    const symbol = body.symbol?.toUpperCase() ?? "ETH";
    const price = MOCK_PRICES[symbol];

    if (price === undefined) {
      return c.json(
        {
          symbol,
          error: "unknown symbol",
          supported: Object.keys(MOCK_PRICES),
        },
        404,
      );
    }

    return c.json({
      symbol,
      priceUSD: price,
      timestamp: Date.now(),
      source: "Pneuma Finance Oracle (mocked)",
      callId: c.get("pneumaCallId"),
    });
  },
);

console.log(`[finance] starting on :${PORT}`);
console.log(`[finance] skillId=${SKILL_ID}, paymentToken=${process.env.NEXT_PUBLIC_USDC_ADDRESS}`);
console.log(`[finance] supported symbols: ${Object.keys(MOCK_PRICES).join(", ")}`);

serve({ fetch: app.fetch, port: PORT });
