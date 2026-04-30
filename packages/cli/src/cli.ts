#!/usr/bin/env node
/**
 * @pneuma/cli — Pneuma command-line interface
 *
 * One Soul. Every paid tool, every platform.
 *
 * Designed to mirror Monid's `monid` CLI ergonomics so AI agents
 * (Claude Code, Cursor, etc.) can discover and pay for skills with
 * a familiar `discover → inspect → run` workflow — but every call
 * settles on Arc with a portable on-chain receipt.
 */

import { Command } from "commander";
import chalk from "chalk";
import { registerKeysCommands } from "./commands/keys.js";
import { registerSoulCommands } from "./commands/soul.js";
import { registerDiscoverCommand } from "./commands/discover.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerBalanceCommand } from "./commands/balance.js";
import { registerTrailCommand } from "./commands/trail.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerRunCommand } from "./commands/run.js";
import { registerLoopCommand } from "./commands/loop.js";
import { registerAnetCommands } from "./commands/anet.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("pneuma")
  .description(
    "Pneuma CLI — discover, pay, and earn on the open agent network.\n" +
      "  One Soul. Every paid tool, every platform.\n\n" +
      "Standard workflow:\n" +
      "  pneuma soul mint --name <agent>     mint identity + TBA wallet\n" +
      "  pneuma discover -q <query>           find skills (on-chain, with reputation)\n" +
      "  pneuma inspect -s <skillId>          read full schema, price, SLA\n" +
      "  pneuma run -s <skillId> -q '...'     pay + call + settle\n" +
      "  pneuma serve -s <skillId> -p <port>  run an endpoint as that skill's owner\n" +
      "  pneuma loop -i 10                    auto-call random skills every 10s\n" +
      "  pneuma trail                         see all on-chain receipts\n\n" +
      "Agent Network (anet) bridge:\n" +
      "  pneuma anet bootstrap                bind your anet DID to your Soul NFT\n" +
      "  pneuma anet register-x402-skill      advertise x402-payment capability in anet ANS\n" +
      "  pneuma anet mirror <task-id>         mirror an anet task to a Pneuma on-chain attestation",
  )
  .version(VERSION, "-v, --version");

registerKeysCommands(program);
registerSoulCommands(program);
registerDiscoverCommand(program);
registerInspectCommand(program);
registerBalanceCommand(program);
registerTrailCommand(program);
// caller / provider / auto-loop —— EIP-712 PaymentAuth + per-byte refund
registerServeCommand(program);
registerRunCommand(program);
registerLoopCommand(program);

// `pneuma anet *` —— Agent Network 兼容性桥（DID ↔ Soul, KREC ↔ on-chain attestation）
registerAnetCommands(program);

// `pneuma claim-timeout` —— 任何人可触发 SLA 超时 slash
program
  .command("claim-timeout")
  .description("Anyone can call: trigger SLA timeout slash on a stuck call")
  .requiredOption("-c, --call-id <id>", "call id to slash")
  .action(() => {
    console.log(
      chalk.yellow(
        "⚠ Not yet wired in CLI. Pattern is:\n" +
          "    SkillRegistry.claimTimeoutAndSlash(callId)\n" +
          "  See: contracts/src/SkillRegistry.sol",
      ),
    );
    process.exitCode = 2;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`✗ ${(err as Error).message}`));
  process.exit(1);
});
