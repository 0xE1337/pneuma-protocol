/**
 * Pneuma Service: Skill Firewall Demo
 *
 * 这是一个**故意脱链**的 demo skill —— 不依赖 USDC / x402 / SkillRegistry，
 * 只为了端到端证明 @pneuma/skill-firewall 能拦住 9 类已知攻击。
 *
 * 暴露两条镜像 endpoint：
 *
 *   POST /api/echo              ← baseline，无 firewall，攻击直接打穿
 *   POST /api/echo-protected    ← 装了 firewall，恶意 input 在到达 handler 前被 400 掉
 *
 * 跑法：
 *   pnpm --filter @pneuma/service-skill-firewall-demo dev    # 启服务
 *   pnpm --filter @pneuma/service-skill-firewall-demo attack # 在另一个终端跑 attack suite
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { skillFirewall } from "@pneuma/skill-firewall/hono";
import { ATTACK_SUITE, ATTACK_COUNT_BY_CATEGORY } from "./attack-suite.js";

const PORT = Number(process.env.SKILL_FIREWALL_DEMO_PORT ?? 3099);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

app.get("/", (c) =>
  c.json({
    service: "Skill Firewall Demo",
    description:
      "Mirrors two echo endpoints — one bare, one protected by @pneuma/skill-firewall — to prove malicious input is blocked before reaching the handler.",
    endpoints: {
      "POST /api/echo": "baseline (NO firewall) — attacks succeed",
      "POST /api/echo-protected":
        "firewall on (prompt-injection + command-injection + ssrf + size-limit:8192) — attacks blocked",
      "GET /attack-suite": "list of pre-canned attack payloads for discovery",
      "GET /healthz": "liveness probe",
    },
    attackCounts: ATTACK_COUNT_BY_CATEGORY,
  }),
);

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/attack-suite", (c) =>
  c.json({
    total: ATTACK_SUITE.length,
    cases: ATTACK_SUITE.map((a) => ({
      name: a.name,
      category: a.category,
      expectBlock: a.expectBlock,
      why: a.why,
    })),
  }),
);

/**
 * BASELINE — no firewall. Demonstrates that without protection the handler
 * happily consumes any payload (a real LLM call would now exec the attack).
 */
app.post("/api/echo", async (c) => {
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    body = { _raw: await c.req.text() };
  }
  return c.json({
    handler: "baseline",
    received: body,
    warning:
      "No firewall in front of this endpoint — production handler would now process the (possibly malicious) input.",
  });
});

/**
 * PROTECTED — same handler, but with @pneuma/skill-firewall in front.
 *
 * 4 layers of input check, all synchronous regex / string match → < 1ms overhead:
 *   1. prompt-injection  (7 jailbreak families)
 *   2. command-injection (10 shell / SQL / traversal patterns)
 *   3. ssrf              (private IPs + cloud metadata + file://)
 *   4. size-limit:8192   (8 KB byteLength cap)
 *
 * `onBlock` shows where a real provider would write a SYSTEM-rater warning
 * attestation back on chain (we just log it here since this demo is off-chain).
 */
app.post(
  "/api/echo-protected",
  skillFirewall({
    rules: ["prompt-injection", "command-injection", "ssrf", "size-limit:8192"],
    onBlock: (verdict, input) => {
      // 在真实链上 service 里，这里会调用 PneumaAttestation.attest(...) 写一条
      // raterRole=SYSTEM 的 warning attestation；这里只 console.warn 演示位置。
      const callIdSuffix = input.callId ? ` callId=${input.callId}` : "";
      console.warn(
        `[firewall] blocked rule=${verdict.rule} reason=${verdict.reason}${callIdSuffix}`,
      );
    },
  }),
  async (c) => {
    let body: unknown = null;
    try {
      body = await c.req.json();
    } catch {
      body = { _raw: await c.req.text() };
    }
    return c.json({
      handler: "protected",
      received: body,
      note: "Firewall let this input through — handler is safe to process.",
    });
  },
);

console.log(`[skill-firewall-demo] starting on :${PORT}`);
console.log(
  `[skill-firewall-demo] try: curl -s http://localhost:${PORT}/ | jq`,
);

serve({ fetch: app.fetch, port: PORT });
