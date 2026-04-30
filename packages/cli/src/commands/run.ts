/**
 * `pneuma run` —— Caller 真跑 escrow → fetch → settle 全流程
 *
 * 用法:
 *   pneuma run --skill <id> --query "..."  [--soul <tokenId>] [--key <label>]
 *
 * 行为：
 *   - 用 active key（或 --key）作为 caller wallet
 *   - 自动 lookup skill.endpoint（链上 getSkill）
 *   - callerTBA：默认从 active key 持有的第一个 Soul 派生（用 SoulNFT.tbaOf(tokenId)）
 *   - 走 PneumaClient.callSkill：approve → escrowForCall → fetch endpoint → settle
 *   - 输出 callId / paid USDC / tx hash / response body
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { PneumaClient } from "@pneuma/x402/client";
import { formatUnits, type Address } from "viem";
import { loadConfig, explorerTxUrl } from "../config.js";
import { getActiveKey, listKeys, type KeyEntry } from "../keys.js";
import { makePublicClient } from "../clients.js";

interface RunOptions {
  skillId: string;
  query?: string;
  soulId?: string;
  tba?: string;
  key?: string;
  json?: string;
}

export function registerRunCommand(program: Command) {
  // 注意：cli.ts 里现有一个占位 `run` —— 我们要先 deregister 它再 register 真的
  // commander 不支持 deregister，所以让 cli.ts 里删掉占位（在 patch 步骤里做）
  program
    .command("run")
    .description("Pay + call + settle a paid skill (real on-chain escrow + EIP-712 signing).")
    .requiredOption("-s, --skill-id <id>", "skill id to call")
    .option("-q, --query <text>", "shorthand: wraps as { query: <text> } body")
    .option(
      "-j, --json <body>",
      "raw JSON body (overrides --query)",
    )
    .option(
      "-S, --soul-id <tokenId>",
      "callerTBA derived from this Soul tokenId (default: first held Soul)",
    )
    .option("-t, --tba <addr>", "explicit callerTBA address (overrides --soul-id)")
    .option("-k, --key <label>", "wallet key label (defaults to active key)")
    .action(async (opts: RunOptions) => {
      await runRun(opts);
    });
}

async function runRun(opts: RunOptions) {
  const cfg = loadConfig();
  const skillId = Number(opts.skillId);

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

  // Lookup skill
  const publicClient = makePublicClient(cfg);
  const skill = (await publicClient.readContract({
    address: cfg.skillRegistry,
    abi: SkillGetterAbi,
    functionName: "getSkill",
    args: [BigInt(skillId)],
  })) as {
    skillId: bigint;
    owner: Address;
    name: string;
    endpoint: string;
    pricePerCall: bigint;
  };

  // Resolve callerTBA
  let callerTBA: Address;
  if (opts.tba) {
    callerTBA = opts.tba as Address;
  } else if (opts.soulId) {
    callerTBA = (await publicClient.readContract({
      address: cfg.soulNft,
      abi: SoulNftTbaOfAbi,
      functionName: "tbaOf",
      args: [BigInt(opts.soulId)],
    })) as Address;
  } else {
    // 默认：找 key 持有的第一个 Soul
    const balance = (await publicClient.readContract({
      address: cfg.soulNft,
      abi: SoulNftBalanceAbi,
      functionName: "balanceOf",
      args: [key.address],
    })) as bigint;
    if (balance === 0n) {
      console.error(
        chalk.red(
          `✗ key '${key.label}' (${key.address}) holds no Soul.\n` +
            `  Run 'pneuma soul mint' first, or pass --tba 0x...`,
        ),
      );
      process.exit(1);
    }
    // 简化：直接用 key.address 作为 TBA fallback（demo 阶段；生产应 enumerate token ids）
    callerTBA = key.address;
    console.log(
      chalk.dim(`  · using ${key.address} as callerTBA fallback (no --soul-id given)`),
    );
  }

  // Build body
  const body = opts.json
    ? JSON.parse(opts.json)
    : opts.query
      ? { query: opts.query }
      : {};

  // Banner
  console.log(
    chalk.bold("\n  pneuma run · ") +
      chalk.cyan(skill.name) +
      chalk.dim(` (skill #${skillId})`),
  );
  console.log(chalk.dim("    caller   "), chalk.green(key.address));
  console.log(chalk.dim("    tba      "), chalk.green(callerTBA));
  console.log(chalk.dim("    endpoint "), chalk.cyan(skill.endpoint));
  console.log(chalk.dim("    price    "), chalk.cyan(`${formatUnits(skill.pricePerCall, 6)} USDC (V4 base)`));
  console.log("");

  const client = new PneumaClient({
    rpcUrl: cfg.rpcUrl,
    chainId: cfg.chainId,
    paymentToken: cfg.usdc,
    skillRegistry: cfg.skillRegistry,
    privateKey: key.privateKey,
  });

  const spinner = ora("escrow + service call + settle…").start();

  try {
    const result = await client.callSkill({
      endpoint: skill.endpoint,
      body,
      callerTBA,
    });
    spinner.succeed("call settled");

    console.log("");
    console.log(chalk.bold("  Result"));
    console.log(chalk.dim("    callId     "), chalk.cyan(result.callId));
    console.log(
      chalk.dim("    paid       "),
      chalk.cyan(`${formatUnits(result.paidAmount, 6)} USDC`),
    );
    console.log(
      chalk.dim("    escrow tx  "),
      chalk.green(explorerTxUrl(cfg, result.escrowTxHash)),
    );
    console.log("");
    console.log(chalk.bold("  Response body"));
    console.log(chalk.dim(JSON.stringify(result.data, null, 2)));
    console.log("");
  } catch (err) {
    spinner.fail((err as Error).message);
    process.exit(1);
  }
}

/* ─────────────────────── ABIs (minimal) ─────────────────────── */

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

const SoulNftTbaOfAbi = [
  {
    type: "function",
    name: "tbaOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const SoulNftBalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
