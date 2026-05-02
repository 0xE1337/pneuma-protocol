#!/usr/bin/env node
/**
 * scripts/detect-skills.mjs — Pneuma local skill scanner (v2)
 *
 * v1 只扫了 PATH 上的 17 个 binary，盲了用户机器上真正的 skill 生态：
 * Claude Code 装了 48 个 subagent + 184 个 anthropic skill，还有
 * marketplace plugins / OpenClaw / brew formulae，那才是 "skill" 真定义。
 *
 * v2 探测 5 个源，按 source 分组输出：
 *
 *   1. claude-agent      ~/.claude/agents/*.md           (Claude Code subagents)
 *   2. claude-skill      ~/.claude/skills/<name>/SKILL.md (Anthropic skills)
 *   3. marketplace-skill ~/.claude/plugins/marketplaces/<m>/skills/<s>/SKILL.md
 *                        ~/.claude/plugins/cache/<plug>/<ver>/skills/<s>/SKILL.md
 *   4. path-binary       PATH 上 ~17 类 AI/dev/media CLI（v1 留下来）
 *   5. brew-formula      `brew list --formula` 中跟 skill 演示挂钩的（claude / ffmpeg / pandoc / yt-dlp 等）
 *
 * 用法：
 *   node scripts/detect-skills.mjs                 # 人类可读 · 按 source 分组
 *   node scripts/detect-skills.mjs --json          # AI 用：纯 candidates JSON
 *   node scripts/detect-skills.mjs --full id=...   # 单个 candidate 完整 description
 *   node scripts/detect-skills.mjs --source=claude-agent  # 只看一个 source
 */

import { execFileSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ARG_JSON = process.argv.includes("--json");
const ARG_FULL_ID = (process.argv.find((a) => a.startsWith("--full=")) || "").slice(7);
const ARG_SOURCE = (process.argv.find((a) => a.startsWith("--source=")) || "").slice(9);
const ARG_LIST_PACKS = process.argv.includes("--packs");
const ARG_PACK = (process.argv.find((a) => a.startsWith("--pack=")) || "").slice(7);
const ARG_TOP = parseInt((process.argv.find((a) => a.startsWith("--top=")) || "").slice(6) || "0", 10);
const ARG_HISTORY = process.argv.includes("--history");

/* ─────────────────────────────────────────────────────────────────────
 * Preset packs — 给 AI 一套"懒人模式"，免去用户一条条勾选 261 项
 *
 * pack 是一组 candidate id 的策略：
 *   - explicit: 列死的 id
 *   - filter:  函数从全量 candidates 里选
 *
 * 命中策略：选 pack 后，scanner 输出该 pack 在本机能落地的 candidates
 * 子集（id 列出但本机没装的会被跳过）。
 * ───────────────────────────────────────────────────────────────────── */
const PRESET_PACKS = {
  quickstart: {
    title: "Quickstart Pack — 5 个最戳 demo 的 Claude skill",
    blurb:
      "新人 onboard 默认推荐：5 类 Claude Code 衍生 skill，覆盖 engineering / creative / research / blockchain / general。零思考，立刻有 5 个 listing。",
    explicit: [
      "claude-cli",
      "agent-code-reviewer",
      "agent-architect",
      "skill-article-writing",
      "skill-deep-research",
    ],
  },
  "web3-dev": {
    title: "Web3 Developer Pack",
    blurb: "给 Solidity / EVM 开发者：合约审计 + 链上分析 + AMM 安全 + 钱包安全。",
    filter: (c) =>
      ["web3", "blockchain", "security"].includes(c.category) ||
      /defi|amm|wallet|contract|forge|cast|evm/i.test(c.id),
    cap: 8,
  },
  "content-creator": {
    title: "Content Creator Pack",
    blurb: "写作 / 媒体处理 / 排版：creative-write + brand-voice + ffmpeg + pandoc。",
    filter: (c) =>
      ["creative", "media", "office"].includes(c.category) ||
      /writing|brand|content|video|audio|image|copy/i.test(c.id),
    cap: 8,
  },
  research: {
    title: "Research Pack",
    blurb: "学术 + 调研 + 信息检索：paper-summary + deep-research + exa + gh-search。",
    filter: (c) =>
      c.category === "research" ||
      /research|paper|search|exa|deep-research|investigate/i.test(c.id),
    cap: 8,
  },
  "ai-agents": {
    title: "AI Agents Pack",
    blurb: "把 Claude Code 的 48 个 subagent 全部注册（pro 用户路径）—— architect / reviewer / planner ...",
    filter: (c) => c.source === "claude-agent",
    cap: 50, // 全收
  },
  marketplace: {
    title: "Marketplace Pack",
    blurb: "已经从 plugin marketplaces 安装的所有 skill —— pua-skills / claude-plugins-official 等。",
    filter: (c) => c.source === "marketplace-skill",
    cap: 50,
  },
  everything: {
    title: "⚠ Everything Pack",
    blurb:
      "全部 261 个候选都注册。**很可能太多** —— 注册有 gas 成本（每个 skill 一笔 tx），TBA 没那么多 USDC。除非你确定，不建议走这条。",
    filter: () => true,
    cap: 999,
  },
};

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const AGENTS_DIR = join(CLAUDE_DIR, "agents");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const MARKETPLACES_DIR = join(CLAUDE_DIR, "plugins", "marketplaces");
const PLUGIN_CACHE_DIR = join(CLAUDE_DIR, "plugins", "cache");

/* ─────────────────────────────────────────────────────────────────────
 * Helpers — frontmatter parser, sandboxed exec, etc
 * ───────────────────────────────────────────────────────────────────── */
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = text.slice(3, end);
  const out = {};
  let key = null;
  let buf = "";
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) {
      if (key !== null) out[key] = buf.trim();
      key = m[1];
      buf = m[2] ?? "";
    } else if (key !== null) {
      buf += " " + line.trim();
    }
  }
  if (key !== null) out[key] = buf.trim();
  // strip surrounding quotes
  for (const k of Object.keys(out)) {
    out[k] = out[k].replace(/^["']|["']$/g, "");
  }
  return out;
}

function safeListDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function which(cmd) {
  try {
    return execFileSync("which", [cmd], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function tryVersion(cmd) {
  for (const flag of ["--version", "-V", "-v", "version"]) {
    try {
      const out = execFileSync(cmd, [flag], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) return out.split("\n")[0].slice(0, 80);
    } catch {}
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────────
 * Pricing heuristic — based on category + source
 * ───────────────────────────────────────────────────────────────────── */
function suggestedPrice(category, source) {
  const base = {
    engineering: 0.15,
    web3: 0.2,
    blockchain: 0.2,
    research: 0.1,
    creative: 0.05,
    media: 0.08,
    office: 0.04,
    general: 0.03,
    devops: 0.06,
    security: 0.18,
    healthcare: 0.25,
    finance: 0.18,
  }[category] ?? 0.07;
  // marketplace skills 通常更专业，溢价 30%；path-binary 是基础设施，折 30%
  const mult =
    source === "marketplace-skill"
      ? 1.3
      : source === "path-binary"
      ? 0.7
      : source === "brew-formula"
      ? 0.8
      : 1.0;
  return Number((base * mult).toFixed(2));
}

function inferCategory(name, description = "") {
  const t = (name + " " + description).toLowerCase();
  if (/secur|auth|owasp|xss|sqli|crypto|attack/.test(t)) return "security";
  if (/erc|solidity|contract|chain|web3|defi|amm|evm/.test(t)) return "web3";
  if (/healthcare|hipaa|phi|clinical/.test(t)) return "healthcare";
  if (/billing|finance|payment|invoice|tariff/.test(t)) return "finance";
  if (/review|build|debug|refactor|test|architect|coding/.test(t)) return "engineering";
  if (/research|paper|search|exa|deep-research/.test(t)) return "research";
  if (/creative|writing|brand|content/.test(t)) return "creative";
  if (/video|image|audio|media|ffmpeg|pandoc/.test(t)) return "media";
  if (/deploy|docker|ci|cd|devops|harness/.test(t)) return "devops";
  if (/doc|sheet|email|messag|gmail|drive/.test(t)) return "office";
  return "general";
}

/* ─────────────────────────────────────────────────────────────────────
 * Source 1 — Claude Code subagents (~/.claude/agents/*.md)
 * ───────────────────────────────────────────────────────────────────── */
function detectClaudeAgents() {
  const out = [];
  for (const f of safeListDir(AGENTS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const path = join(AGENTS_DIR, f);
    const text = safeRead(path);
    if (!text) continue;
    const fm = parseFrontmatter(text);
    const name = fm.name || f.replace(/\.md$/, "");
    const description = (fm.description || "").slice(0, 280);
    const category = inferCategory(name, description);
    out.push({
      source: "claude-agent",
      id: `agent-${name}`,
      name: `${name.replace(/-/g, " ")} (subagent)`,
      cmd: name,
      cmdPath: path,
      category,
      description: description || "Claude Code subagent — runs in sandbox via Task tool.",
      suggestedPriceUsdc: suggestedPrice(category, "claude-agent"),
    });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * Source 2 — Anthropic skills (~/.claude/skills/<name>/SKILL.md)
 * ───────────────────────────────────────────────────────────────────── */
function detectClaudeSkills() {
  const out = [];
  for (const dir of safeListDir(SKILLS_DIR)) {
    const skillPath = join(SKILLS_DIR, dir);
    let st;
    try {
      st = statSync(skillPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillMdPath = join(skillPath, "SKILL.md");
    const text = safeRead(skillMdPath);
    if (!text) continue;
    const fm = parseFrontmatter(text);
    const name = fm.name || dir;
    const description = (fm.description || "").slice(0, 280);
    const category = inferCategory(name, description);
    out.push({
      source: "claude-skill",
      id: `skill-${name}`,
      name: `${name.replace(/-/g, " ")} (Anthropic skill)`,
      cmd: name,
      cmdPath: skillMdPath,
      category,
      description: description || "Anthropic Agent Skills format. Wraps a domain-specific workflow.",
      suggestedPriceUsdc: suggestedPrice(category, "claude-skill"),
    });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * Source 3 — Marketplace plugins (~/.claude/plugins/...)
 * ───────────────────────────────────────────────────────────────────── */
function detectMarketplaceSkills() {
  const out = [];
  // marketplaces / <m> / skills / <s> / SKILL.md
  for (const market of safeListDir(MARKETPLACES_DIR)) {
    const skillsRoot = join(MARKETPLACES_DIR, market, "skills");
    if (!existsSync(skillsRoot)) continue;
    for (const dir of safeListDir(skillsRoot)) {
      const skillMdPath = join(skillsRoot, dir, "SKILL.md");
      const text = safeRead(skillMdPath);
      if (!text) continue;
      const fm = parseFrontmatter(text);
      const name = fm.name || dir;
      const description = (fm.description || "").slice(0, 280);
      const category = inferCategory(name, description);
      out.push({
        source: "marketplace-skill",
        id: `${market}/${name}`,
        name: `${name.replace(/-/g, " ")} (${market})`,
        cmd: name,
        cmdPath: skillMdPath,
        category,
        marketplace: market,
        description: description || "Marketplace-installed skill.",
        suggestedPriceUsdc: suggestedPrice(category, "marketplace-skill"),
      });
    }
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * Source 4 — PATH binaries (v1 logic, kept)
 * ───────────────────────────────────────────────────────────────────── */
const PATH_CATALOG = [
  { cmd: "claude",   id: "claude-cli",     name: "Claude Code CLI",   category: "engineering" },
  { cmd: "codex",    id: "codex-cli",      name: "OpenAI Codex CLI",  category: "engineering" },
  { cmd: "cursor",   id: "cursor-cli",     name: "Cursor CLI",        category: "engineering" },
  { cmd: "gemini",   id: "gemini-cli",     name: "Gemini CLI",        category: "engineering" },
  { cmd: "forge",    id: "forge-test",     name: "Forge test runner", category: "web3" },
  { cmd: "cast",     id: "cast-decode",    name: "EVM calldata decoder", category: "blockchain" },
  { cmd: "ffmpeg",   id: "ffmpeg",         name: "Media transcoder",  category: "media" },
  { cmd: "pandoc",   id: "pandoc",         name: "Document convert",  category: "office" },
  { cmd: "convert",  id: "imagemagick",    name: "Image processor",   category: "media" },
  { cmd: "yt-dlp",   id: "yt-dlp",         name: "Video extractor",   category: "media" },
  { cmd: "gh",       id: "gh-search",      name: "GitHub code search",category: "research" },
  { cmd: "jq",       id: "jq-query",       name: "JSON query",        category: "general" },
  { cmd: "python3",  id: "python-exec",    name: "Python sandbox",    category: "engineering" },
  { cmd: "rustc",    id: "rust-check",     name: "Rust compile check",category: "engineering" },
  { cmd: "docker",   id: "docker-run",     name: "Docker container runner", category: "devops" },
  { cmd: "git",      id: "git-archeology", name: "Git history search",category: "research" },
];
function detectPathBinaries() {
  const out = [];
  for (const c of PATH_CATALOG) {
    const path = which(c.cmd);
    if (!path) continue;
    const ver = tryVersion(c.cmd);
    out.push({
      source: "path-binary",
      id: c.id,
      name: c.name,
      cmd: c.cmd,
      cmdPath: path,
      cmdVersion: ver,
      category: c.category,
      description: `Local ${c.name} CLI — register a paid endpoint that proxies user input through this binary.`,
      suggestedPriceUsdc: suggestedPrice(c.category, "path-binary"),
    });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * Source 5 — brew formulae we know map to demo skills
 * ───────────────────────────────────────────────────────────────────── */
function detectBrewFormulae() {
  let formulae = [];
  try {
    const out = execFileSync("brew", ["list", "--formula"], { encoding: "utf8" });
    formulae = out.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
  // 用户已经有 brew 装了哪些"有 demo 价值"的工具？取交集
  const interesting = new Set([
    "ffmpeg", "pandoc", "imagemagick", "yt-dlp", "jq", "exiftool",
    "tesseract", "poppler", "qrencode", "graphviz", "tree", "ripgrep",
    "fd", "bat", "fzf", "duckdb", "sqlite", "redis", "postgresql@15",
  ]);
  const out = [];
  for (const f of formulae) {
    if (!interesting.has(f)) continue;
    const cat = inferCategory(f);
    out.push({
      source: "brew-formula",
      id: `brew-${f}`,
      name: `${f} (brew)`,
      cmd: f,
      cmdPath: which(f) || `brew:${f}`,
      category: cat,
      description: `Homebrew-installed ${f}. Registerable as a paid endpoint that wraps it.`,
      suggestedPriceUsdc: suggestedPrice(cat, "brew-formula"),
    });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * Pneuma state
 * ───────────────────────────────────────────────────────────────────── */
function pneumaStatus() {
  const pneumaPath = which("pneuma");
  const keysPath = join(HOME, ".pneuma", "keys.json");
  const hasKeys = existsSync(keysPath);
  return {
    cliInstalled: !!pneumaPath,
    cliPath: pneumaPath,
    keysFilePresent: hasKeys,
    keysFilePath: keysPath,
    hint: pneumaPath
      ? hasKeys
        ? "Pneuma CLI ready. Run `pneuma keys list` to confirm wallet."
        : "Pneuma CLI installed but no wallets. Run `pneuma keys add -l main -k 0x...`."
      : "Pneuma CLI not installed. Install with: npm install -g @pneuma/cli",
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Main
 * ───────────────────────────────────────────────────────────────────── */
const sources = {
  "claude-agent": detectClaudeAgents(),
  "claude-skill": detectClaudeSkills(),
  "marketplace-skill": detectMarketplaceSkills(),
  "path-binary": detectPathBinaries(),
  "brew-formula": detectBrewFormulae(),
};

let allCandidates = Object.values(sources).flat();

if (ARG_SOURCE) {
  allCandidates = allCandidates.filter((c) => c.source === ARG_SOURCE);
}

if (ARG_FULL_ID) {
  const hit = allCandidates.find((c) => c.id === ARG_FULL_ID);
  if (!hit) {
    console.log(JSON.stringify({ ok: false, error: `no candidate with id=${ARG_FULL_ID}` }));
    process.exit(1);
  }
  const full = hit.cmdPath && hit.cmdPath.endsWith(".md") ? safeRead(hit.cmdPath) : null;
  console.log(JSON.stringify({ ok: true, candidate: hit, fullText: full }, null, 2));
  process.exit(0);
}

// --packs: list available packs (no detection needed beyond catalog metadata)
if (ARG_LIST_PACKS) {
  const out = Object.entries(PRESET_PACKS).map(([key, p]) => ({
    pack: key,
    title: p.title,
    blurb: p.blurb,
    cap: p.cap ?? p.explicit?.length ?? null,
    strategy: p.explicit ? "explicit" : "filter",
  }));
  if (ARG_JSON) {
    console.log(JSON.stringify({ ok: true, packs: out }, null, 2));
  } else {
    console.log(`\nAvailable packs (use --pack=<name>):\n`);
    for (const p of out) {
      console.log(`── ${p.pack.padEnd(20)} cap=${p.cap}  ──`);
      console.log(`   ${p.title}`);
      console.log(`   ${p.blurb}\n`);
    }
  }
  process.exit(0);
}

// --pack=<name>: pre-filter candidates to that pack's intersection with the live machine
if (ARG_PACK) {
  const pack = PRESET_PACKS[ARG_PACK];
  if (!pack) {
    console.log(
      JSON.stringify({
        ok: false,
        error: `unknown pack=${ARG_PACK}`,
        availablePacks: Object.keys(PRESET_PACKS),
      })
    );
    process.exit(1);
  }
  let picked;
  if (pack.explicit) {
    const want = new Set(pack.explicit);
    picked = allCandidates.filter((c) => want.has(c.id));
    // 报告 explicit pack 里有哪些 id 本机没装
    const missing = pack.explicit.filter((id) => !allCandidates.find((c) => c.id === id));
    if (missing.length > 0 && !ARG_JSON) {
      console.error(`[note] pack "${ARG_PACK}" defines ${pack.explicit.length} ids; ${missing.length} not found locally: ${missing.join(", ")}`);
    }
  } else {
    picked = allCandidates.filter(pack.filter);
    picked = picked.sort((a, b) => b.suggestedPriceUsdc - a.suggestedPriceUsdc).slice(0, pack.cap ?? 10);
  }
  const totalCost = picked.reduce((sum, c) => sum + c.suggestedPriceUsdc, 0);
  const result = {
    ok: true,
    pack: ARG_PACK,
    title: pack.title,
    blurb: pack.blurb,
    selected: picked,
    selectedCount: picked.length,
    estTotalRevenuePerCallUsdc: Number(totalCost.toFixed(2)),
  };
  if (ARG_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n${pack.title}\n${pack.blurb}\n`);
    console.log(`Selected ${picked.length} candidates from this machine:\n`);
    for (const c of picked) {
      console.log(
        `  · ${c.id.padEnd(46)} $${c.suggestedPriceUsdc} USDC   [${c.source} / ${c.category}]`
      );
    }
    console.log(`\nEst aggregate revenue per full sweep: $${totalCost.toFixed(2)} USDC`);
    console.log(`\nNext: register them all with one command:`);
    console.log(`  node scripts/register-skills.mjs --pack=${ARG_PACK}`);
    console.log(`(or pass --ids=${picked.map((c) => c.id).slice(0, 3).join(",")},… to register-skills.mjs to register specific ones)`);
  }
  process.exit(0);
}

// --top=<N>: shortcut "give me the N highest-priced candidates per source"
if (ARG_TOP > 0) {
  const grouped = {};
  for (const c of allCandidates) {
    grouped[c.source] = grouped[c.source] || [];
    grouped[c.source].push(c);
  }
  const picked = [];
  for (const [src, list] of Object.entries(grouped)) {
    list.sort((a, b) => b.suggestedPriceUsdc - a.suggestedPriceUsdc);
    picked.push(...list.slice(0, ARG_TOP));
  }
  if (ARG_JSON) {
    console.log(JSON.stringify({ ok: true, mode: "top-per-source", n: ARG_TOP, candidates: picked }, null, 2));
  } else {
    console.log(`\nTop ${ARG_TOP} per source (${picked.length} total):\n`);
    for (const c of picked) {
      console.log(
        `  · ${c.id.padEnd(46)} $${c.suggestedPriceUsdc} USDC   [${c.source} / ${c.category}]`
      );
    }
  }
  process.exit(0);
}

const result = {
  ok: true,
  detectedAt: new Date().toISOString(),
  platform: platform(),
  pneuma: pneumaStatus(),
  sourceCounts: Object.fromEntries(
    Object.entries(sources).map(([k, v]) => [k, v.length])
  ),
  totalCandidates: allCandidates.length,
  candidates: allCandidates,
};

if (ARG_JSON) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\nPneuma skill scanner v2 — ${result.detectedAt}`);
  console.log(`Pneuma CLI: ${result.pneuma.cliInstalled ? "✓ installed" : "✗ NOT installed"}`);
  console.log(`Keys file:  ${result.pneuma.keysFilePresent ? "✓ " + result.pneuma.keysFilePath : "✗ no wallets"}`);
  console.log();
  console.log(`Total registerable skill candidates: ${result.totalCandidates}\n`);
  for (const [src, list] of Object.entries(sources)) {
    if (list.length === 0) continue;
    console.log(`── ${src.padEnd(20)} ${list.length} found ──`);
    const sample = list.slice(0, 8);
    for (const c of sample) {
      console.log(
        `   · ${c.id.padEnd(46)} ${("$" + c.suggestedPriceUsdc + " USDC").padEnd(13)} [${c.category}]`
      );
    }
    if (list.length > sample.length) {
      console.log(`   … and ${list.length - sample.length} more (use --json or --source=${src} to see all)`);
    }
    console.log();
  }
  console.log("Re-run with --json for full machine-readable output.");
  console.log("Or filter:  --source=claude-agent | claude-skill | marketplace-skill | path-binary | brew-formula");
}
