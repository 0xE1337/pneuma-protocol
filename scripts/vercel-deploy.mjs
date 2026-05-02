#!/usr/bin/env node
/**
 * scripts/vercel-deploy.mjs
 *
 * 一键部署 Pneuma hub 到任意 Vercel 账号 —— 给 AI agent / 评委 fork 用。
 *
 * 设计原则：
 * - **zero deps**：只用 Node 18+ 自带 fetch + child_process
 * - **idempotent**：重跑不会复制 ENV，先 DELETE 老的再 POST 新的
 * - **machine-readable output**：所有日志带 [vercel-deploy] 前缀 + 末尾 JSON 结果
 *
 * 用法（AI agent 这样调）：
 *
 *   VERCEL_TOKEN=... \
 *   DEEPSEEK_API_KEY=... \
 *   TEST_SELLER_PRIVATE_KEY=0x... \
 *   PNEUMA_REPO=https://github.com/0xE1337/pneuma-protocol \
 *   node scripts/vercel-deploy.mjs
 *
 * 必填环境：
 *   VERCEL_TOKEN              vercel.com/account/tokens 创建
 *   DEEPSEEK_API_KEY          planner LLM
 *   TEST_SELLER_PRIVATE_KEY   orchestrator caller —— 必须 ≠ 5 skill owner
 *
 * 可选：
 *   PNEUMA_REPO               默认 0xE1337/pneuma-protocol
 *   PROJECT_NAME              默认 pneuma-hub
 *
 * 输出（最后一行）：
 *   {"ok":true,"url":"https://pneuma-hub.vercel.app","deploymentId":"dpl_..."}
 *   或
 *   {"ok":false,"error":"...","step":"..."}
 */

const VERCEL_API = "https://api.vercel.com";
const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_NAME = process.env.PROJECT_NAME || "pneuma-hub";
const REPO_URL = process.env.PNEUMA_REPO || "https://github.com/0xE1337/pneuma-protocol";
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const CALLER_PK = process.env.TEST_SELLER_PRIVATE_KEY || "";

// ─────────────────────────────────────────────────────────────────────
// 16 个 ENV 的真实值 —— 跟 apps/hub/.env.example 同步
// ─────────────────────────────────────────────────────────────────────
const STATIC_ENVS = {
  NEXT_PUBLIC_CHAIN_ID: "5042002",
  NEXT_PUBLIC_CHAIN_NAME: "Arc Testnet",
  NEXT_PUBLIC_CHAIN_RPC: "https://rpc.testnet.arc.network",
  NEXT_PUBLIC_CHAIN_EXPLORER: "https://testnet.arcscan.app",
  NEXT_PUBLIC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  NEXT_PUBLIC_SOUL_NFT_ADDRESS: "0x5b516Cdc56910C07C9b34C2d56b31422da97A959",
  NEXT_PUBLIC_SOUL_ACCOUNT_IMPL: "0xb7A7b7a57D0103DBFBCBE8d91f08E8269eA50c50",
  NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS: "0x4Ab33E9417FCb0D51ef4F9e989057BaD97587a7f",
  NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS: "0xdCb29F9172D4BE8d26e71062b3E48C7cf528DD38",
  NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS: "0xdCF2B4Bd90aCf81d42C163D2ce0f0e16eFcE6d8c",
  NEXT_PUBLIC_PNEUMA_TIMELOCK_ADDRESS: "0x68b8790938C21950506f41Aa071705eC959C6e0B",
  NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS: "0x94fE0a0C2427900F9ca82875dF8f672ec2ca3330",
  NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS: "0x201C873F3f3862e0936b026Fb618Ed06f8aA44Cb",
  NEXT_PUBLIC_ERC6551_REGISTRY: "0x000000006551c19487814612e58FE06813775758",
  ARC_TESTNET_RPC_URL: "https://rpc.testnet.arc.network",
};

const log = (...args) => console.error("[vercel-deploy]", ...args);
const die = (step, error) => {
  console.log(JSON.stringify({ ok: false, step, error: String(error?.message ?? error) }));
  process.exit(1);
};

async function v(method, path, body) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.status === 204 ? null : res.json();
}

// ─────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────
async function ensureToken() {
  if (!TOKEN) die("token", "VERCEL_TOKEN env not set. Create one at https://vercel.com/account/tokens");
  if (!DEEPSEEK_KEY) die("env", "DEEPSEEK_API_KEY env not set");
  if (!CALLER_PK || !CALLER_PK.startsWith("0x") || CALLER_PK.length < 64) {
    die("env", "TEST_SELLER_PRIVATE_KEY must be 0x-prefixed 64-hex");
  }
  const me = await v("GET", "/v2/user");
  log(`token belongs to user: ${me.user?.username || me.user?.email}`);
  return me.user;
}

async function getOrCreateProject() {
  // GET project; 404 → create
  try {
    const proj = await v("GET", `/v9/projects/${PROJECT_NAME}`);
    log(`project exists: ${proj.id} (${proj.name})`);
    return proj;
  } catch (e) {
    if (!String(e.message).includes("404")) throw e;
  }
  log(`project not found, creating: ${PROJECT_NAME}`);
  const proj = await v("POST", "/v11/projects", {
    name: PROJECT_NAME,
    framework: "nextjs",
    rootDirectory: "apps/hub",
    gitRepository: {
      type: "github",
      repo: REPO_URL.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""),
    },
  });
  log(`created: ${proj.id}`);
  return proj;
}

async function clearOldEnvs(projectId) {
  // Only clear keys we manage; user's other ENVs untouched
  const all = await v("GET", `/v9/projects/${projectId}/env?decrypt=false`);
  const managed = new Set([
    ...Object.keys(STATIC_ENVS),
    "DEEPSEEK_API_KEY",
    "TEST_SELLER_PRIVATE_KEY",
  ]);
  const toDelete = (all.envs || []).filter((e) => managed.has(e.key));
  log(`clearing ${toDelete.length} stale managed envs`);
  for (const e of toDelete) {
    await v("DELETE", `/v9/projects/${projectId}/env/${e.id}`);
  }
}

async function setEnv(projectId, key, value, isSecret) {
  await v("POST", `/v10/projects/${projectId}/env?upsert=true`, {
    key,
    value,
    type: isSecret ? "encrypted" : "plain",
    target: ["production", "preview", "development"],
  });
}

async function setAllEnvs(projectId) {
  for (const [k, v_] of Object.entries(STATIC_ENVS)) {
    await setEnv(projectId, k, v_, false);
    log(`✓ ${k}`);
  }
  await setEnv(projectId, "DEEPSEEK_API_KEY", DEEPSEEK_KEY, true);
  log(`✓ DEEPSEEK_API_KEY (encrypted)`);
  await setEnv(projectId, "TEST_SELLER_PRIVATE_KEY", CALLER_PK, true);
  log(`✓ TEST_SELLER_PRIVATE_KEY (encrypted)`);
}

async function triggerDeploy(projectId) {
  // POST /v13/deployments with gitSource pointing at main branch HEAD
  const repoSlug = REPO_URL.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  const [org, repo] = repoSlug.split("/");
  log(`triggering deploy: ${org}/${repo}@main`);
  const dep = await v("POST", "/v13/deployments?forceNew=1", {
    name: PROJECT_NAME,
    project: projectId,
    target: "production",
    gitSource: {
      type: "github",
      repo,
      org,
      ref: "main",
    },
  });
  log(`deployment id: ${dep.id} · url: https://${dep.url}`);
  return dep;
}

async function waitReady(deploymentId, maxSec = 360) {
  const start = Date.now();
  let lastState = "";
  while ((Date.now() - start) / 1000 < maxSec) {
    const dep = await v("GET", `/v13/deployments/${deploymentId}`);
    if (dep.readyState !== lastState) {
      log(`state: ${dep.readyState}`);
      lastState = dep.readyState;
    }
    if (dep.readyState === "READY") return dep;
    if (["ERROR", "CANCELED"].includes(dep.readyState)) {
      throw new Error(`build ${dep.readyState}: see https://vercel.com/${dep.creator?.username}/${PROJECT_NAME}/${deploymentId}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`timeout after ${maxSec}s`);
}

async function disableProtection(projectId) {
  // Hobby plan default protection blocks public access; explicitly set to standard public
  try {
    await v("PATCH", `/v9/projects/${projectId}`, {
      ssoProtection: null,
    });
    log("✓ deployment protection disabled (public access)");
  } catch (e) {
    log(`⚠ couldn't disable protection: ${e.message.slice(0, 120)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
async function main() {
  await ensureToken();
  const proj = await getOrCreateProject();
  await clearOldEnvs(proj.id);
  await setAllEnvs(proj.id);
  await disableProtection(proj.id);
  const dep = await triggerDeploy(proj.id);
  const ready = await waitReady(dep.id);
  const url = ready.alias?.[0] ? `https://${ready.alias[0]}` : `https://${ready.url}`;
  console.log(JSON.stringify({ ok: true, url, deploymentId: dep.id, projectId: proj.id }));
}

main().catch((e) => die("main", e));
