/**
 * `pneuma discover` — 链上 SkillRegistry + reputation 发现
 *
 * 默认按 reputation 降序，cold-start skills 平铺到末尾（保留新人曝光）
 */

import type { Command } from "commander";
import ora from "ora";
import { loadConfig } from "../config.js";
import { makePublicClient } from "../clients.js";
import { SkillRegistryAbi, PneumaAttestationAbi } from "../abi.js";
import { c, fmtUsdc, fmtSeconds, shortAddr } from "../format.js";
import type { Address } from "viem";

const COLD_START_THRESHOLD = 3;

export function registerDiscoverCommand(parent: Command) {
  parent
    .command("discover")
    .description("Search on-chain SkillRegistry by query and reputation")
    .option("-q, --query <text>", "case-insensitive search across name + description + category", "")
    .option("-c, --category <cat>", "filter by exact category (e.g. 'finance', 'text')")
    .option("-r, --min-rep <score>", "filter by minimum reputation score (0-100)", "0")
    .option("-l, --limit <n>", "max results", "20")
    .option("-j, --json", "JSON output")
    .action(async (opts) => {
      const cfg = loadConfig();
      const pub = makePublicClient(cfg);

      const spinner = ora("Loading skills + reputation from chain…").start();
      let skills, ranked;
      try {
        skills = await pub.readContract({
          address: cfg.skillRegistry,
          abi: SkillRegistryAbi,
          functionName: "listActiveSkills",
        });

        // 拉所有 owner 的声誉数据（去重）
        const owners = Array.from(new Set(skills.map((s) => s.owner)));
        const reps = new Map<Address, { score: number; count: number; avgRating: number }>();
        await Promise.all(
          owners.map(async (addr) => {
            try {
              const atts = await pub.readContract({
                address: cfg.pneumaAttestation,
                abi: PneumaAttestationAbi,
                functionName: "getAttestationsByRecipient",
                args: [addr],
              });
              reps.set(addr, summarize(atts));
            } catch {
              reps.set(addr, { score: 0, count: 0, avgRating: 0 });
            }
          }),
        );

        ranked = skills.map((s) => ({
          ...s,
          rep: reps.get(s.owner) ?? { score: 0, count: 0, avgRating: 0 },
        }));
      } catch (err) {
        spinner.fail(c.err(`Read failed: ${(err as Error).message}`));
        process.exit(1);
        return;
      }
      spinner.succeed(`${skills.length} active skill${skills.length === 1 ? "" : "s"} on chain`);

      // Filter
      const q = (opts.query || "").trim().toLowerCase();
      const minRep = Number(opts.minRep);
      let filtered = ranked.filter((r) => {
        if (q && !`${r.name} ${r.description} ${r.category}`.toLowerCase().includes(q)) return false;
        if (opts.category && r.category !== opts.category) return false;
        if (minRep > 0 && r.rep.score < minRep) return false;
        return true;
      });

      // Sort: mature (>=3 calls) by score desc, cold-start last by registration order
      const mature = filtered
        .filter((r) => r.rep.count >= COLD_START_THRESHOLD)
        .sort((a, b) => b.rep.score - a.rep.score);
      const cold = filtered.filter((r) => r.rep.count < COLD_START_THRESHOLD);
      filtered = [...mature, ...cold].slice(0, Number(opts.limit));

      if (opts.json) {
        console.log(
          JSON.stringify(
            filtered.map((r) => ({
              skillId: r.skillId.toString(),
              name: r.name,
              category: r.category,
              endpoint: r.endpoint,
              owner: r.owner,
              priceUsdc: r.pricePerCall.toString(),
              slaTimeoutSec: r.slaTimeoutSec.toString(),
              providerStake: r.providerStake.toString(),
              slashBps: r.slashBps.toString(),
              reputationScore: r.rep.score,
              reputationCount: r.rep.count,
            })),
            null,
            2,
          ),
        );
        return;
      }

      if (filtered.length === 0) {
        console.log(c.dim("No skills match your filter."));
        return;
      }

      console.log("");
      for (const r of filtered) {
        const tag =
          r.rep.count < COLD_START_THRESHOLD
            ? c.dim("🆕 NEW")
            : c.cyan(`⭐ ${r.rep.score.toFixed(1)} (${r.rep.count} reviews)`);
        console.log(
          `  ${c.bold("#" + r.skillId.toString().padEnd(3))} ${c.bold(r.name.slice(0, 38).padEnd(38))} ${c.dim(r.category.padEnd(10))} ${fmtUsdc(r.pricePerCall).padStart(12)}  ${tag}`,
        );
        console.log(`       ${c.dim(r.description.slice(0, 90))}`);
        console.log(
          `       ${c.dim("by")} ${c.dim(shortAddr(r.owner))}   ${c.dim("SLA")} ${c.dim(fmtSeconds(r.slaTimeoutSec))}   ${c.dim("stake")} ${c.dim(fmtUsdc(r.providerStake))}`,
        );
        console.log("");
      }
      console.log(c.dim(`Inspect: pneuma inspect -s <skillId>`));
      console.log(c.dim(`Run:     pneuma run -s <skillId> -i '{...}'`));
    });
}

interface Att {
  rating: number;
  paidAmount: bigint;
  timestamp: bigint;
  revoked: boolean;
  raterRole: number;
}

function summarize(atts: readonly Att[]): { score: number; count: number; avgRating: number } {
  const valid = atts.filter((a) => !a.revoked && a.raterRole !== 3);
  if (valid.length === 0) return { score: 0, count: 0, avgRating: 0 };

  const totalUsdc = Number(valid.reduce((s, a) => s + a.paidAmount, 0n)) / 1e6;
  const volF = Math.sqrt(Math.max(0, totalUsdc));
  const avgRating = valid.reduce((s, a) => s + a.rating, 0) / valid.length;
  const earliest = Number(
    valid.reduce((m, a) => (a.timestamp < m ? a.timestamp : m), valid[0].timestamp),
  );
  const latest = Number(
    valid.reduce((m, a) => (a.timestamp > m ? a.timestamp : m), valid[0].timestamp),
  );
  const now = Date.now() / 1000;
  const ageDays = Math.max(0, (now - earliest) / 86400);
  const idleDays = Math.max(0, (now - latest) / 86400);
  const ageF = Math.min(1, ageDays / 30);
  const decayF = Math.max(0, 1 - 0.023 * idleDays);
  const logBoost = Math.log2(valid.length + 1) * 0.1;
  const repMult = Math.max(0, 1 + logBoost);

  const raw = volF * ageF * repMult * decayF * avgRating;
  return {
    score: Math.min(100, Math.max(0, raw * 5)),
    count: valid.length,
    avgRating,
  };
}
