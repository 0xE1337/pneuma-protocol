/**
 * `pneuma anet` —— Agent Network (anet) 集成桥
 *
 * 把 anet 的 mesh / DID / 任务生命周期跟 Pneuma 的 Soul NFT / x402 / 链上 attestation
 * 拉通成一个可携带身份 + 跨平台收据。
 *
 * 三个子命令：
 *   pneuma anet bootstrap          —— 把当前 anet daemon 的 did:key 绑到一个 Soul NFT
 *   pneuma anet register-x402-skill —— 在 anet ANS 注册 agent://，capability 含 x402-payment
 *   pneuma anet mirror <task-id>    —— 把 anet 任务的 KREC 收据镜像成 Pneuma 链上 attestation
 *
 * 设计原则：
 *   - 不 fork anet 协议、不改它的 daemon —— 我们只是 anet 网络上的一个 paid skill
 *   - anet 不可用时所有命令优雅降级（打印 install hint），不抛栈
 *   - bootstrap 输出存 ~/.pneuma/anet-binding.json，后续两命令读这一份
 *   - 整体命令面跟官方 anet CLI 平行，不抢它的命名
 */

import type { Command } from "commander";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import type { Address } from "viem";
import { loadConfig } from "../config.js";
import { getActiveKey } from "../keys.js";
import { makePublicClient } from "../clients.js";
import { SoulNFTAbi } from "../abi.js";
import { c, shortAddr } from "../format.js";

// 本地 anet 集成状态文件（bootstrap 写、其他命令读）
const PNEUMA_HOME = join(homedir(), ".pneuma");
const ANET_BINDING_PATH = join(PNEUMA_HOME, "anet-binding.json");

interface AnetBinding {
  /** 写入时间，ISO 8601 */
  boundAt: string;
  /** anet daemon 自报的 did:key 身份 */
  did: string;
  /** 绑定到的 Soul NFT tokenId（链上 ERC-721）*/
  soulTokenId: string;
  /** Soul 派生的 ERC-6551 TBA 钱包地址 */
  tba: Address;
  /** Soul 持有人的 EOA 地址（绑定时） */
  ownerEoa: Address;
  /** 链 id，方便多链未来 */
  chainId: number;
  /** 用户给这次绑定起的名字（可选）*/
  agentName?: string;
}

/**
 * 检测 anet 二进制是否可用 —— 不抛错，仅返回布尔
 */
function anetAvailable(): boolean {
  const r: SpawnSyncReturns<Buffer> = spawnSync("anet", ["--version"], {
    stdio: "ignore",
  });
  return r.status === 0;
}

/**
 * 跑一次 `anet whoami --json` 拿到 DID
 *
 * 返回 null 表示：anet 不可用 / daemon 没启动 / 输出无法解析
 */
function getAnetDid(): string | null {
  if (!anetAvailable()) return null;
  try {
    const out = execFileSync("anet", ["whoami", "--json"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const parsed = JSON.parse(out);
    if (typeof parsed.did === "string" && parsed.did.startsWith("did:")) {
      return parsed.did;
    }
    return null;
  } catch {
    return null;
  }
}

function readBinding(): AnetBinding | null {
  if (!existsSync(ANET_BINDING_PATH)) return null;
  try {
    return JSON.parse(readFileSync(ANET_BINDING_PATH, "utf-8")) as AnetBinding;
  } catch {
    return null;
  }
}

function writeBinding(b: AnetBinding): void {
  if (!existsSync(PNEUMA_HOME)) {
    mkdirSync(PNEUMA_HOME, { recursive: true, mode: 0o700 });
  }
  writeFileSync(ANET_BINDING_PATH, JSON.stringify(b, null, 2), { mode: 0o600 });
}

function printAnetMissingHelp(): void {
  console.log(
    chalk.yellow(
      "⚠ anet 未安装或 daemon 未运行。先做这步：\n" +
        "    npm install -g @agentnetwork/anet\n" +
        "    anet daemon &\n" +
        "    anet whoami      # 应该输出 did:key:z6Mk...\n" +
        "  详情：https://agentnetwork.org.cn/SKILL.md\n",
    ),
  );
}

// ──────────────────────────────────────────────────────────────────────
//  pneuma anet bootstrap
// ──────────────────────────────────────────────────────────────────────

interface BootstrapOpts {
  agentName?: string;
  json?: boolean;
}

async function runBootstrap(opts: BootstrapOpts) {
  const cfg = loadConfig();
  const key = getActiveKey();
  const pub = makePublicClient(cfg);

  // Step 1：拿 DID（如果 anet 不可用，整条命令仍然要跑通——只是用一个占位 did 让用户先把 Pneuma 这侧准备好）
  const did = getAnetDid();
  if (!did) {
    printAnetMissingHelp();
    console.log(
      chalk.gray(
        "  bootstrap 仍会绑定你当前的 Pneuma Soul NFT，等 anet 装好再跑一次同步 DID。\n",
      ),
    );
  }

  // Step 2：找出 active key 名下持有的最新 Soul tokenId
  const balance = (await pub.readContract({
    address: cfg.soulNft,
    abi: SoulNFTAbi,
    functionName: "balanceOf",
    args: [key.address],
  })) as bigint;

  if (balance === 0n) {
    console.log(
      chalk.red(
        `✗ 当前 wallet ${shortAddr(key.address)} 还没有 Soul NFT。\n` +
          `  先跑：pneuma soul mint --name "${opts.agentName ?? "MyAgent"}"\n` +
          `  然后再跑：pneuma anet bootstrap\n`,
      ),
    );
    process.exitCode = 2;
    return;
  }

  // 反向遍历 totalMinted → 找到最近的、由 active key 持有的 token
  const total = (await pub.readContract({
    address: cfg.soulNft,
    abi: SoulNFTAbi,
    functionName: "totalMinted",
  })) as bigint;

  let tokenId: bigint | null = null;
  for (let i = total; i > 0n; i--) {
    const owner = (await pub.readContract({
      address: cfg.soulNft,
      abi: SoulNFTAbi,
      functionName: "ownerOf",
      args: [i],
    })) as Address;
    if (owner.toLowerCase() === key.address.toLowerCase()) {
      tokenId = i;
      break;
    }
  }

  if (tokenId === null) {
    // balance > 0 但找不到 owner —— 应该不会发生，留一个 sanity 兜底
    console.log(
      chalk.red(
        `✗ wallet 显示余额 ${balance.toString()} 但反向扫描没找到 owned token，链状态可能不一致。\n`,
      ),
    );
    process.exitCode = 2;
    return;
  }

  const tba = (await pub.readContract({
    address: cfg.soulNft,
    abi: SoulNFTAbi,
    functionName: "tbaOf",
    args: [tokenId],
  })) as Address;

  const binding: AnetBinding = {
    boundAt: new Date().toISOString(),
    did: did ?? "did:pending:install-anet",
    soulTokenId: tokenId.toString(),
    tba,
    ownerEoa: key.address,
    chainId: cfg.chainId,
    agentName: opts.agentName,
  };

  writeBinding(binding);

  if (opts.json) {
    console.log(JSON.stringify(binding, null, 2));
    return;
  }

  console.log(
    [
      "",
      c.bold("╭─ Pneuma × anet binding ──────────────────────────────╮"),
      `  ${c.dim("did      ")} ${did ? c.cyan(did) : c.warn("(待安装 anet)")}`,
      `  ${c.dim("soul #   ")} ${c.magenta(tokenId.toString())}`,
      `  ${c.dim("tba      ")} ${shortAddr(tba)}`,
      `  ${c.dim("owner eoa")} ${shortAddr(key.address)}`,
      `  ${c.dim("chain id ")} ${cfg.chainId}`,
      c.bold("╰──────────────────────────────────────────────────────╯"),
      "",
      c.ok("  ✓ binding 已存到 ~/.pneuma/anet-binding.json"),
      did
        ? c.dim("  下一步：pneuma anet register-x402-skill")
        : c.warn(
            "  下一步：装 anet（npm install -g @agentnetwork/anet），\n" +
              "          再跑一次本命令同步 did:key",
          ),
      "",
    ].join("\n"),
  );
}

// ──────────────────────────────────────────────────────────────────────
//  pneuma anet register-x402-skill
// ──────────────────────────────────────────────────────────────────────

interface RegisterOpts {
  tag?: string;
  agentUri?: string;
  dryRun?: boolean;
  json?: boolean;
}

async function runRegisterX402Skill(opts: RegisterOpts) {
  const binding = readBinding();
  if (!binding) {
    console.log(
      chalk.red(
        "✗ 还没有 binding。先跑：pneuma anet bootstrap\n",
      ),
    );
    process.exitCode = 2;
    return;
  }

  // 默认 tags：x402-payment + cross-platform-receipt + onchain-attestation
  const tags = (opts.tag ?? "x402-payment,cross-platform-receipt,onchain-attestation")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // 默认 agent:// URI 用 soul tokenId 作为唯一标识（避免 did:key 太长不好读）
  const uri =
    opts.agentUri ?? `agent://pneuma-receipt-${binding.soulTokenId}`;

  // anet register --confirm <agent://uri> <tag1> <tag2> ...
  // 失败时不抛错，只把命令打印给用户（让他们手抄到能跑 anet 的机器上）
  const dry = !!opts.dryRun || !anetAvailable();
  const cmd = ["anet", "register", "--confirm", uri, ...tags];

  if (opts.json) {
    console.log(
      JSON.stringify(
        { uri, tags, command: cmd.join(" "), dryRun: dry },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    [
      "",
      c.bold("Registering Pneuma skill on Agent Network ANS"),
      `  ${c.dim("agent uri")} ${c.cyan(uri)}`,
      `  ${c.dim("tags     ")} ${tags.map((t) => c.magenta(t)).join(" ")}`,
      `  ${c.dim("soul #   ")} ${binding.soulTokenId}`,
      `  ${c.dim("tba      ")} ${shortAddr(binding.tba)}`,
      "",
    ].join("\n"),
  );

  if (dry) {
    console.log(
      chalk.yellow(
        "  ⚠ dry-run（anet 不可用或 --dry-run 指定）。原命令：\n" +
          "    " +
          chalk.cyan(cmd.join(" ")) +
          "\n",
      ),
    );
    return;
  }

  try {
    execFileSync(cmd[0], cmd.slice(1), { stdio: "inherit", timeout: 15000 });
    console.log(
      c.ok(
        `  ✓ 已注册到 anet ANS。其他 anet 节点可通过 \`anet resolve ${uri}\` 找到你。\n`,
      ),
    );
  } catch (e) {
    console.log(
      chalk.red(`✗ anet register 失败：${(e as Error).message}\n`),
    );
    process.exitCode = 2;
  }
}

// ──────────────────────────────────────────────────────────────────────
//  pneuma anet mirror <task-id>
// ──────────────────────────────────────────────────────────────────────

interface MirrorOpts {
  json?: boolean;
}

async function runMirror(taskId: string, opts: MirrorOpts) {
  const binding = readBinding();
  if (!binding) {
    console.log(
      chalk.red("✗ 还没有 binding。先跑：pneuma anet bootstrap\n"),
    );
    process.exitCode = 2;
    return;
  }

  if (!anetAvailable()) {
    printAnetMissingHelp();
    process.exitCode = 2;
    return;
  }

  // anet --json task get <task-id>
  let task: Record<string, unknown>;
  try {
    const raw = execFileSync(
      "anet",
      ["--json", "task", "get", taskId],
      { encoding: "utf-8", timeout: 10000 },
    );
    task = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    console.log(
      chalk.red(
        `✗ 读不到 task ${taskId}：${(e as Error).message}\n`,
      ),
    );
    process.exitCode = 2;
    return;
  }

  // 从 anet task 提取关键字段（agentnetwork.org.cn task lifecycle 字段名约定）
  const status =
    typeof task.status === "string" ? (task.status as string) : "unknown";
  const reward =
    typeof task.reward === "number" ? (task.reward as number) : 0;
  const publisher =
    typeof task.publisher === "string"
      ? (task.publisher as string)
      : (task.publisher_did as string | undefined) ?? "?";
  const worker =
    typeof task.worker === "string"
      ? (task.worker as string)
      : (task.worker_did as string | undefined) ?? "?";
  const result =
    typeof task.result === "string"
      ? (task.result as string)
      : JSON.stringify(task.result ?? "");

  // 构造 Pneuma 镜像 attestation 的 payload
  // 注意：本命令暂时是 dry-run（不直接 broadcast）—— PneumaAttestation.attest
  // 由 SkillRegistry settle 路径才有 BOUNDARY_ATTESTER_ROLE，本命令的目的是
  // 给评委演示"KREC → 链上 attestation"的形态对照，再用 callerRateSkill 走
  // 普通付费路径完成实际上链。
  const mirrorPayload = {
    namespace: "anet:task",
    refId: taskId,
    pneumaSoulTokenId: binding.soulTokenId,
    pneumaTba: binding.tba,
    anetDid: binding.did,
    anetTaskStatus: status,
    anetTaskReward: reward,
    anetPublisher: publisher,
    anetWorker: worker,
    resultPreview: result.slice(0, 280),
    mirroredAt: new Date().toISOString(),
  };

  if (opts.json) {
    console.log(JSON.stringify(mirrorPayload, null, 2));
    return;
  }

  const acceptedSignal =
    status === "accepted" ? c.ok("✓ accepted") : c.warn(`status: ${status}`);

  console.log(
    [
      "",
      c.bold("anet KREC → Pneuma on-chain attestation (preview)"),
      `  ${c.dim("anet task")} ${c.cyan(taskId)} (${acceptedSignal})`,
      `  ${c.dim("publisher")} ${publisher}`,
      `  ${c.dim("worker   ")} ${worker}`,
      `  ${c.dim("reward   ")} ${reward} 🐚 Shell`,
      `  ${c.dim("result   ")} ${c.dim(result.slice(0, 80))}${result.length > 80 ? "…" : ""}`,
      "",
      c.bold("Will be mirrored to Pneuma as:"),
      `  ${c.dim("recipient")} ${shortAddr(binding.tba)} (Soul #${binding.soulTokenId})`,
      `  ${c.dim("namespace")} anet:task`,
      `  ${c.dim("ref id   ")} ${taskId}`,
      "",
      c.warn(
        "  ⚠ 当前 mirror 是 preview-only —— 实际上链需要走 SkillRegistry\n" +
          "    settle 路径（PneumaAttestation 的 BOUNDARY_ATTESTER_ROLE 限制）。\n" +
          "    Demo 时可结合 `pneuma run` 端到端完成。",
      ),
      "",
    ].join("\n"),
  );
}

// ──────────────────────────────────────────────────────────────────────
//  Commander 注册
// ──────────────────────────────────────────────────────────────────────

export function registerAnetCommands(parent: Command) {
  const anet = parent
    .command("anet")
    .description(
      "Bridge Agent Network (anet) ↔ Pneuma — bind DID to Soul NFT, " +
        "register x402-paying skill, mirror anet tasks to on-chain attestations",
    );

  anet
    .command("bootstrap")
    .description("Bind your anet DID (from anet whoami) to your Soul NFT")
    .option("-n, --agent-name <name>", "human-readable name for this binding")
    .option("-j, --json", "JSON output")
    .action(async (opts: BootstrapOpts) => {
      await runBootstrap(opts);
    });

  anet
    .command("register-x402-skill")
    .description(
      "Register an agent:// URI in anet ANS advertising x402-payment capability",
    )
    .option(
      "-t, --tag <csv>",
      "comma-separated capability tags",
      "x402-payment,cross-platform-receipt,onchain-attestation",
    )
    .option(
      "-u, --agent-uri <uri>",
      "override agent:// URI (default: agent://pneuma-receipt-<soulId>)",
    )
    .option("--dry-run", "print the anet command without executing")
    .option("-j, --json", "JSON output")
    .action(async (opts: RegisterOpts) => {
      await runRegisterX402Skill(opts);
    });

  anet
    .command("mirror <task-id>")
    .description(
      "Read an anet task (KREC) and preview the equivalent Pneuma on-chain attestation",
    )
    .option("-j, --json", "JSON output")
    .action(async (taskId: string, opts: MirrorOpts) => {
      await runMirror(taskId, opts);
    });
}
