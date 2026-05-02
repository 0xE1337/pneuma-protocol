/**
 * Pneuma Agent Runtime — buyer-side local agent CLI dispatcher.
 *
 * 闭环：apps/hub (Vercel) → cloudflared tunnel → 本机这个进程 → spawn `claude` CLI
 *      → SSE 流式回 stdout → hub 实时显示。
 *
 * 这个 service 不收 x402 钱：它是 buyer 自己机器跑的 runtime，
 * 调用方是自己的 hub / 自己的 soul wallet。鉴权走 Bearer token，
 * 公网暴露后 token 是唯一防滥用屏障。
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env.local") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { runAgent } from "./spawn.js";

const PORT = Number(process.env.AGENT_RUNTIME_PORT ?? 3010);
const TOKEN = process.env.AGENT_RUNTIME_TOKEN;
const AGENT_BIN = process.env.AGENT_BIN ?? "claude";
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 120_000);
const MAX_PROMPT_LEN = 8192;

if (!TOKEN || TOKEN.length < 24) {
  console.error("[agent-runtime] FATAL: AGENT_RUNTIME_TOKEN must be set (>=24 chars)");
  console.error("  generate one: openssl rand -hex 32");
  process.exit(1);
}

interface InvokeBody {
  prompt: string;
  callId?: string;
  args?: string[];
}

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Pneuma-Call-Id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

const requireBearer = async (c: import("hono").Context, next: () => Promise<void>) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

app.get("/", (c) =>
  c.json({
    service: "Pneuma Agent Runtime",
    bin: AGENT_BIN,
    timeoutMs: AGENT_TIMEOUT_MS,
    description: "Local CLI dispatcher — invoked by hub via cloudflared tunnel",
  }),
);

app.post("/invoke", requireBearer, async (c) => {
  let body: InvokeBody;
  try {
    body = await c.req.json<InvokeBody>();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return c.json({ error: "prompt is required" }, 400);
  }
  if (body.prompt.length > MAX_PROMPT_LEN) {
    return c.json({ error: `prompt exceeds ${MAX_PROMPT_LEN} chars` }, 400);
  }
  // Whitelist args to flags only — reject anything that looks like a path or shell metachar
  const callerArgs = (body.args ?? []).filter(
    (arg) => typeof arg === "string" && /^[A-Za-z0-9_\-=,.:@/]+$/.test(arg) && arg.length < 256,
  );
  // Default args: when bin is `claude` we want non-interactive streaming JSON;
  // any other bin just gets caller-supplied args (or none).
  const defaultArgs = AGENT_BIN === "claude" ? ["-p", "--output-format", "stream-json"] : [];
  const safeArgs = [...defaultArgs, ...callerArgs];

  const callId = body.callId ?? `local-${Date.now()}`;
  console.log(`[agent-runtime] invoke callId=${callId} promptLen=${body.prompt.length}`);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "start", data: JSON.stringify({ callId, bin: AGENT_BIN }) });

    try {
      for await (const event of runAgent({
        bin: AGENT_BIN,
        args: safeArgs,
        prompt: body.prompt,
        timeoutMs: AGENT_TIMEOUT_MS,
      })) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify({
            data: event.data,
            exitCode: event.exitCode,
          }),
        });
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: (err as Error).message }),
      });
    }

    await stream.writeSSE({ event: "done", data: JSON.stringify({ callId }) });
  });
});

console.log(`[agent-runtime] starting on :${PORT}`);
console.log(`[agent-runtime] bin=${AGENT_BIN} timeout=${AGENT_TIMEOUT_MS}ms tokenLen=${TOKEN.length}`);

serve({ fetch: app.fetch, port: PORT });
