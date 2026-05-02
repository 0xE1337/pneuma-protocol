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
  // Read full source (for claude-agent / skill, the markdown)
  const full = hit.cmdPath && hit.cmdPath.endsWith(".md") ? safeRead(hit.cmdPath) : null;
  console.log(JSON.stringify({ ok: true, candidate: hit, fullText: full }, null, 2));
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
