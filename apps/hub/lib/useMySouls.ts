/**
 * useMySouls — 反查当前钱包持有的 Soul tokenIds
 *
 * 设计（v2 —— 合约级真值，不依赖事件历史）：
 *   1. SoulNFT 没继承 ERC721Enumerable，但有 `totalMinted` view + `balanceOf`。
 *   2. 拿 `balanceOf(address)` 知道这个钱包有几个 → 0 时直接返回空数组
 *   3. 拿 `totalMinted` 知道全网 tokenId 范围 [1, totalMinted]
 *   4. **并行**对所有 tokenId 调 `ownerOf` —— 找到 owner==address 的全部
 *      为 perf：totalMinted < 50 时 demo 完全可接受（< 1 秒）
 *   5. 拿到匹配 tokenId 后，并行查 `souls(tokenId)` 拿元数据
 *
 * v1 旧设计用 Transfer 事件 + 19000-block 滚动窗口反查。问题：Soul 如果是
 * 42 小时之前铸的，事件根本扫不到 → 钱包明明有 Soul 但 hook 返回空。
 * 这是 v1 → v2 的核心修复（用合约状态当真值，不再依赖事件归档）。
 *
 * 这是兑现 Pneuma "钱包即身份" 叙事的关键 UX 抓手——
 * 没有这个 hook，前端要么硬编码 tokenId（破功），要么列全网 Souls（无身份感）。
 */
"use client";

import { useEffect, useState } from "react";
import { type Address, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { SOUL_NFT, SoulNFTAbi } from "./contracts";

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
  // Step 1: balanceOf —— 这个钱包持有几个 Soul（合约级真值，永远准确）
  const balance = (await publicClient.readContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;

  if (balance === 0n) return [];

  // Step 2: totalMinted —— 全网累计铸造数（决定遍历范围）
  const totalMinted = (await publicClient.readContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "totalMinted",
  })) as bigint;

  if (totalMinted === 0n) return [];

  // Step 3: 并行查所有 tokenId 的 ownerOf —— 找到属于当前钱包的
  // perf 评估：demo 阶段 totalMinted < 50；< 1 秒即返回。上规模后再换 indexer。
  const allTokenIds = Array.from(
    { length: Number(totalMinted) },
    (_, i) => BigInt(i + 1),
  );

  const targetLower = address.toLowerCase();

  const checked = await Promise.all(
    allTokenIds.map(async (tokenId) => {
      try {
        const owner = (await publicClient.readContract({
          address: SOUL_NFT,
          abi: SoulNFTAbi,
          functionName: "ownerOf",
          args: [tokenId],
        })) as Address;
        if (owner.toLowerCase() !== targetLower) return null;

        // owner 匹配 —— 再拉元数据
        const soulData = await publicClient.readContract({
          address: SOUL_NFT,
          abi: SoulNFTAbi,
          functionName: "souls",
          args: [tokenId],
        });
        const [agentName, , , tba, createdAt] = soulData;
        return {
          tokenId,
          agentName,
          tba: tba as Address,
          createdAt,
        } satisfies SoulSummary;
      } catch {
        // tokenId 可能 burn 过 / 不存在 —— ownerOf 会 revert，跳过
        return null;
      }
    }),
  );

  return checked
    .filter((x): x is SoulSummary => x !== null)
    .sort((a, b) => Number(a.tokenId - b.tokenId));
}
