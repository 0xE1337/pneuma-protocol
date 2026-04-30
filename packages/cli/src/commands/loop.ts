/**
 * `pneuma loop` —— 自动循环调用其他 agent 的 skill
 *
 * 用法:
 *   pneuma loop --interval 10 [--skills 1,2,4] [--max 50] [--key <label>]
 *
 * 行为：
 *   - 每 N 秒（含 ±50% jitter 防同步抖动）随机选一个 skill 调用
 *   - 优先调用"非自己拥有"的 skill（防自调）
 *   - --max 达到后退出；不传则跑到 Ctrl-C
 *
 * 用途：multi-agent demo 时让每个 terminal 上的 agent 自动产生 caller 流量
 */

import { Command } from "commander";
import chalk from "chalk";
import { PneumaClient } from "@pneuma/x402/client";
import { formatUnits, type Address } from "viem";
import { loadConfig, explorerTxUrl } from "../config.js";
import { getActiveKey, listKeys, type KeyEntry } from "../keys.js";
import { makePublicClient } from "../clients.js";

interface LoopOptions {
  interval: string;
  skills?: string; // "1,2,4"
  max?: string;
  key?: string;
}

const SAMPLE_QUERIES = [
  "总结一下 Pneuma 协议的 7 大支柱",
  "查 ETH 当前价格",
  "code review for x402 EIP-712 verify path",
  "BTC 24h 走势",
  "image-caption: 一只猫坐在窗台",
  "sentiment: this skill works perfectly",
  "总结 PneumaCommons 知识公地的 invariant 设计",
  "USDC 跨链桥实时利率",
];

function pickQuery(): string {
  return SAMPLE_QUERIES[Math.floor(Math.random() * SAMPLE_QUERIES.length)];
}

export function registerLoopCommand(program: Command) {
  program
    .command("loop")
    .description(
      "Auto-call random skills on a fixed interval (multi-agent demo driver).",
    )
    .requiredOption(
      "-i, --interval <seconds>",
      "average seconds between calls (±50% jitter)",
    )
    .option(
      "-s, --skills <ids>",
      "comma-separated skill ids to call (default: all active not owned by you)",
    )
    .option("-m, --max <count>", "stop after N calls (default: until Ctrl-C)")
    .option("-k, --key <label>", "wallet key label (defaults to active key)")
    .action(async (opts: LoopOptions) => {
      await runLoop(opts);
    });
}

async function runLoop(opts: LoopOptions) {
  const cfg = loadConfig();
  const interval = Math.max(1, Number(opts.interval));
  const max = opts.max ? Number(opts.max) : Infinity;

  // Pick wallet key
  let key: KeyEntry;
  if (opts.key) {
    const all = listKeys();
    const found = all.entries.find((e) => e.label === opts.key);
    if (!found) {
      console.error(chalk.red(`✗ key '${opts.key}' not found`));
      process.exit(1);
    }
    key = found;
  } else {
    key = getActiveKey();
  }

  // Discover skills
  const publicClient = makePublicClient(cfg);
  const allSkills = (await publicClient.readContract({
    address: cfg.skillRegistry,
    abi: ListActiveSkillsAbi,
    functionName: "listActiveSkills",
  })) as ReadonlyArray<{
    skillId: bigint;
    owner: Address;
    name: string;
    endpoint: string;
    pricePerCall: bigint;
  }>;

  // Filter
  const requested = opts.skills
    ? new Set(opts.skills.split(",").map((s) => Number(s.trim())))
    : null;
  const targets = allSkills
    .filter((s) => s.owner.toLowerCase() !== key.address.toLowerCase())
    .filter((s) => !requested || requested.has(Number(s.skillId)));

  if (targets.length === 0) {
    console.error(
      chalk.red(
        `✗ no callable skills (key holds 0 callable; all skills are owned by ${key.address})`,
      ),
    );
    process.exit(1);
  }

  // Resolve callerTBA (use key address as TBA fallback for demo)
  const callerTBA = key.address;

  console.log(
    chalk.bold("\n  pneuma loop · auto-caller\n"),
    chalk.dim("    caller    "), chalk.green(key.address), "\n",
    chalk.dim("    tba       "), chalk.green(callerTBA), "\n",
    chalk.dim("    interval  "), chalk.cyan(`${interval}s ±50%`), "\n",
    chalk.dim("    targets   "), chalk.cyan(`${targets.length} skill(s): ${targets.map((s) => `#${s.skillId}`).join(", ")}`), "\n",
    chalk.dim("    max calls "), chalk.cyan(max === Infinity ? "∞" : String(max)), "\n",
  );

  const client = new PneumaClient({
    rpcUrl: cfg.rpcUrl,
    chainId: cfg.chainId,
    paymentToken: cfg.usdc,
    skillRegistry: cfg.skillRegistry,
    privateKey: key.privateKey,
  });

  let stopped = false;
  process.on("SIGINT", () => {
    if (!stopped) {
      stopped = true;
      console.log(chalk.yellow("\n→ stopping after current call …"));
    } else {
      process.exit(130);
    }
  });

  let count = 0;
  while (!stopped && count < max) {
    const target = targets[Math.floor(Math.random() * targets.length)];
    const query = pickQuery();
    const ts = new Date().toISOString().slice(11, 19);

    console.log(
      chalk.dim(`[${ts}] →`),
      chalk.cyan(`#${target.skillId} ${target.name}`),
      chalk.dim("· query:"),
      chalk.dim(`"${query.slice(0, 40)}"`),
    );

    try {
      const result = await client.callSkill({
        endpoint: target.endpoint,
        body: { query },
        callerTBA,
      });
      console.log(
        chalk.dim(`[${ts}] ✓`),
        chalk.green(`callId ${result.callId}`),
        chalk.dim(`paid ${formatUnits(result.paidAmount, 6)} USDC`),
        chalk.dim(`tx ${explorerTxUrl(cfg, result.escrowTxHash)}`),
      );
      count++;
    } catch (err) {
      console.log(
        chalk.dim(`[${ts}] ✗`),
        chalk.red((err as Error).message),
      );
    }

    if (stopped || count >= max) break;

    // ±50% jitter, in ms
    const jitter = (Math.random() - 0.5) * interval; // ±0.5*interval seconds
    const waitMs = Math.max(500, (interval + jitter) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  console.log(chalk.bold(`\n  done — ${count} call(s) completed.\n`));
}

const ListActiveSkillsAbi = [
  {
    type: "function",
    name: "listActiveSkills",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
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
