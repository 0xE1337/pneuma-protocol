/**
 * server.ts —— 单 skill 进程的 Hono + x402 + Anthropic 入口
 *
 * 同一份代码跑 5 个进程（5 个端口），每份通过环境变量 `SKILL_ID` 选定要 host
 * 的 skill。这种 plug-in 启动风格让 5 个 sovereign agent 进程**真的独立**：
 *   - 各自的 PID
 *   - 各自的端口
 *   - 各自的 SkillRegistry skillId
 *   - 各自的 Anthropic API call 统计
 *
 * 用法：
 *
 *   SKILL_ID=paper-summary tsx src/server.ts
 *   SKILL_ID=code-review   PORT_OVERRIDE=3102 tsx src/server.ts
 *
 * 或者用 script/start-all.mjs 一次起 5 个。
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../.env.local"), override: false });
// 也读 monorepo 根 .env.local，复用 ARC RPC / SkillRegistry 地址等共享值
loadEnv({ path: resolve(__dirname, "../../../.env.local"), override: false });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import Anthropic from "@anthropic-ai/sdk";
import { x402 } from "@pneuma/x402/hono";
import type { Address, Hex } from "viem";

import { ALL_SKILLS } from "./skills/index.js";
import type { SkillDefinition, SkillId, SkillHandler } from "./types.js";

// ────────────────────────────────────────────────────────────────────────
// 解析 env：决定本进程 host 哪个 skill
// ────────────────────────────────────────────────────────────────────────

const SKILL_ID = (process.env.SKILL_ID ?? "") as SkillId;
const skill = ALL_SKILLS[SKILL_ID];

if (!skill) {
  console.error(
    `❌ SKILL_ID="${SKILL_ID}" 不在已注册 skill 列表中。可选值：${Object.keys(
      ALL_SKILLS,
    ).join(", ")}`,
  );
  process.exit(1);
}

const { definition, handler } = skill;

// 链上 skillId（注册后回填到 .env）—— 跟 SKILL_ID 字符串区分开
const ENV_SKILL_ID_KEY = `SKILL_ID_${definition.id
  .replace(/-/g, "_")
  .toUpperCase()}`;
const ON_CHAIN_SKILL_ID = Number(process.env[ENV_SKILL_ID_KEY] ?? 0);

// 端口（每 skill 一个；env 可覆盖）
const ENV_PORT_KEY = `PORT_${definition.id.replace(/-/g, "_").toUpperCase()}`;
const PORT = Number(
  process.env.PORT_OVERRIDE ?? process.env[ENV_PORT_KEY] ?? 3100,
);

const PAYMENT_TOKEN = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const RPC_URL = process.env.ARC_TESTNET_RPC_URL!;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);

// 启动前 fail-fast 校验
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY 未设置（在 .env 或 monorepo 根 .env.local）");
  process.exit(1);
}
if (!ON_CHAIN_SKILL_ID) {
  console.error(
    `❌ ${ENV_SKILL_ID_KEY} 未设置。先跑 \`pnpm register\` 注册 5 个 skill 到链上，把回写的 ID 填到 .env。`,
  );
  process.exit(1);
}
if (!PRIVATE_KEY) {
  console.error("❌ DEPLOYER_PRIVATE_KEY 未设置");
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────
// Anthropic client（进程级单例）
// ────────────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ────────────────────────────────────────────────────────────────────────
// Hono app
// ────────────────────────────────────────────────────────────────────────

type AppVariables = { pneumaCallId: string };
const app = new Hono<{ Variables: AppVariables }>();

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

// 元数据 endpoint —— 评委 / orchestrator 探活用
app.get("/", (c) =>
  c.json({
    service: definition.name,
    skillId: ON_CHAIN_SKILL_ID,
    skillCanonicalId: definition.id,
    description: definition.description,
    category: definition.category,
    pricePerCallUsdc: (Number(definition.pricePerCall) / 1e6).toString(),
    poweredBy: "Anthropic Claude (sovereign agent on demonstrator's machine)",
    defaultRating: definition.defaultRating,
  }),
);

// 真业务 endpoint —— x402 middleware 验完付款再走 handler
app.post(
  "/api/run",
  x402({
    skillId: ON_CHAIN_SKILL_ID,
    skillName: definition.name,
    chainId: CHAIN_ID,
    paymentToken: PAYMENT_TOKEN,
    skillRegistry: SKILL_REGISTRY,
    serverPrivateKey: PRIVATE_KEY,
    rpcUrl: RPC_URL,
    defaultRating: definition.defaultRating,
  }),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const callId = c.get("pneumaCallId");

    try {
      const output = await handler(body, {
        client: anthropic,
        definition,
      });

      return c.json({
        service: definition.name,
        skillId: ON_CHAIN_SKILL_ID,
        callId,
        ...output,
        receivedAt: Date.now(),
      });
    } catch (err) {
      // x402 middleware 已经 settle 完了；这里返回业务错误但不影响链上结算
      return c.json(
        {
          service: definition.name,
          skillId: ON_CHAIN_SKILL_ID,
          callId,
          error: (err as Error).message,
        },
        500,
      );
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────

console.log(`╭───────────────────────────────────────────────────`);
console.log(`│ [${definition.name}] (${definition.id})`);
console.log(`│   skillId       ${ON_CHAIN_SKILL_ID}`);
console.log(`│   port          ${PORT}`);
console.log(`│   pricePerCall  ${Number(definition.pricePerCall) / 1e6} USDC`);
console.log(`│   category      ${definition.category}`);
console.log(`│   model         claude-sonnet-4-5 (Anthropic SDK)`);
console.log(`╰───────────────────────────────────────────────────`);

serve({ fetch: app.fetch, port: PORT });

export type { SkillDefinition, SkillHandler };
