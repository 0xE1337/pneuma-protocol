/**
 * useMySouls — 反查当前钱包持有的 Soul tokenIds
 *
 * 设计：
 *   1. SoulNFT 继承标准 ERC-721（未继承 ERC721Enumerable），所以没有
 *      `tokenOfOwnerByIndex` 这种 O(1) 反查；要靠链上事件回扫。
 *   2. 用 viem 的 `getLogs` 拉所有 `Transfer` 事件（filter `to=address`），
 *      得到候选 tokenId 集合（包括"曾经收到"，但可能已转出）。
 *   3. 对每个候选 tokenId 再用 `ownerOf` 实时校验，过滤掉"已经转出"的。
 *   4. 切钱包后 useEffect 触发重新反查，"切钱包 = 切 Soul 列表"自动闭环。
 *
 * 这是兑现 Pneuma "钱包即身份" 叙事的关键 UX 抓手——
 * 没有这个 hook，前端要么硬编码 tokenId（破功），要么列全网 Souls（无身份感）。
 */
"use client";

import { useEffect, useState } from "react";
import { parseAbiItem, type Address, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { SOUL_NFT, SoulNFTAbi } from "./contracts";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

export interface SoulSummary {
  tokenId: bigint;
  agentName: string;
  tba: Address;
  createdAt: bigint;
}

interface UseMySoulsResult {
  souls: SoulSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMySouls(address?: Address): UseMySoulsResult {
  const publicClient = usePublicClient();
  const [souls, setSouls] = useState<SoulSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // 没钱包/没 publicClient → 清空，退出
    if (!address || !publicClient) {
      setSouls([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const items = await fetchSouls(publicClient, address);
        if (!cancelled) setSouls(items);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setSouls([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, publicClient, tick]);

  return {
    souls,
    loading,
    error,
    refetch: () => setTick((t) => t + 1),
  };
}

async function fetchSouls(
  publicClient: PublicClient,
  address: Address,
): Promise<SoulSummary[]> {
  // Step 1: getLogs 拉 Transfer 事件 (to=address)
  // fromBlock=0n 在 Arc Testnet 块数较少时 OK；生产应缓存或加 fromBlock 启发式
  const logs = await publicClient.getLogs({
    address: SOUL_NFT,
    event: TRANSFER_EVENT,
    args: { to: address },
    fromBlock: 0n,
  });

  // Step 2: 收集候选 tokenIds 并去重（同一 tokenId 可能多次进入此地址）
  const candidates = Array.from(
    new Set(
      logs
        .map((l) => l.args.tokenId)
        .filter((id): id is bigint => typeof id === "bigint"),
    ),
  );

  if (candidates.length === 0) return [];

  // Step 3: 对每个 tokenId 调 ownerOf + souls() 拿元数据，过滤掉已转出的
  const checked = await Promise.all(
    candidates.map(async (tokenId) => {
      try {
        const [owner, soulData] = await Promise.all([
          publicClient.readContract({
            address: SOUL_NFT,
            abi: SoulNFTAbi,
            functionName: "ownerOf",
            args: [tokenId],
          }),
          publicClient.readContract({
            address: SOUL_NFT,
            abi: SoulNFTAbi,
            functionName: "souls",
            args: [tokenId],
          }),
        ]);
        if (owner.toLowerCase() !== address.toLowerCase()) return null;
        const [agentName, , , tba, createdAt] = soulData;
        return {
          tokenId,
          agentName,
          tba: tba as Address,
          createdAt,
        } satisfies SoulSummary;
      } catch {
        return null;
      }
    }),
  );

  // Step 4: 过滤 + 按 tokenId 升序
  return checked
    .filter((x): x is SoulSummary => x !== null)
    .sort((a, b) => Number(a.tokenId - b.tokenId));
}
