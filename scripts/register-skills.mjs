#!/usr/bin/env node
/**
 * scripts/register-skills.mjs — batch register skills on Pneuma SkillRegistry
 *
 * v3 (truthful): uses `cast send` (foundry) to actually broadcast registerSkill
 * tx — no fake `pneuma serve` flags, no hallucinated CLI options.
 *
 * Why cast send not viem: zero deps. cast is in PATH (every Pneuma user already
 * has foundry for forge tests). Avoids monorepo workspace import gymnastics.
 *
 * Two modes:
 *
 *   1. dry-run (default)
 *      Reads candidates from detect-skills, builds the per-candidate
 *      registerSkill argv, and prints what would happen. Does NOT touch chain.
 *      Use this to review the action plan before paying gas.
 *
 *   2. --execute
 *      Actually calls `cast send` for each candidate. Requires:
 *        - foundry installed (cast in PATH)
 *        - active wallet in ~/.pneuma/keys.json with a private key
 *        - apps/hub/.env.local has the chain config + SkillRegistry address
 *        - either --endpoint=<url-template> per skill, or
 *          --tunnels-json=<path> to a manifest produced by `pnpm tunnels:up`
 *          mapping candidate.id → public URL
 *
 * Usage:
 *   node scripts/register-skills.mjs --pack=quickstart
 *   node scripts/register-skills.mjs --pack=quickstart --endpoint='https://placeholder.local/<id>'
 *   node scripts/register-skills.mjs --pack=quickstart --tunnels-json=packages/pneuma-claude-skills/.tunnels.json --execute
 *   node scripts/register-skills.mjs --ids=agent-architect,agent-code-reviewer
 *
 * Endpoint URL is *immutable* in SkillRegistry — once registered the URL is
 * locked. The contract has updateSkill(price, active) but no updateEndpoint.
 * So if your tunnel URL changes, you must register a new skill (and optionally
 * deactivate the old). Pick a stable URL or use a Cloudflare named tunnel.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_ROOT = resolve(__dirname, "..");

const ARG_PACK = (process.argv.find((a) => a.startsWith("--pack=")) || "").slice(7);
const ARG_IDS = (process.argv.find((a) => a.startsWith("--ids=")) || "").slice(6);
const ARG_EXECUTE = process.argv.includes("--execute");
const ARG_ENDPOINT_TPL = (process.argv.find((a) => a.startsWith("--endpoint=")) || "").slice(11);
const ARG_TUNNELS = (process.argv.find((a) => a.startsWith("--tunnels-json=")) || "").slice(15);
const ARG_KEY_LABEL = (process.argv.find((a) => a.startsWith("--key=")) || "").slice(6);
const ARG_JSON = process.argv.includes("--json");

if (!ARG_PACK && !ARG_IDS) {
  console.error("usage: register-skills.mjs --pack=<name> | --ids=a,b,c [--execute]");
  console.error("  packs: node scripts/detect-skills.mjs --packs");
  process.exit(2);
}

/* ─────────────────────────────────────────────────────────────────────
 * Pre-flight
 * ───────────────────────────────────────────────────────────────────── */
function which(cmd) {
  try {
    return execFileSync("which", [cmd], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function loadEnv() {
  const path = join(PROTOCOL_ROOT, "apps/hub/.env.local");
  if (!existsSync(path)) {
    return {};
  }
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function loadKeys() {
  const path = join(homedir(), ".pneuma", "keys.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function loadTunnels() {
  if (!ARG_TUNNELS) return null;
  const path = resolve(ARG_TUNNELS);
  if (!existsSync(path)) {
    console.error(`[register-skills] --tunnels-json file not found: ${path}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const env = loadEnv();
const keys = loadKeys();
const tunnels = loadTunnels();

const blockers = [];
if (!which("cast")) blockers.push("foundry `cast` not in PATH. Install: https://book.getfoundry.sh/getting-started/installation");
if (!which("node")) blockers.push("node not in PATH (impossible since you ran this — but listed for completeness)");
if (!keys) blockers.push("~/.pneuma/keys.json missing or invalid JSON. Run `pneuma keys add -l main -k 0x...` first.");
if (!env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS) blockers.push("apps/hub/.env.local missing NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");
if (!env.NEXT_PUBLIC_CHAIN_RPC && !env.ARC_TESTNET_RPC_URL) blockers.push("apps/hub/.env.local missing chain RPC (NEXT_PUBLIC_CHAIN_RPC or ARC_TESTNET_RPC_URL)");

const RPC = env.ARC_TESTNET_RPC_URL || env.NEXT_PUBLIC_CHAIN_RPC || "https://rpc.testnet.arc.network";
const REG = env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS;

/* Resolve active wallet */
let activeKey = null;
let activeAddress = null;
let activeLabel = null;
if (keys) {
  const label = ARG_KEY_LABEL || keys.active;
  const entry = (keys.entries || []).find((e) => e.label === label);
  if (entry) {
    activeKey = entry.privateKey;
    activeAddress = entry.address;
    activeLabel = entry.label;
  } else if (label) {
    blockers.push(`wallet label "${label}" not found in keys.json. Available: ${(keys.entries || []).map((e) => e.label).join(", ")}`);
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * Resolve candidates from detect-skills
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
  if (ARG_PACK) return data.selected || [];
  const wantIds = new Set(ARG_IDS.split(",").map((s) => s.trim()).filter(Boolean));
  return (data.candidates || []).filter((c) => wantIds.has(c.id));
}

/* ─────────────────────────────────────────────────────────────────────
 * Build action plan
 * ───────────────────────────────────────────────────────────────────── */
function endpointFor(c) {
  if (tunnels && tunnels.urls && tunnels.urls[c.id]) return tunnels.urls[c.id];
  if (ARG_ENDPOINT_TPL) {
    return ARG_ENDPOINT_TPL.replace("<id>", c.id).replace("{id}", c.id);
  }
  // Default placeholder. Marks call-time failure but proves registration on-chain.
  return `https://placeholder.invalid/${encodeURIComponent(c.id)}`;
}

function buildPlan(candidates) {
  return candidates.map((c, i) => {
    const endpoint = endpointFor(c);
    const pricePerCallWei = BigInt(Math.round(c.suggestedPriceUsdc * 1_000_000));
    return {
      step: i + 1,
      candidateId: c.id,
      name: c.name.slice(0, 64),
      description: (c.description || "").slice(0, 200),
      endpoint,
      category: c.category,
      priceUsdc: c.suggestedPriceUsdc,
      pricePerCallWei: pricePerCallWei.toString(),
      providerStake: "0",
      slaTimeoutSec: "600",
      slashBps: "3000",
      maxInputBytes: "8192",
      maxOutputBytes: "16384",
      castArgs: [
        REG,
        "registerSkill(string,string,string,string,uint256,uint256,uint256,uint256,uint32,uint32)",
        c.name.slice(0, 64),
        (c.description || "").slice(0, 200),
        endpoint,
        c.category,
        pricePerCallWei.toString(),
        "0",
        "600",
        "3000",
        "8192",
        "16384",
      ],
    };
  });
}

/* ─────────────────────────────────────────────────────────────────────
 * Execute one tx via cast send
 * ───────────────────────────────────────────────────────────────────── */
/** Redact private key from any error string. Critical for safe stderr output. */
function redactPK(s) {
  if (!s || !activeKey) return s;
  return s.split(activeKey).join("0xPK_REDACTED");
}

function executeOne(action, attempt = 0, maxAttempts = 4) {
  if (!activeKey) {
    return { ...action, status: "fail", error: "no active wallet" };
  }
  try {
    const out = execFileSync(
      "cast",
      [
        "send",
        "--rpc-url", RPC,
        "--private-key", activeKey,
        "--json",
        ...action.castArgs,
      ],
      { encoding: "utf8", timeout: 90_000 }
    );
    const receipt = JSON.parse(out);
    return {
      ...action,
      status: "ok",
      attempts: attempt + 1,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      // SkillRegistered event's first indexed topic (after sig) is skillId
      skillIdHint: receipt.logs?.[0]?.topics?.[1] || null,
    };
  } catch (e) {
    const errMsg = redactPK(String(e?.stderr || e?.message || e)).slice(0, 400);
    const isTransient = /tls handshake|client error|Connect|ETIMEDOUT|ECONNRESET|nonce too low/i.test(errMsg);
    if (isTransient && attempt + 1 < maxAttempts) {
      // Sync sleep so we stay sequential — Arc Testnet RPC under GFW is flaky
      const sleepMs = 2000 * (attempt + 1);
      execFileSync("sleep", [String(sleepMs / 1000)]);
      return executeOne(action, attempt + 1, maxAttempts);
    }
    return {
      ...action,
      status: "fail",
      attempts: attempt + 1,
      error: errMsg,
    };
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * Main
 * ───────────────────────────────────────────────────────────────────── */
const candidates = fetchCandidates();
if (candidates.length === 0) {
  console.log(JSON.stringify({ ok: false, error: "no candidates resolved", pack: ARG_PACK, ids: ARG_IDS }));
  process.exit(1);
}

const plan = buildPlan(candidates);
const totalPrice = plan.reduce((s, p) => s + p.priceUsdc, 0);

let executions = null;
if (ARG_EXECUTE) {
  if (blockers.length > 0) {
    console.log(JSON.stringify({ ok: false, blockers }, null, 2));
    process.exit(1);
  }
  executions = plan.map((p) => {
    process.stderr.write(`[register-skills] ▶ step ${p.step}/${plan.length}: ${p.candidateId} → ${p.endpoint}\n`);
    return executeOne(p);
  });
}

const result = {
  ok: true,
  mode: ARG_EXECUTE ? "execute" : "dry-run",
  pack: ARG_PACK || null,
  ids: ARG_IDS ? ARG_IDS.split(",") : null,
  endpointSource: tunnels ? "tunnels-json" : ARG_ENDPOINT_TPL ? "endpoint-template" : "placeholder",
  activeWallet: activeAddress,
  activeLabel,
  registry: REG,
  rpc: RPC,
  totalActions: plan.length,
  estTotalRevenuePerFullSweepUsdc: Number(totalPrice.toFixed(2)),
  preflightBlockers: blockers,
  plan,
  executions,
};

if (ARG_JSON || ARG_EXECUTE) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n${ARG_PACK ? `Pack: ${ARG_PACK}` : `IDs: ${ARG_IDS}`} → ${plan.length} skills to register`);
  console.log(`Mode:           ${result.mode.toUpperCase()}${ARG_EXECUTE ? "" : "  (add --execute to actually broadcast tx)"}`);
  console.log(`Endpoint src:   ${result.endpointSource}`);
  console.log(`Active wallet:  ${activeLabel || "?"} ${activeAddress ? "(" + activeAddress + ")" : ""}`);
  console.log(`SkillRegistry:  ${REG || "?"}`);
  console.log(`RPC:            ${RPC}`);
  console.log(`Est revenue/sweep: $${totalPrice.toFixed(2)} USDC\n`);

  if (blockers.length > 0) {
    console.log(`⚠ Pre-flight blockers (must fix before --execute):`);
    for (const b of blockers) console.log(`   ✗ ${b}`);
    console.log();
  }

  if (result.endpointSource === "placeholder" && ARG_EXECUTE) {
    console.log(`⚠⚠ Endpoint = placeholder.invalid → calls WILL FAIL after registration.`);
    console.log(`    SkillRegistry has no updateEndpoint — re-registering is the only fix.`);
    console.log(`    Recommended: run \`pnpm tunnels:up\` first, then re-run with --tunnels-json=...\n`);
  }

  console.log(`Action plan:\n`);
  for (const p of plan) {
    console.log(`[${p.step}] ${p.name}`);
    console.log(`     id:       ${p.candidateId}`);
    console.log(`     price:    $${p.priceUsdc} USDC (${p.pricePerCallWei} wei)`);
    console.log(`     category: ${p.category}`);
    console.log(`     endpoint: ${p.endpoint}`);
    console.log();
  }

  console.log(`Next steps:`);
  console.log(`  · pnpm tunnels:up             # bring up cloudflared quick tunnels first`);
  console.log(`  · cat .tunnels.json           # confirm URL → candidate.id map`);
  console.log(`  · ${process.argv[1].split("/").slice(-2).join("/")} ${process.argv.slice(2).join(" ")} --tunnels-json=packages/pneuma-claude-skills/.tunnels.json --execute`);
}
