/**
 * useOwnershipTimeline — 拉某 Soul tokenId 的所有 Transfer 事件，组装成 owner 时间线
 *
 * 视觉化 "history follows the NFT" 叙事的核心抓手：
 *   - mint 时刻：from = 0x0 → to = 第一任 owner
 *   - 每次转让：from = 当前 owner → to = 下一任 owner
 *
 * 与 attestation timeline 形成对位：
 *   左侧：owner 链（NFT 所有权变迁）
 *   右侧：attestation 链（TBA 持续累积，与 owner 无关）
 *   → 用户一眼看出 "owner 换了，但 history 没断"
 *
 * 性能：getLogs 一次 + 每个 log 一次 getBlock（timestamp）。
 * Hackathon 节奏：用 Promise.all 批量并发，testnet block 数少不会爆。
 */
"use client";

import { useEffect, useState } from "react";
import { parseAbiItem, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { SOUL_NFT } from "./contracts";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

export interface OwnershipEvent {
  from: Address;
  to: Address;
  blockNumber: bigint;
  txHash: Hex;
  timestamp: bigint; // unix seconds; 0n if block lookup failed
  isMint: boolean;
}

interface Result {
  events: OwnershipEvent[];
  loading: boolean;
  error: string | null;
}

export function useOwnershipTimeline(tokenId: bigint | null): Result {
  const publicClient = usePublicClient();
  const [events, setEvents] = useState<OwnershipEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tokenId === null || !publicClient) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        // Arc Testnet RPC 限制 eth_getLogs 单次最多 10000 blocks，fromBlock=0n 必撞限制。
        // 分块拉：从当前块往回，每段 9500 blocks，串行 + 100ms gap 防 rate limit。
        // hackathon Soul 都是近期铸的，HISTORY_BLOCK_RANGE 覆盖最近 ~42 小时足够；
        // 老 Soul 的早期 transfer 历史会丢，可接受（demo 范围内不会有）。
        const CHUNK_SIZE = 9500n;
        const HISTORY_BLOCK_RANGE = 19000n;
        const latest = await publicClient.getBlockNumber();
        const earliest = latest > HISTORY_BLOCK_RANGE ? latest - HISTORY_BLOCK_RANGE : 0n;

        // 用 array-of-arrays + flat 保留 TS 对 event-filtered Log 的类型推断
        // （每个 chunk 都带 typeof TRANSFER_EVENT 约束，args / blockNumber 等字段类型保留）
        type ChunkType = Awaited<
          ReturnType<typeof publicClient.getLogs<typeof TRANSFER_EVENT>>
        >;
        const chunks: ChunkType[] = [];
        let cursor = earliest;
        while (cursor <= latest) {
          const toBlock = cursor + CHUNK_SIZE > latest ? latest : cursor + CHUNK_SIZE;
          try {
            const chunk = await publicClient.getLogs({
              address: SOUL_NFT,
              event: TRANSFER_EVENT,
              args: { tokenId },
              fromBlock: cursor,
              toBlock,
            });
            chunks.push(chunk);
          } catch (chunkErr) {
            // 单 chunk 失败不阻塞整体，记下来继续往后拉
            console.warn(`[useOwnershipTimeline] chunk ${cursor}-${toBlock} failed:`, (chunkErr as Error).message);
          }
          cursor = toBlock + 1n;
          if (cursor <= latest) await new Promise((r) => setTimeout(r, 100));
        }
        const logs = chunks.flat();

        // 按 blockNumber + logIndex 排序，保证时间序
        const sorted = [...logs].sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return Number(a.blockNumber - b.blockNumber);
          }
          return a.logIndex - b.logIndex;
        });

        // 拿 timestamp（每个不同的 blockNumber 拉一次 block，去重）
        const uniqueBlocks = Array.from(
          new Set(sorted.map((l) => l.blockNumber)),
        );
        const blockMap = new Map<bigint, bigint>();
        await Promise.all(
          uniqueBlocks.map(async (bn) => {
            try {
              const block = await publicClient.getBlock({ blockNumber: bn });
              blockMap.set(bn, block.timestamp);
            } catch {
              blockMap.set(bn, 0n);
            }
          }),
        );

        const items: OwnershipEvent[] = sorted.map((log) => {
          const from = (log.args.from ?? "0x0000000000000000000000000000000000000000") as Address;
          const to = (log.args.to ?? "0x0000000000000000000000000000000000000000") as Address;
          return {
            from,
            to,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            timestamp: blockMap.get(log.blockNumber) ?? 0n,
            isMint:
              from.toLowerCase() ===
              "0x0000000000000000000000000000000000000000",
          };
        });

        if (!cancelled) setEvents(items);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenId, publicClient]);

  return { events, loading, error };
}
