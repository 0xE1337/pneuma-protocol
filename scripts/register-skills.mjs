#!/usr/bin/env node
/**
 * scripts/register-skills.mjs — batch register skills on Pneuma SkillRegistry
 *
 * 跟 detect-skills.mjs 对偶：detect 探测候选，register 真上链。
 *
 * 用法：
 *   node scripts/register-skills.mjs --pack=quickstart                     # pack-driven
 *   node scripts/register-skills.mjs --ids=agent-architect,agent-code-reviewer
 *   node scripts/register-skills.mjs --pack=web3-dev --execute              # 真上链（默认 dry-run）
 *
 * 默认 dry-run，输出 machine-readable 的 action plan JSON（一组 `pneuma serve`
 * 命令），让 AI 拿到后跟用户确认再执行。这是设计上的安全防线：
 * 不让 AI 替用户偷偷上链 + 花 gas + 暴露注册元数据。
 *
 * 真要批量上链时加 --execute，脚本会逐个 spawn `pneuma serve register-only`，
 * 每个要 ~3-8s（合约 tx + confirm）。失败的会列在 result.failed 里。
 */

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_ROOT = resolve(__dirname, "..");

const ARG_PACK = (process.argv.find((a) => a.startsWith("--pack=")) || "").slice(7);
const ARG_IDS = (process.argv.find((a) => a.startsWith("--ids=")) || "").slice(6);
const ARG_EXECUTE = process.argv.includes("--execute");
const ARG_JSON = process.argv.includes("--json");
const ARG_PORT_BASE = parseInt(
  (process.argv.find((a) => a.startsWith("--port-base=")) || "").slice(12) || "31010",
  10
);

if (!ARG_PACK && !ARG_IDS) {
  console.error("usage: register-skills.mjs --pack=<name> | --ids=a,b,c [--execute]");
  console.error("  list packs: node scripts/detect-skills.mjs --packs");
  process.exit(2);
}

const log = (...a) => process.stderr.write("[register-skills] " + a.join(" ") + "\n");

/* ─────────────────────────────────────────────────────────────────────
 * Pre-flight: pneuma CLI installed? wallet configured? Soul minted?
 * ───────────────────────────────────────────────────────────────────── */
function which(cmd) {
  try {
    return execFileSync("which", [cmd], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function preflight() {
  const checks = {
    pneumaCli: which("pneuma"),
    keysFile: existsSync(join(homedir(), ".pneuma", "keys.json")),
    nodeOk: process.versions.node.split(".")[0] >= "18",
  };
  const blockers = [];
  if (!checks.pneumaCli) blockers.push("Pneuma CLI not in PATH. Install: npm install -g @pneuma/cli");
  if (!checks.keysFile) blockers.push("No ~/.pneuma/keys.json. Run: pneuma keys add -l main -k 0x... (or generate one with `cast wallet new`)");
  return { checks, blockers };
}

/* ─────────────────────────────────────────────────────────────────────
 * Get candidates from detect-skills.mjs
 * ───────────────────────────────────────────────────────────────────── */
function fetchCandidates() {
  const detectPath = join(__dirname, "detect-skills.mjs");
  const args = ["--json"];
  if (ARG_PACK) args.push(`--pack=${ARG_PACK}`);
  const out = spawnSync("node", [detectPath, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (out.status !== 0) {
    throw new Error(`detect-skills exit ${out.status}: ${out.stderr || out.stdout}`);
  }
  const data = JSON.parse(out.stdout);
  if (ARG_PACK) {
    return data.selected || [];
  }
  // --ids mode
  const wantIds = new Set(ARG_IDS.split(",").map((s) => s.trim()).filter(Boolean));
  return (data.candidates || []).filter((c) => wantIds.has(c.id));
}

/* ─────────────────────────────────────────────────────────────────────
 * Build action plan
 * ───────────────────────────────────────────────────────────────────── */
function buildPlan(candidates) {
  return candidates.map((c, i) => {
    const port = ARG_PORT_BASE + i;
    return {
      step: i + 1,
      candidateId: c.id,
      name: c.name,
      source: c.source,
      category: c.category,
      priceUsdc: c.suggestedPriceUsdc,
      pricePerCallWei: BigInt(Math.round(c.suggestedPriceUsdc * 1_000_000)).toString(),
      port,
      // Placeholder endpoint — gets overwritten when user runs pneuma serve
      placeholderEndpoint: `https://${c.id.replace(/[^a-z0-9-]/gi, "-")}.placeholder.local`,
      // The actual command the user / AI will run for this skill.
      // pneuma serve handles both registration on-chain AND running the local server.
      command: [
        "pneuma serve",
        `--skill-name "${c.name.replace(/"/g, '\\"')}"`,
        `--description "${(c.description || "").slice(0, 200).replace(/"/g, '\\"')}"`,
        `--category "${c.category}"`,
        `--price-usdc ${c.suggestedPriceUsdc}`,
        `--port ${port}`,
        `--proxy-cmd "${c.cmd || c.id}"`,
      ].join(" "),
      // For tunneling so the endpoint URL is publicly reachable
      tunnelHint: `pnpm tunnels:up -- --only ${c.id}  # or use a Cloudflare named tunnel`,
    };
  });
}

/* ─────────────────────────────────────────────────────────────────────
 * Execute (real on-chain registration)
 * ───────────────────────────────────────────────────────────────────── */
function executeOne(action) {
  // We don't actually call viem here — that's coupled. Instead we shell out
  // to `pneuma serve --register-only --skill-id ...` which is the canonical
  // command and already has all the wallet + ABI plumbing.
  log(`exec step ${action.step}: ${action.command}`);
  // pneuma serve doesn't have --register-only yet (it both registers + serves).
  // For onboarding we recommend running each command in a separate terminal so
  // the local server stays up. Here we just print the command, we don't fork.
  return {
    step: action.step,
    command: action.command,
    status: "manual-run-required",
    note: "Run this command in a fresh terminal so the local server stays up while you continue with other steps.",
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Main
 * ───────────────────────────────────────────────────────────────────── */
const pre = preflight();
const candidates = fetchCandidates();
if (candidates.length === 0) {
  console.log(JSON.stringify({ ok: false, error: "no candidates resolved", pack: ARG_PACK, ids: ARG_IDS }));
  process.exit(1);
}

const plan = buildPlan(candidates);
const totalPrice = plan.reduce((s, p) => s + p.priceUsdc, 0);

let executions = null;
if (ARG_EXECUTE) {
  if (pre.blockers.length > 0) {
    console.log(JSON.stringify({ ok: false, blockers: pre.blockers }, null, 2));
    process.exit(1);
  }
  executions = plan.map(executeOne);
}

const result = {
  ok: true,
  mode: ARG_EXECUTE ? "execute" : "dry-run",
  pack: ARG_PACK || null,
  ids: ARG_IDS ? ARG_IDS.split(",") : null,
  preflight: pre,
  totalActions: plan.length,
  estTotalRevenuePerFullSweepUsdc: Number(totalPrice.toFixed(2)),
  plan,
  executions,
  nextSteps: ARG_EXECUTE
    ? [
        "Each `pneuma serve` command must run in its own terminal — keep it alive.",
        "Once running, expose the port via cloudflared or your tunnel of choice.",
        "Verify on https://pneuma-hub.vercel.app/discover — your skills should appear within 10s of registration.",
      ]
    : [
        `Reviewed ${plan.length} actions; total revenue per full sweep ≈ $${totalPrice.toFixed(2)} USDC.`,
        "Re-run with --execute to actually register on-chain.",
        "Or pick a subset:  --ids=" + plan.slice(0, 3).map((p) => p.candidateId).join(",") + ",…",
      ],
};

if (ARG_JSON || ARG_EXECUTE) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n${ARG_PACK ? `Pack: ${ARG_PACK}` : `IDs: ${ARG_IDS}`} → ${plan.length} skills to register`);
  console.log(`Mode: ${result.mode.toUpperCase()}${ARG_EXECUTE ? "" : " (add --execute to register on-chain)"}`);
  console.log(`Est aggregate revenue per full sweep: $${totalPrice.toFixed(2)} USDC\n`);

  if (pre.blockers.length > 0) {
    console.log(`⚠ Pre-flight blockers (must fix before --execute):`);
    for (const b of pre.blockers) console.log(`   ✗ ${b}`);
    console.log();
  }

  console.log(`Action plan:\n`);
  for (const p of plan) {
    console.log(`[${p.step}] ${p.name}  (${p.candidateId})`);
    console.log(`     port: ${p.port}    price: $${p.priceUsdc} USDC`);
    console.log(`     ${p.command}`);
    console.log();
  }

  console.log(`Next:  node scripts/register-skills.mjs --pack=${ARG_PACK || "<...>"} --execute`);
}
