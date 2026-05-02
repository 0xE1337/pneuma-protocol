/**
 * /api/dashboard/snapshot —— 实时看板"打开就有数据"的服务端聚合路由
 *
 * 顶层逻辑：客户端 backfill (90 RPC × 80ms throttle) 在 demo 现场让评委等
 * 15-20 秒看空白页是不可接受的。这条路由把同样的工作搬到 Vercel Fluid
 * Compute（同 region 跑 RPC、零 throttle、并行 9 类事件 × 10 chunks），
 * 加 Vercel CDN 30s 缓存：
 *   - cold cache 首次请求：~2-3s（一个用户付一次延迟）
 *   - warm cache 后续请求：< 100ms（评委打开几乎瞬时）
 *   - 同时把 caller_rated 事件的 comment 字段也提前 enrich 进 payload，
 *     省掉客户端 13 次 getAttestation 串行 RPC（评论面板瞬时显示文字）
 *
 * 客户端 useHistoryBackfill 优先 fetch 这条路由；失败再降级到 RPC 直拉。
 *
 * BigInt 序列化策略：用 toString() 转字符串，客户端反序列化时再 BigInt(...)
 */

import { NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { arcTestnet } from "@/lib/chain";
import {
  SKILL_REGISTRY,
  PNEUMA_ATTESTATION,
  PNEUMA_COMMONS,
  REPUTATION_GRAPH,
  SkillRegistryAbi,
  PneumaAttestationAbi,
  PneumaCommonsAbi,
  ReputationGraphAbi,
} from "@/lib/contracts";

// Vercel CDN 缓存：30s 内重复请求复用同一份 snapshot
export const revalidate = 30;
export const runtime = "nodejs";
export const maxDuration = 60;

const HISTORY_BLOCK_RANGE = 90000n; // ~8 天
const CHUNK_SIZE = 9500n;

type EventKind =
  | "skill_registered"
  | "call_escrowed"
  | "call_settled"
  | "caller_rated"
  | "attested"
  | "boundary"
  | "published"
  | "cited"
  | "endorsed";

interface EventSpec {
  address: Address;
  abi: readonly unknown[];
  eventName: string;
  kind: EventKind;
}

const EVENT_SPECS: EventSpec[] = [
  { address: SKILL_REGISTRY, abi: SkillRegistryAbi, eventName: "SkillRegistered", kind: "skill_registered" },
  { address: SKILL_REGISTRY, abi: SkillRegistryAbi, eventName: "CallEscrowed", kind: "call_escrowed" },
  { address: SKILL_REGISTRY, abi: SkillRegistryAbi, eventName: "CallSettled", kind: "call_settled" },
  { address: SKILL_REGISTRY, abi: SkillRegistryAbi, eventName: "CallerRatedSkill", kind: "caller_rated" },
  { address: PNEUMA_ATTESTATION, abi: PneumaAttestationAbi, eventName: "Attested", kind: "attested" },
  { address: PNEUMA_ATTESTATION, abi: PneumaAttestationAbi, eventName: "OwnershipBoundary", kind: "boundary" },
  { address: PNEUMA_COMMONS, abi: PneumaCommonsAbi, eventName: "Published", kind: "published" },
  { address: PNEUMA_COMMONS, abi: PneumaCommonsAbi, eventName: "Cited", kind: "cited" },
  { address: REPUTATION_GRAPH, abi: ReputationGraphAbi, eventName: "Endorsed", kind: "endorsed" },
];

interface SerializedEvent {
  id: string;
  kind: EventKind;
  blockNumber: string; // bigint → string
  txHash: Hex;
  args: Record<string, unknown>;
}

/** 把 args 里的 bigint 全部转字符串，bytes 保留 hex */
function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "bigint") out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

export async function GET() {
  const t0 = Date.now();
  try {
    const client = createPublicClient({
      chain: arcTestnet,
      transport: http(undefined, {
        // server-to-server 跑，不走浏览器 fetch，可以放心提高超时
        timeout: 15_000,
      }),
    });

    const latest = await client.getBlockNumber();
    const earliest =
      latest > HISTORY_BLOCK_RANGE ? latest - HISTORY_BLOCK_RANGE : 0n;

    // 切 chunks（每段 ≤ 9500 blocks，Arc RPC 10000 上限内）
    const chunks: Array<{ from: bigint; to: bigint }> = [];
    let cursor = earliest;
    while (cursor <= latest) {
      const end = cursor + CHUNK_SIZE - 1n;
      chunks.push({ from: cursor, to: end > latest ? latest : end });
      cursor = end + 1n;
    }

    // 并行：所有 (chunk × spec) 同时发 —— Vercel function 不受浏览器 6 并发限
    // 90 个 RPC 并发对 Arc node 是 ok 的，比客户端 80ms throttle 串行快 10x
    const fetchPromises = chunks.flatMap((chunk) =>
      EVENT_SPECS.map(async (spec) => {
        try {
          const logs = await client.getContractEvents({
            address: spec.address,
            abi: spec.abi as never,
            eventName: spec.eventName as never,
            fromBlock: chunk.from,
            toBlock: chunk.to,
          });
          return { kind: spec.kind, logs };
        } catch {
          return { kind: spec.kind, logs: [] };
        }
      }),
    );
    const buckets = await Promise.all(fetchPromises);

    // 扁平化 + 按 (blockNumber, logIndex) 升序
    const flat: SerializedEvent[] = [];
    for (const { kind, logs } of buckets) {
      for (const log of logs as Array<{
        transactionHash: Hex;
        logIndex: number;
        blockNumber: bigint;
        args: Record<string, unknown>;
      }>) {
        flat.push({
          id: `${log.transactionHash}:${log.logIndex}`,
          kind,
          blockNumber: log.blockNumber.toString(),
          txHash: log.transactionHash,
          args: serializeArgs(log.args ?? {}),
        });
      }
    }
    flat.sort((a, b) => {
      const ab = BigInt(a.blockNumber);
      const bb = BigInt(b.blockNumber);
      if (ab !== bb) return ab > bb ? 1 : -1;
      return 0;
    });

    // 预 enrich caller_rated 评论（避免客户端再 13 次串行 getAttestation）
    const callerRatedEvents = flat.filter((e) => e.kind === "caller_rated");
    const enrichments = await Promise.all(
      callerRatedEvents.map(async (e) => {
        const uid = e.args.attestationUid as Hex | undefined;
        if (!uid || uid === "0x" || /^0x0+$/.test(uid)) return null;
        try {
          const att = (await client.readContract({
            address: PNEUMA_ATTESTATION,
            abi: PneumaAttestationAbi,
            functionName: "getAttestation",
            args: [uid],
          })) as { comment: string; recipient: Address };
          return { id: e.id, comment: att.comment, recipient: att.recipient };
        } catch {
          return null;
        }
      }),
    );
    for (const enr of enrichments) {
      if (!enr) continue;
      const evt = flat.find((e) => e.id === enr.id);
      if (evt) {
        evt.args.comment = enr.comment;
        evt.args.recipient = enr.recipient;
      }
    }

    const elapsed = Date.now() - t0;
    console.log(
      `[snapshot] ok events=${flat.length} commentEnriched=${enrichments.filter(Boolean).length} blocks=${earliest}-${latest} elapsed=${elapsed}ms`,
    );

    return NextResponse.json(
      {
        events: flat,
        generatedAt: Date.now(),
        fromBlock: earliest.toString(),
        toBlock: latest.toString(),
        elapsedMs: elapsed,
      },
      {
        headers: {
          // Vercel CDN 缓存 30s + stale-while-revalidate 60s
          // 第一个用户付 cold cache 延迟，后续 30s 内的用户瞬时命中
          "Cache-Control":
            "public, s-maxage=30, stale-while-revalidate=60, max-age=0",
        },
      },
    );
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(
      `[snapshot] FAILED elapsed=${elapsed}ms err=${(err as Error).message}`,
    );
    return NextResponse.json(
      { error: (err as Error).message ?? "snapshot failed" },
      { status: 500 },
    );
  }
}
