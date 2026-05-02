/**
 * /api/skills/[skill]/route.ts —— Vercel-native demo skill endpoints
 *
 * 顶层设计：把原 packages/pneuma-claude-skills/src/server.ts (5 个独立 Hono 进程
 * + 5 个 cloudflared tunnel) 整合成 hub 的 1 个动态 catch-all route，跑在 Vercel
 * Fluid Compute 上，URL 永久 stable：
 *
 *   https://pneuma-hub.vercel.app/api/skills/paper-summary
 *   https://pneuma-hub.vercel.app/api/skills/code-review
 *   https://pneuma-hub.vercel.app/api/skills/block-explainer
 *   https://pneuma-hub.vercel.app/api/skills/creative-write
 *   https://pneuma-hub.vercel.app/api/skills/quick-reasoning
 *
 * 替换的脆点：
 *   - cloudflared quick-tunnel URL 重启变 → endpoint immutable 上链就废
 *   - 5 个本地 server 进程任一挂掉 = 演示当场翻车
 *   - 本地 claude CLI 走订阅，Vercel function 跑不了 → 用 ANTHROPIC_API_KEY
 *
 * Hono.fetch(req) 跟 Next.js App Router Request/Response 100% 兼容，
 * 直接复用原 server.ts 的 x402 middleware + skill handler 路径。
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { x402 } from "@pneuma/x402/hono";
import type { Address, Hex } from "viem";

import { ALL_SKILLS } from "@/lib/skills/modules";
import type { SkillId } from "@/lib/skills/modules/types";
import { callClaudeJson } from "@/lib/skills/claude-api";

// Vercel runtime config —— Fluid Compute (Node.js)，最长 300s（默认）已够 reasoning
export const runtime = "nodejs";
export const maxDuration = 60;

// Skill ID → 链上 skillId 映射（必须跟 register-skills.mjs --pack=demo 注册结果一致）
// Vercel env 配：SKILL_ID_PAPER_SUMMARY=40 等。本地 dev 不配则报 fail-fast 错误
// x402 middleware 期望 number 类型（packages/x402/src/types.ts:47），不是 bigint —
// SkillRegistry uint256 上限远超 Number.MAX_SAFE_INTEGER 但实测 demo skillId < 1000，安全
function onChainSkillId(skillCanonicalId: SkillId): number {
  const envKey = `SKILL_ID_${skillCanonicalId.replace(/-/g, "_").toUpperCase()}`;
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(
      `${envKey} 未配置 — 重新注册到链上后把回写的 skillId 加到 hub Vercel env`,
    );
  }
  return Number(raw);
}

// x402 middleware 服务方私钥（settle 时 transfer USDC 到 skill.owner = 此 key 的 EOA）
// 简化：5 个 skill 共用一个 owner（agent-caller）→ Vercel env 只需配 1 个 key
function ownerPrivateKey(): Hex {
  // 优先级：DEMO_SKILL_OWNER_KEY → DEPLOYER_PRIVATE_KEY（fallback）
  const k = (process.env.DEMO_SKILL_OWNER_KEY ??
    process.env.DEPLOYER_PRIVATE_KEY) as Hex | undefined;
  if (!k) {
    throw new Error(
      "DEMO_SKILL_OWNER_KEY 或 DEPLOYER_PRIVATE_KEY 未配置 — 这是 x402 settle 用的 skill owner 钱包私钥",
    );
  }
  return k;
}

// ─────────────────────────────────────────────────────────────────────────
// Hono app —— 把 [skill] 动态段映射到 5 个 skill module 各自的 prompt + handler
// ─────────────────────────────────────────────────────────────────────────

const app = new Hono().basePath("/api/skills");

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

// 元数据 endpoint —— GET /api/skills/<skill>
app.get("/:skill", (c) => {
  const skillId = c.req.param("skill") as SkillId;
  const mod = ALL_SKILLS[skillId];
  if (!mod) return c.json({ error: `unknown skill: ${skillId}` }, 404);
  const { definition } = mod;
  return c.json({
    service: definition.name,
    skillCanonicalId: definition.id,
    description: definition.description,
    category: definition.category,
    pricePerCallUsdc: (Number(definition.pricePerCall) / 1e6).toString(),
    poweredBy: "Anthropic API (claude-haiku-4-5)",
    defaultRating: definition.defaultRating,
  });
});

// 真业务 endpoint —— POST /api/skills/<skill>
//
// x402 middleware 必须用 closure 拿当前请求的 skillId（dynamic route），不能在
// 模块顶层固化。Hono 中间件是按 path 匹配的，所以为每个 skill 路径懒加载一次
// middleware（factory 缓存避免重复构造）。
const middlewareCache = new Map<SkillId, ReturnType<typeof x402>>();
function getX402Middleware(skillId: SkillId) {
  let mw = middlewareCache.get(skillId);
  if (!mw) {
    const mod = ALL_SKILLS[skillId];
    if (!mod) throw new Error(`unknown skill: ${skillId}`);
    mw = x402({
      skillId: onChainSkillId(skillId),
      skillName: mod.definition.name,
      chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002),
      paymentToken: process.env.NEXT_PUBLIC_USDC_ADDRESS as Address,
      skillRegistry: process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address,
      serverPrivateKey: ownerPrivateKey(),
      rpcUrl: process.env.ARC_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_CHAIN_RPC!,
      defaultRating: mod.definition.defaultRating,
    });
    middlewareCache.set(skillId, mw);
  }
  return mw;
}

// Hono middleware pattern: 动态 middleware → next() → handler
// middleware 必须 call next() 让控制流到 handler；handler 内 return c.json
// 这是 Hono 官方推荐链式，next 类型是 () => Promise<void> 不能返回 Response。
app.post(
  "/:skill",
  async (c, next) => {
    // 前置校验 + 动态 dispatch x402 middleware
    const skill = c.req.param("skill") as SkillId;
    if (!ALL_SKILLS[skill]) {
      return c.json({ error: `unknown skill: ${skill}` }, 404);
    }
    const mw = getX402Middleware(skill);
    await mw(c, next);
  },
  async (c) => {
    // 走到这一步说明 x402 middleware 已 allow（付款已 escrow）
    const skill = c.req.param("skill") as SkillId;
    const mod = ALL_SKILLS[skill];
    const body = await c.req.json<Record<string, unknown>>();
    const callId = c.get("pneumaCallId" as never) as string;
    try {
      const output = await mod.handler(body, {
        definition: mod.definition,
        callClaude: callClaudeJson,
      });
      return c.json({
        service: mod.definition.name,
        skillId: String(onChainSkillId(skill)),
        callId,
        ...output,
        receivedAt: Date.now(),
      });
    } catch (err) {
      return c.json(
        { service: mod.definition.name, error: (err as Error).message },
        500,
      );
    }
  },
);

// Next.js App Router glue —— 直接 export Hono.fetch 当 handler
export const GET = (req: Request) => app.fetch(req);
export const POST = (req: Request) => app.fetch(req);
export const OPTIONS = (req: Request) => app.fetch(req);
