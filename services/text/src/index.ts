/**
 * Pneuma Service: Text Summarizer
 *
 * 真实 LLM 服务 — 调 DeepSeek API，OpenAI 作为 fallback。每次调用收 5 USDC。
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env.local") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { x402 } from "@pneuma/x402/hono";
import { skillFirewall } from "@pneuma/skill-firewall/hono";
import type { Hex, Address } from "viem";

const PORT = Number(process.env.TEXT_PORT ?? 3002);
const SKILL_ID = 2;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * 双 provider fallback：DeepSeek 主，OpenAI 备
 */
async function summarizeWithLLM(text: string, lang: "zh" | "en" = "zh"): Promise<string> {
  const systemPrompt = lang === "zh"
    ? "你是一个简洁高效的摘要助手。用 2-3 句中文总结用户输入的文本，抓核心、不啰嗦。"
    : "You are a concise summarizer. Summarize the user's text in 2-3 sentences. Capture the core, no fluff.";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text },
  ];

  // Try DeepSeek first
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          max_tokens: 300,
          temperature: 0.3,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { choices: { message: { content: string } }[] };
        return data.choices[0].message.content.trim();
      }
      console.warn("[text] DeepSeek returned", resp.status, "falling back to OpenAI");
    } catch (err) {
      console.warn("[text] DeepSeek error:", (err as Error).message, "falling back");
    }
  }

  // Fallback: OpenAI
  if (process.env.OPENAI_API_KEY) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 300,
        temperature: 0.3,
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { choices: { message: { content: string } }[] };
      return data.choices[0].message.content.trim();
    }
    throw new Error(`OpenAI returned ${resp.status}`);
  }

  // 兜底：纯字符截断（无 LLM key 时仍能 demo）
  console.warn("[text] no LLM key configured, using truncate fallback");
  return text.slice(0, 200) + (text.length > 200 ? "..." : "");
}

// Hono Variables 类型扩展：x402 middleware 把 callId 写到 c.set("pneumaCallId", ...)
type AppVariables = {
  pneumaCallId: string;
};

const app = new Hono<{ Variables: AppVariables }>();

// CORS：允许浏览器钱包模式下，前端直接 fetch 本服务
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
    service: "Text Summarizer",
    skillId: SKILL_ID,
    description: "AI-powered text summarization (DeepSeek + OpenAI fallback)",
    pricePerCall: "5 USDC",
  }),
);

app.post(
  "/api/summarize",
  x402({
    skillId: SKILL_ID,
    skillName: "Text Summarizer",
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002),
    paymentToken: process.env.NEXT_PUBLIC_USDC_ADDRESS as Address,
    skillRegistry: process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address,
    serverPrivateKey: process.env.DEPLOYER_PRIVATE_KEY as Hex,
    rpcUrl: process.env.ARC_TESTNET_RPC_URL!,
    defaultRating: 5,
  }),
  // 第一道防线：链下 input 消毒。x402 已经收过钱了，但 caller 可能塞 prompt
  // injection / command injection / SSRF / 超大 payload 进来。命中即 400 阻断，
  // 不进入 LLM provider，省 token + 防越权。
  // size-limit 给 32 KB —— 摘要服务接收长文本是合法场景，比默认 8 KB 宽松。
  skillFirewall({
    rules: ["prompt-injection", "command-injection", "ssrf", "size-limit:32768"],
    onBlock: async (verdict, input) => {
      console.warn(
        `[text/firewall] blocked rule=${verdict.rule} callId=${input.callId ?? "n/a"} reason=${verdict.reason ?? "n/a"}`,
      );
    },
  }),
  async (c) => {
    const body = await c.req.json<{ text: string; lang?: "zh" | "en" }>();
    if (!body.text || body.text.length < 10) {
      return c.json({ error: "text must be at least 10 chars" }, 400);
    }

    const summary = await summarizeWithLLM(body.text, body.lang ?? "zh");

    return c.json({
      summary,
      originalLength: body.text.length,
      summaryLength: summary.length,
      callId: c.get("pneumaCallId"),
    });
  },
);

console.log(`[text] starting on :${PORT}`);
console.log(`[text] skillId=${SKILL_ID}, LLM=${process.env.DEEPSEEK_API_KEY ? "DeepSeek (fallback OpenAI)" : process.env.OPENAI_API_KEY ? "OpenAI" : "truncate-only (no key configured)"}`);

serve({ fetch: app.fetch, port: PORT });
