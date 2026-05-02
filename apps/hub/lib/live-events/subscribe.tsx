"use client";

/**
 * Live Events Subscriptions —— 真链上事件订阅 + 历史回放
 *
 * 9 类事件订阅：
 *   - SkillRegistry: SkillRegistered / CallEscrowed / CallSettled / CallerRatedSkill
 *   - PneumaAttestation: Attested / OwnershipBoundary
 *   - PneumaCommons: Published / Cited
 *   - ReputationGraph: Endorsed
 *
 * 双轨架构：
 *   1. **历史回放（mount 时一次）**：useEffect + publicClient.getContractEvents
 *      拉过去 ~12 小时（≤5000 blocks）的全部 9 类事件 → push 到 store
 *      解决"页面打开就要看到链上完整故事"——useWatchContractEvent 默认只订阅未来事件
 *   2. **实时订阅（持续）**：每个 event 一个 useWatchContractEvent，poll 4s 拿新 log
 *
 * Store 端 seen Set dedupe（按 txHash:logIndex），同一事件被两条路径都接住时不会重复
 *
 * 设计注意：
 *   - 必须在 "use client" component 里
 *   - 历史 backfill 失败不阻塞 watch（catch 内部 console.error）
 *   - Arc Testnet getLogs 上限保守用 5000 blocks（约 12-24 小时活动覆盖）
 */

import { useEffect, useRef } from "react";
import { useWatchContractEvent, usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
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
import { useLiveStore, type LiveEvent, type LiveEventKind } from "./store";

/**
 * 历史回放 block range —— Arc Testnet ~8s/block
 *
 * Arc Testnet RPC 硬限 eth_getLogs 单次 10000 blocks（超过返回 413 Content
 * Too Large）。SkillRegistry 部署 2026-04-29，到现在历史 ~7 天 ≈ 75600 blocks，
 * 所以拉 90000 blocks（~8 天 + 余量）覆盖所有 demo 资产，包括早期 12-call burst：
 *   - 每段 9500 blocks（< 10000 RPC 上限，留 500 buffer 防 latest 漂移）
 *   - 90000 / 9500 ≈ 10 段 × 9 event specs = 90 RPC calls
 *   - 段之间串行 + 80ms 间隔（throttle 减半，仍够防 Arc RPC rate limit）
 *   - 实测 Vercel Fluid Compute 客户端冷启 + 全量 backfill 总耗 ~15-25s
 *
 * 之前 HISTORY_BLOCK_RANGE = 19000（~42 小时）漏掉了早于 42h 的 100+ 笔 call，
 * 用户在 dashboard 看到 callCount=125 但 events / caller 节点只显示最近 17 笔。
 */
const HISTORY_BLOCK_RANGE = 90000n; // ~8 天，覆盖完整 demo 历史
const CHUNK_SIZE = 9500n; // 单次 getLogs 上限（< 10000 RPC 限）

/**
 * 9 类事件的统一订阅描述符 —— backfill + watch 共用
 */
const EVENT_SPECS = [
  {
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "SkillRegistered" as const,
    kind: "skill_registered" as LiveEventKind,
  },
  {
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "CallEscrowed" as const,
    kind: "call_escrowed" as LiveEventKind,
  },
  {
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "CallSettled" as const,
    kind: "call_settled" as LiveEventKind,
  },
  {
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "CallerRatedSkill" as const,
    kind: "caller_rated" as LiveEventKind,
  },
  {
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    eventName: "Attested" as const,
    kind: "attested" as LiveEventKind,
  },
  {
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    eventName: "OwnershipBoundary" as const,
    kind: "boundary" as LiveEventKind,
  },
  {
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    eventName: "Published" as const,
    kind: "published" as LiveEventKind,
  },
  {
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    eventName: "Cited" as const,
    kind: "cited" as LiveEventKind,
  },
  {
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    eventName: "Endorsed" as const,
    kind: "endorsed" as LiveEventKind,
  },
];

interface AnyLog {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  args: Record<string, unknown>;
}

/**
 * 历史回放 hook —— mount 时一次性拉过去 5000 blocks 的所有 9 类事件
 *
 * 使用 publicClient.getContractEvents（viem v2，wagmi 包了一层 usePublicClient 提供）
 * 9 类事件并行 fetch，按 blockNumber 升序排序后逐个推到 store（顺序匹配链上发生顺序）
 */
function useHistoryBackfill() {
  const publicClient = usePublicClient();
  const pushEvent = useLiveStore((s) => s.pushEvent);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function backfill() {
      if (!publicClient) return;
      try {
        const latest = await publicClient.getBlockNumber();
        const earliestBlock =
          latest > HISTORY_BLOCK_RANGE ? latest - HISTORY_BLOCK_RANGE : 0n;

        // 切成多个 chunk（每个 ≤ CHUNK_SIZE blocks）以满足 Arc Testnet RPC
        // 的 10000 blocks 上限。总段数 = ceil(HISTORY_BLOCK_RANGE / CHUNK_SIZE)
        const chunks: Array<{ from: bigint; to: bigint }> = [];
        let cursor = earliestBlock;
        while (cursor <= latest) {
          const chunkEnd = cursor + CHUNK_SIZE - 1n;
          const to = chunkEnd > latest ? latest : chunkEnd;
          chunks.push({ from: cursor, to });
          cursor = to + 1n;
        }
        console.log(
          `[live-events] backfill plan: ${chunks.length} chunks × ${EVENT_SPECS.length} events = ${chunks.length * EVENT_SPECS.length} RPC calls`,
        );

        // 串行：chunks × specs，每次 100ms 间隔避免 rate limit
        const buckets: Array<{
          kind: LiveEventKind;
          logs: unknown[];
        }> = [];
        const tally: Record<string, number> = {};

        for (const chunk of chunks) {
          if (cancelled) return;
          for (const spec of EVENT_SPECS) {
            if (cancelled) return;
            try {
              const logs = await publicClient.getContractEvents({
                address: spec.address,
                abi: spec.abi,
                eventName: spec.eventName,
                fromBlock: chunk.from,
                toBlock: chunk.to,
              });
              buckets.push({ kind: spec.kind, logs });
              tally[spec.eventName] =
                (tally[spec.eventName] ?? 0) + logs.length;
            } catch (err) {
              const msg = (err as Error).message.slice(0, 80);
              console.warn(
                `[live-events] ${spec.eventName} chunk ${chunk.from}-${chunk.to} FAILED: ${msg}`,
              );
            }
            await new Promise((r) => setTimeout(r, 80));
          }
        }

        // 汇总每个 event 类型的总条数（合并所有 chunk）
        for (const [name, count] of Object.entries(tally)) {
          console.log(`[live-events] ${name.padEnd(20)} ${count} events (all chunks)`);
        }

        if (cancelled) return;

        // 扁平化 + 按 (blockNumber, logIndex) 升序排，让 store 顺序与链上一致
        const flat: Array<{
          kind: LiveEventKind;
          log: AnyLog;
        }> = [];
        for (const { kind, logs } of buckets) {
          for (const log of logs as unknown as AnyLog[]) {
            flat.push({ kind, log });
          }
        }
        flat.sort((a, b) => {
          const blockDiff = a.log.blockNumber - b.log.blockNumber;
          if (blockDiff !== 0n) return blockDiff > 0n ? 1 : -1;
          return a.log.logIndex - b.log.logIndex;
        });

        // store dedupe (seen Set) 自动忽略重复 id
        for (const { kind, log } of flat) {
          pushEvent({
            id: `${log.transactionHash}:${log.logIndex}`,
            kind,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            args: log.args ?? {},
          });
        }

        console.log(
          `[live-events] backfilled ${flat.length} events from block ${earliestBlock} to ${latest}`,
        );
      } catch (err) {
        console.error("[live-events] backfill outer error:", err);
      }
    }

    backfill();
    return () => {
      cancelled = true;
    };
  }, [publicClient, pushEvent]);
}

/**
 * 异步 enrichment：CallerRatedSkill 事件只带 attestationUid，comment 在
 * PneumaAttestation contract storage 里。这个 hook 监控 store 里所有 caller_rated
 * 事件，对每条 event 调一次 getAttestation(uid) 拿 comment 然后写回 event.args.comment。
 *
 * Comment 面板（selectCommentEvents）从此能读到真实文字反馈。
 *
 * dedup：seen ref 记下已 enrich 过的 event id，避免每次 events 数组变化都重 fetch。
 */
function useCommentEnrichment() {
  const events = useLiveStore((s) => s.events);
  const enrichEventArgs = useLiveStore((s) => s.enrichEventArgs);
  const publicClient = usePublicClient();
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!publicClient) return;
    const targets = events.filter(
      (e) =>
        e.kind === "caller_rated" &&
        !seen.current.has(e.id) &&
        typeof e.args.attestationUid === "string" &&
        (e.args.comment === undefined),
    );
    if (targets.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const e of targets) {
        if (cancelled) return;
        seen.current.add(e.id);
        try {
          const att = (await publicClient.readContract({
            address: PNEUMA_ATTESTATION,
            abi: PneumaAttestationAbi,
            functionName: "getAttestation",
            args: [e.args.attestationUid as Hex],
          })) as { comment: string; recipient: Address };
          if (cancelled) return;
          enrichEventArgs(e.id, {
            comment: att.comment,
            recipient: att.recipient,
          });
        } catch (err) {
          // attestation 可能尚未上链 / RPC 抖动 —— 释放 seen 让下次 events 更新时重试
          seen.current.delete(e.id);
          console.warn(
            `[live-events] getAttestation(${e.args.attestationUid}) failed:`,
            (err as Error).message.slice(0, 80),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [events, publicClient, enrichEventArgs]);
}

/**
 * Pneuma 协议层最重要的 9 类事件全部在这里订阅。
 * 单一 hook 入口，只在 demo-dashboard page 里 mount 一次。
 */
export function useLiveSubscriptions() {
  // 1. mount 时拉历史 5000 blocks（一次性）
  useHistoryBackfill();

  // 1.5. 异步把 CallerRatedSkill 事件的 comment 字段从 attestation contract 拉回来
  useCommentEnrichment();

  // 2. 订阅未来事件（持续）
  const pushEvent = useLiveStore((s) => s.pushEvent);

  // ── SkillRegistry ──────────────────────────────────────────────────
  useWatchContractEvent({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "SkillRegistered",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "skill_registered", pushEvent),
  });

  useWatchContractEvent({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "CallEscrowed",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "call_escrowed", pushEvent),
  });

  useWatchContractEvent({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "CallSettled",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "call_settled", pushEvent),
  });

  useWatchContractEvent({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    eventName: "CallerRatedSkill",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "caller_rated", pushEvent),
  });

  // ── PneumaAttestation ──────────────────────────────────────────────
  useWatchContractEvent({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    eventName: "Attested",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "attested", pushEvent),
  });

  useWatchContractEvent({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    eventName: "OwnershipBoundary",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "boundary", pushEvent),
  });

  // ── PneumaCommons ──────────────────────────────────────────────────
  useWatchContractEvent({
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    eventName: "Published",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "published", pushEvent),
  });

  useWatchContractEvent({
    address: PNEUMA_COMMONS,
    abi: PneumaCommonsAbi,
    eventName: "Cited",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "cited", pushEvent),
  });

  // ── ReputationGraph ────────────────────────────────────────────────
  useWatchContractEvent({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    eventName: "Endorsed",
    onLogs: (logs) =>
      ingest(logs as unknown as AnyLog[], "endorsed", pushEvent),
  });
}

function ingest(
  logs: AnyLog[],
  kind: LiveEventKind,
  push: (e: {
    id: string;
    kind: LiveEventKind;
    blockNumber: bigint;
    txHash: Hex;
    args: Record<string, unknown>;
  }) => void,
) {
  for (const log of logs) {
    push({
      id: `${log.transactionHash}:${log.logIndex}`,
      kind,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      args: log.args ?? {},
    });
  }
}

/**
 * 给 dashboard 用的 helper：从一个 LiveEvent 提取主要的 (fromAddr, toAddr, amount, label)
 * 让 activity feed 行可统一渲染。
 */
export function summarizeEvent(evt: {
  kind: LiveEventKind;
  args: Record<string, unknown>;
}): {
  from?: Address;
  to?: Address;
  amount?: bigint;
  label: string;
  meta?: string;
} {
  switch (evt.kind) {
    case "skill_registered": {
      const owner = evt.args.owner as Address | undefined;
      const name = evt.args.name as string | undefined;
      return {
        from: owner,
        label: "新 skill 上架",
        meta: name,
      };
    }
    case "call_escrowed": {
      const caller = evt.args.caller as Address | undefined;
      const amount = evt.args.amount as bigint | undefined;
      return {
        from: caller,
        amount,
        label: "Escrow 锁仓",
      };
    }
    case "call_settled": {
      // CallSettled 只有 callId/rating/uid，caller/provider 要从外部拿
      const rating = evt.args.rating as number | undefined;
      return {
        label: "Settled + 出 attestation",
        meta: rating ? `★ ${rating}/5` : undefined,
      };
    }
    case "caller_rated": {
      const caller = evt.args.caller as Address | undefined;
      const rating = evt.args.rating as number | undefined;
      return {
        from: caller,
        label: "Caller 反向评分",
        meta: rating ? `★ ${rating}/5` : undefined,
      };
    }
    case "attested": {
      const recipient = evt.args.recipient as Address | undefined;
      const attester = evt.args.attester as Address | undefined;
      const skillId = evt.args.skillId as bigint | undefined;
      return {
        from: attester,
        to: recipient,
        label: "Attestation 写入",
        meta: skillId !== undefined ? `skill #${skillId.toString()}` : undefined,
      };
    }
    case "boundary": {
      const tokenId = evt.args.tokenId as bigint | undefined;
      return {
        label: "Soul 转主 boundary",
        meta: tokenId ? `Soul #${tokenId}` : undefined,
      };
    }
    case "published": {
      const author = evt.args.author as Address | undefined;
      const title = evt.args.title as string | undefined;
      return {
        from: author,
        label: "公地发表",
        meta: title,
      };
    }
    case "cited": {
      const citer = evt.args.citer as Address | undefined;
      return {
        from: citer,
        label: "公地引用",
      };
    }
    case "endorsed": {
      const endorser = evt.args.endorser as Address | undefined;
      const endorsee = evt.args.endorsee as Address | undefined;
      const stake = evt.args.stake as bigint | undefined;
      return {
        from: endorser,
        to: endorsee,
        amount: stake,
        label: "担保 stake",
      };
    }
    default:
      return { label: "Unknown event" };
  }
}
