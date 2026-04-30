/**
 * `pneuma inspect -s <skillId>` — 单个 skill 的完整信息
 */

import type { Command } from "commander";
import { loadConfig, explorerAddrUrl } from "../config.js";
import { makePublicClient } from "../clients.js";
import { SkillRegistryAbi } from "../abi.js";
import { c, fmtUsdc, fmtSeconds } from "../format.js";

export function registerInspectCommand(parent: Command) {
  parent
    .command("inspect")
    .description("Show full skill details: schema hint, price, SLA, provider stake")
    .requiredOption("-s, --skill-id <id>", "skill id to inspect")
    .option("-j, --json", "JSON output")
    .action(async (opts) => {
      const cfg = loadConfig();
      const pub = makePublicClient(cfg);

      let skill;
      try {
        skill = await pub.readContract({
          address: cfg.skillRegistry,
          abi: SkillRegistryAbi,
          functionName: "getSkill",
          args: [BigInt(opts.skillId)],
        });
      } catch (err) {
        console.error(c.err(`Read failed: ${(err as Error).message}`));
        process.exit(1);
        return;
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              skillId: skill.skillId.toString(),
              owner: skill.owner,
              name: skill.name,
              description: skill.description,
              endpoint: skill.endpoint,
              category: skill.category,
              pricePerCall: skill.pricePerCall.toString(),
              totalCalls: skill.totalCalls.toString(),
              active: skill.active,
              providerStake: skill.providerStake.toString(),
              slaTimeoutSec: skill.slaTimeoutSec.toString(),
              slashBps: skill.slashBps.toString(),
              lockedStake: skill.lockedStake.toString(),
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log("");
      console.log(c.bold(`Skill #${skill.skillId.toString()} — ${skill.name}`));
      console.log(`  ${c.dim("Status:    ")} ${skill.active ? c.ok("active") : c.err("inactive")}`);
      console.log(`  ${c.dim("Category:  ")} ${c.cyan(skill.category)}`);
      console.log(`  ${c.dim("Owner:     ")} ${c.cyan(skill.owner)}`);
      console.log(`  ${c.dim("Endpoint:  ")} ${skill.endpoint}`);
      console.log(`  ${c.dim("Price:     ")} ${c.bold(fmtUsdc(skill.pricePerCall))} per call`);
      console.log(`  ${c.dim("Total calls:")} ${skill.totalCalls.toString()}`);
      console.log("");
      console.log(c.bold("Provider economic safety:"));
      console.log(`  ${c.dim("Stake:     ")} ${fmtUsdc(skill.providerStake)} ${c.dim(`(locked: ${fmtUsdc(skill.lockedStake)})`)}`);
      console.log(`  ${c.dim("SLA timeout:")} ${fmtSeconds(skill.slaTimeoutSec)}`);
      console.log(`  ${c.dim("Slash %:   ")} ${(Number(skill.slashBps) / 100).toFixed(2)}%`);
      console.log("");
      console.log(c.bold("Description:"));
      console.log(`  ${skill.description}`);
      console.log("");
      console.log(c.dim(`Owner explorer: ${explorerAddrUrl(cfg, skill.owner)}`));
      console.log(c.dim(`Run: pneuma run -s ${skill.skillId.toString()} -i '<json-body>'`));
    });
}
