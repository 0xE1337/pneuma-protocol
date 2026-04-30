/**
 * `pneuma serve` —— 起一个 Pneuma service endpoint
 *
 * 用法:
 *   pneuma serve --skill <id> --port <port> [--key <label>]
 *
 * 行为：
 *   - 用 active key（或显式 --key label）作为 service provider 私钥
 *   - 启动 Hono server + @pneuma/x402 hono middleware
 *   - 同一进程同时跑 service handler + settleCall（必须该 key === skill.owner）
 *   - 默认 handler：echo back caller 的 query + 模拟"AI 处理"耗时
 *
 * 协议级心智：
 *   - 这是 sovereign agent 在自己机器上的 endpoint
 *   - Pneuma 不托管这个进程；用户 Ctrl-C 即下线
 *   - 真生产场景下，handler 内部可以接 Claude Code / Cursor / 本地 LLM 任何 AI 推理
 */

import { Command } from "commander";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve as honoServe } from "@hono/node-server";
import { x402 } from "@pneuma/x402/hono";
import chalk from "chalk";
import type { Address, Hex } from "viem";
import { loadConfig } from "../config.js";
import { listKeys, getActiveKey, type KeyEntry } from "../keys.js";
import { makePublicClient } from "../clients.js";

interface ServeOptions {
  skillId: string;
  port: string;
  key?: string;
  /** 默认 5（满分），demo 路径下 service 给 caller 写好评 */
  rating: string;
}

export function registerServeCommand(program: Command) {
  program
    .command("serve")
    .description(
      "Run a Pneuma service endpoint (x402-protected, settled on-chain).",
    )
    .requiredOption("-s, --skill-id <id>", "skill id you own")
    .requiredOption("-p, --port <port>", "HTTP port to listen on")
    .option(
      "-k, --key <label>",
      "wallet key label (defaults to active key)",
    )
    .option(
      "-r, --rating <rating>",
      "default provider→caller rating after settle (1-5)",
      "5",
    )
    .action(async (opts: ServeOptions) => {
      await runServe(opts);
    });
}

async function runServe(opts: ServeOptions) {
  const cfg = loadConfig();
  const skillId = Number(opts.skillId);
  const port = Number(opts.port);
  const rating = Math.max(1, Math.min(5, Number(opts.rating)));

  // Pick wallet key
  let key: KeyEntry;
  if (opts.key) {
    const all = listKeys();
    const found = all.entries.find((e) => e.label === opts.key);
    if (!found) {
      console.error(chalk.red(`✗ key '${opts.key}' not found in keystore`));
      process.exit(1);
    }
    key = found;
  } else {
    key = getActiveKey();
  }

  // Sanity: 确认 skill 存在 + key 是 owner
  const publicClient = makePublicClient(cfg);
  let skill: { owner: Address; name: string; pricePerCall: bigint };
  try {
    const raw = (await publicClient.readContract({
      address: cfg.skillRegistry,
      abi: SkillGetterAbi,
      functionName: "getSkill",
      args: [BigInt(skillId)],
    })) as { owner: Address; name: string; pricePerCall: bigint };
    skill = raw;
  } catch (err) {
    console.error(
      chalk.red(`✗ getSkill(${skillId}) failed: ${(err as Error).message}`),
    );
    process.exit(1);
  }

  if (skill.owner.toLowerCase() !== key.address.toLowerCase()) {
    console.error(
      chalk.red(
        `✗ skill #${skillId} is owned by ${skill.owner}, but key '${key.label}' = ${key.address}.\n` +
          `  Settle would revert. Use the owner's key or pick a skill you own.`,
      ),
    );
    process.exit(1);
  }

  // Banner
  console.log(
    chalk.bold("\n  Pneuma Service · ") +
      chalk.cyan(skill.name) +
      chalk.dim(` (skill #${skillId})\n`),
  );
  console.log(chalk.dim("    owner    "), chalk.green(key.address));
  console.log(chalk.dim("    label    "), chalk.green(key.label));
  console.log(chalk.dim("    chain    "), chalk.green(`${cfg.chainId} (Arc Testnet)`));
  console.log(
    chalk.dim("    price    "),
    chalk.cyan(`${Number(skill.pricePerCall) / 1e6} USDC / call (or per-byte if V5)`),
  );
  console.log(chalk.dim("    listen   "), chalk.cyan(`http://0.0.0.0:${port}`));
  console.log(chalk.dim("    endpoint "), chalk.cyan(`POST /api/skill\n`));

  // Hono app
  const app = new Hono<{ Variables: { pneumaCallId: string } }>();
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
      service: skill.name,
      skillId,
      owner: skill.owner,
      pricePerCall: skill.pricePerCall.toString(),
      protocol: "Pneuma · x402",
    }),
  );

  app.post(
    "/api/skill",
    x402({
      skillId,
      skillName: skill.name,
      chainId: cfg.chainId,
      paymentToken: cfg.usdc,
      skillRegistry: cfg.skillRegistry,
      serverPrivateKey: key.privateKey,
      rpcUrl: cfg.rpcUrl,
      defaultRating: rating,
    }),
    async (c) => {
      // Generic echo handler —— 真生产里这里接 LLM/CLI/任何 AI 推理
      const body = await c.req.json().catch(() => ({}));
      const callId = c.get("pneumaCallId");

      // 模拟 200-800ms "AI 处理时间"
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 600));

      const response = {
        skillId,
        skillName: skill.name,
        callId,
        provider: skill.owner,
        echo: body,
        result: synthesizeResult(skill.name, body),
        timestamp: Date.now(),
      };

      console.log(
        chalk.dim(`  ✓ served callId=${callId}`),
        chalk.cyan(`(${skill.name})`),
      );
      return c.json(response);
    },
  );

  honoServe({ fetch: app.fetch, port }, (info) => {
    console.log(
      chalk.green(`✓ live on http://${info.address}:${info.port}`),
      chalk.dim("(Ctrl-C to stop)\n"),
    );
  });
}

/** 极简 mock 输出 —— 让 demo 看板上的事件 payload 看起来"做了真事" */
function synthesizeResult(skillName: string, body: Record<string, unknown>): unknown {
  const lower = skillName.toLowerCase();
  if (lower.includes("finance") || lower.includes("price")) {
    return {
      symbol: body.symbol ?? "ETH",
      priceUSD: 3520 + Math.random() * 200,
      source: "Pneuma demo serve (synthesized)",
    };
  }
  if (lower.includes("text") || lower.includes("chat") || lower.includes("summar")) {
    const q = (body.query as string) ?? "";
    return {
      summary: q
        ? `[${skillName}] response to: "${q.slice(0, 60)}…"`
        : `[${skillName}] empty query`,
      tokensIn: q.length / 4,
      tokensOut: 32,
    };
  }
  return { ok: true, processed: body };
}

/** 极简 ABI for getSkill —— 不引入 hub contracts 包，避免循环依赖 */
const SkillGetterAbi = [
  {
    type: "function",
    name: "getSkill",
    stateMutability: "view",
    inputs: [{ name: "skillId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "skillId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "endpoint", type: "string" },
          { name: "category", type: "string" },
          { name: "pricePerCall", type: "uint256" },
          { name: "totalCalls", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "createdAt", type: "uint256" },
          { name: "providerStake", type: "uint256" },
          { name: "slaTimeoutSec", type: "uint256" },
          { name: "slashBps", type: "uint256" },
          { name: "lockedStake", type: "uint256" },
          { name: "maxInputBytes", type: "uint32" },
          { name: "maxOutputBytes", type: "uint32" },
          { name: "baseFee", type: "uint256" },
          { name: "inputPricePerKB", type: "uint256" },
          { name: "outputPricePerKB", type: "uint256" },
          { name: "upstreamModel", type: "string" },
          { name: "markupBps", type: "uint16" },
        ],
      },
    ],
  },
] as const;
