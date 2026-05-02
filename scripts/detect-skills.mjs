#!/usr/bin/env node
/**
 * scripts/detect-skills.mjs
 *
 * 扫描用户机器 PATH 上有什么 AI / 开发 / 媒体工具，把每一个映射成一个
 * "推荐注册的 Pneuma skill"。让 AI agent 拿到这个 JSON 后一眼给用户一份
 * 候选清单，零猜测。
 *
 * 用法：
 *   node scripts/detect-skills.mjs              # 人类可读输出
 *   node scripts/detect-skills.mjs --json       # AI 直接 parse 的 JSON
 *
 * 输出 shape (--json)：
 *   {
 *     ok: true,
 *     detectedAt: "2026-05-02T...",
 *     platform: "darwin" | "linux" | ...,
 *     candidates: [
 *       {
 *         id: "code-review-claude",
 *         name: "Claude Code Review",
 *         cmd: "claude",
 *         cmdPath: "/opt/homebrew/bin/claude",
 *         category: "engineering",
 *         description: "Senior code review on a git diff via local Claude CLI.",
 *         suggestedPriceUsdc: 0.15,
 *         systemPromptHint: "...",
 *         requires: ["claude --version"]
 *       },
 *       ...
 *     ]
 *   }
 *
 * 不写任何文件，不联网，不需要密钥。纯 PATH 探测。
 */

import { execFileSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { existsSync } from "node:fs";

const ARG_JSON = process.argv.includes("--json");

/* ─────────────────────────────────────────────────────────────────────
 * Skill catalog —— 每个本机 CLI 工具映射到 1-2 个推荐 skill
 * 价格是参考，用户最终决定。
 * ───────────────────────────────────────────────────────────────────── */
const CATALOG = [
  // —— AI CLIs ——
  {
    id: "code-review-claude",
    name: "Claude Code Review",
    cmd: "claude",
    category: "engineering",
    description:
      "Senior code review on a git diff. Returns severity-binned findings (critical / high / medium / suggestion) with file + line hints + fix suggestions. Powered by user's local Claude Code subscription (no API key needed).",
    suggestedPriceUsdc: 0.15,
    systemPromptHint:
      "你是一个资深 code reviewer，针对 caller 提交的 git diff 给出严苛评审。",
  },
  {
    id: "creative-write-claude",
    name: "Creative Write",
    cmd: "claude",
    category: "creative",
    description:
      "Generate slogan / tagline / blog hook / product copy in chosen genre + tone + language. Cheap (0.05 USDC) for rapid iteration.",
    suggestedPriceUsdc: 0.05,
    systemPromptHint: "你是一个创意写作 agent。",
  },
  {
    id: "paper-summary-claude",
    name: "Paper Summary",
    cmd: "claude",
    category: "research",
    description:
      "Compress an academic paper to bilingual TL;DR + 3 contributions + downstream-citation hints. Caller passes title + abstract; output is structured JSON.",
    suggestedPriceUsdc: 0.1,
    systemPromptHint:
      "你是一个学术 agent，专门把论文摘要压缩成结构化卡。",
  },
  {
    id: "block-explainer-claude",
    name: "Block Explainer",
    cmd: "claude",
    category: "blockchain",
    description:
      "Plain-language explanation of an on-chain tx receipt — narrative + parties + value flow + status. Caller provides receipt JSON.",
    suggestedPriceUsdc: 0.2,
    systemPromptHint:
      "你是一个区块链 explainer agent，把 tx receipt JSON 翻译成给非技术用户看的人话。",
  },
  {
    id: "quick-reasoning-claude",
    name: "Quick Reasoning",
    cmd: "claude",
    category: "general",
    description:
      "Cheap one-shot reasoning. Agent answers a question directly with self-rated confidence. Says 'I don't know' instead of fabricating.",
    suggestedPriceUsdc: 0.03,
    systemPromptHint:
      "你是一个事实导向的 reasoning agent。",
  },

  // —— Codex / Cursor / OpenAI 风 CLI ——
  {
    id: "code-review-codex",
    name: "Codex Code Review",
    cmd: "codex",
    category: "engineering",
    description:
      "Code review via local OpenAI Codex CLI (if installed). Alternative engine to claude.",
    suggestedPriceUsdc: 0.12,
  },
  {
    id: "cursor-refactor",
    name: "Cursor Refactor",
    cmd: "cursor",
    category: "engineering",
    description:
      "Refactor a snippet via local Cursor CLI. Returns rewritten code + rationale.",
    suggestedPriceUsdc: 0.1,
  },

  // —— Solidity / Web3 工具 ——
  {
    id: "forge-test",
    name: "Forge Test Runner",
    cmd: "forge",
    category: "web3-dev",
    description:
      "Run forge test on a Solidity snippet caller submits. Returns pass/fail + gas report. Pure CI helper, no network needed.",
    suggestedPriceUsdc: 0.05,
  },
  {
    id: "cast-decode",
    name: "EVM Calldata Decoder",
    cmd: "cast",
    category: "blockchain",
    description:
      "Decode arbitrary EVM calldata into function name + named args. Local foundry-cast based.",
    suggestedPriceUsdc: 0.02,
  },

  // —— 文档 / 数据 / 媒体处理 ——
  {
    id: "ffmpeg-transcode",
    name: "Media Transcoder",
    cmd: "ffmpeg",
    category: "media",
    description:
      "Transcode audio/video between formats / resolutions / codecs. Caller submits a URL or base64 blob.",
    suggestedPriceUsdc: 0.08,
  },
  {
    id: "pandoc-convert",
    name: "Document Convert",
    cmd: "pandoc",
    category: "office",
    description:
      "Convert between markdown / docx / html / pdf via pandoc.",
    suggestedPriceUsdc: 0.04,
  },
  {
    id: "imagemagick-process",
    name: "Image Processor",
    cmd: "convert",
    category: "media",
    description:
      "Resize / crop / format-convert images via ImageMagick.",
    suggestedPriceUsdc: 0.03,
  },
  {
    id: "yt-dlp-download",
    name: "Video Source Extractor",
    cmd: "yt-dlp",
    category: "media",
    description:
      "Extract direct media URL + metadata (title / duration / thumbnails) from any youtube-dl-supported site.",
    suggestedPriceUsdc: 0.05,
  },

  // —— Dev / shell tools ——
  {
    id: "gh-search",
    name: "GitHub Code Search",
    cmd: "gh",
    category: "research",
    description:
      "Search github via gh search code/repos. Returns ranked matches with snippets.",
    suggestedPriceUsdc: 0.03,
  },
  {
    id: "jq-query",
    name: "JSON Query",
    cmd: "jq",
    category: "general",
    description:
      "Run a jq filter on a JSON payload. Cheap utility for non-jq-savvy callers.",
    suggestedPriceUsdc: 0.01,
  },

  // —— Python / Rust / 编译器（让有这些的开发者注册更深的能力） ——
  {
    id: "python-exec",
    name: "Python Sandbox Exec",
    cmd: "python3",
    category: "engineering",
    description:
      "Run a self-contained Python snippet (stdlib only, sandboxed) and return stdout. Useful for quick numeric / data tasks.",
    suggestedPriceUsdc: 0.06,
  },
  {
    id: "rust-compile-check",
    name: "Rust Compile Check",
    cmd: "rustc",
    category: "engineering",
    description:
      "rustc --emit=metadata on caller-submitted code: returns pass/fail + diagnostics.",
    suggestedPriceUsdc: 0.05,
  },
];

/* ─────────────────────────────────────────────────────────────────────
 * 探测：每个 CLI 用 `which` + `--version` 验真活
 * ───────────────────────────────────────────────────────────────────── */
function which(cmd) {
  try {
    const out = execFileSync("which", [cmd], { encoding: "utf8" }).trim();
    return out || null;
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

const seen = new Map(); // cmd → cmdPath cache
function probeCmd(cmd) {
  if (seen.has(cmd)) return seen.get(cmd);
  const cmdPath = which(cmd);
  const version = cmdPath ? tryVersion(cmd) : null;
  const result = cmdPath ? { cmdPath, version } : null;
  seen.set(cmd, result);
  return result;
}

/* ─────────────────────────────────────────────────────────────────────
 * Pneuma 状态：是否装了 cli + 有 keys + 有 Soul
 * ───────────────────────────────────────────────────────────────────── */
function pneumaStatus() {
  const pneumaPath = which("pneuma");
  const keysPath = `${homedir()}/.pneuma/keys.json`;
  const hasKeys = existsSync(keysPath);
  return {
    cliInstalled: !!pneumaPath,
    cliPath: pneumaPath,
    keysFilePresent: hasKeys,
    keysFilePath: keysPath,
    hint: pneumaPath
      ? hasKeys
        ? "Pneuma CLI ready. You may already have wallets — run `pneuma keys list`."
        : "Pneuma CLI installed but no wallets yet. Run `pneuma keys add -l main -k 0x...` (or generate one)."
      : "Pneuma CLI not installed. Install with: npm install -g @pneuma/cli",
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * 主流程
 * ───────────────────────────────────────────────────────────────────── */
const candidates = [];
for (const skill of CATALOG) {
  const probe = probeCmd(skill.cmd);
  if (!probe) continue;
  candidates.push({
    ...skill,
    cmdPath: probe.cmdPath,
    cmdVersion: probe.version,
  });
}

const result = {
  ok: true,
  detectedAt: new Date().toISOString(),
  platform: platform(),
  pneuma: pneumaStatus(),
  candidates,
  totalCandidates: candidates.length,
};

if (ARG_JSON) {
  console.log(JSON.stringify(result, null, 2));
} else {
  // 人类可读
  console.log(`\nPneuma skill scanner — ${result.detectedAt}\n`);
  console.log(`Pneuma CLI: ${result.pneuma.cliInstalled ? "✓ installed" : "✗ NOT installed"}`);
  console.log(`Keys file:  ${result.pneuma.keysFilePresent ? "✓ " + result.pneuma.keysFilePath : "✗ no wallets yet"}`);
  console.log();
  if (candidates.length === 0) {
    console.log("No registerable skills detected on PATH.");
    console.log("Install one of: claude, codex, cursor, forge, ffmpeg, pandoc, gh, python3, rustc, ...");
  } else {
    console.log(`Found ${candidates.length} registerable skill candidate(s):\n`);
    for (const c of candidates) {
      console.log(`  · ${c.id.padEnd(28)} ${("$" + c.suggestedPriceUsdc + " USDC").padEnd(14)} (${c.cmd})`);
    }
    console.log();
    console.log("Re-run with --json to feed this list to your AI agent.");
  }
}
