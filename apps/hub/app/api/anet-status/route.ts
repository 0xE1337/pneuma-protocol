/**
 * GET /api/anet-status
 *
 * 把 ~/.pneuma/anet-binding.json + `anet whoami` 的状态暴露给前端，
 * 让 UI 能渲染真实的"anet daemon connected / not connected"徽章
 * + Soul × did:key 当前绑定关系。
 *
 * 注意：本路由读服务端进程的 home dir。在 hackathon 现场 demo 时
 * laptop 同时跑 hub + anet daemon，二者共享同一个 ~/.pneuma/，
 * 所以读取语义自然成立。生产远程部署需要改成 cookie/会话存储。
 *
 * Response shape (永不抛错，全部用 status 表达失败模式)：
 *   {
 *     binding: { did, soulTokenId, tba, ownerEoa, chainId, boundAt } | null,
 *     anetDaemon: "connected" | "not_installed" | "not_running",
 *     anetDid:    string | null,   // anet 实时 whoami 拿到的 DID（可能跟 binding 不一致）
 *     checkedAt:  ISO timestamp
 *   }
 */

import type { NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// 不缓存 —— UI 拉一次就反映当前真实状态
export const dynamic = "force-dynamic";

interface AnetBinding {
  boundAt?: string;
  did?: string;
  soulTokenId?: string;
  tba?: string;
  ownerEoa?: string;
  chainId?: number;
  agentName?: string;
}

type DaemonStatus = "connected" | "not_installed" | "not_running";

function readBinding(): AnetBinding | null {
  const path = join(homedir(), ".pneuma", "anet-binding.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return raw as AnetBinding;
  } catch {
    return null;
  }
}

function probeAnet(): { status: DaemonStatus; did: string | null } {
  // Step 1: anet binary 是否在 PATH
  const versionCheck = spawnSync("anet", ["--version"], { stdio: "ignore" });
  if (versionCheck.status !== 0) {
    return { status: "not_installed", did: null };
  }

  // Step 2: daemon 是否能响应 whoami（5 秒超时防卡死）
  try {
    const out = execFileSync("anet", ["whoami", "--json"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const parsed = JSON.parse(out);
    if (typeof parsed.did === "string" && parsed.did.startsWith("did:")) {
      return { status: "connected", did: parsed.did };
    }
    // anet 装了但输出格式异常 —— 当 not_running 处理
    return { status: "not_running", did: null };
  } catch {
    return { status: "not_running", did: null };
  }
}

export async function GET(_req: NextRequest) {
  const binding = readBinding();
  const probe = probeAnet();

  const body = {
    binding,
    anetDaemon: probe.status,
    anetDid: probe.did,
    checkedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
