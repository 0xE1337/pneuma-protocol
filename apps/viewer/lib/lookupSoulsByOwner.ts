/**
 * lookupSoulsByOwner — 任意钱包地址 → 持有的 Soul 列表
 *
 * 这是 Pneuma "wallet-bound identity" 第三方读取叙事的关键 helper：
 *   1. 用户在 Viewer 输入任意地址（不限 connected wallet）
 *   2. 浏览器直接走 viem PublicClient + getLogs，无需 Hub API、无需后端
 *   3. 反查 SoulNFT 的 Transfer 事件 (filter to=owner)，拿到候选 tokenIds
 *   4. 对每个 tokenId 用 ownerOf 实时校验（过滤已转出）+ souls() 拿元数据
 *
 * 这个函数不是 hook，因为 Viewer 的输入是表单提交而非 reactive wallet。
 * 与 Hub 的 useMySouls hook 是同一逻辑的 async 等价物，但保持 Viewer
 * 完全独立——不 import Hub 的代码。
 */

import { parseAbiItem, type Address, type PublicClient } from "viem";
import { SOUL_NFT, SoulNFTAbi } from "./contracts";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

export interface SoulCandidate {
  tokenId: bigint;
  agentName: string;
  tba: Address;
  createdAt: bigint;
}

export async function lookupSoulsByOwner(
  client: PublicClient,
  owner: Address,
): Promise<SoulCandidate[]> {
  // Step 1: 拉历史 Transfer events
  const logs = await client.getLogs({
    address: SOUL_NFT,
    event: TRANSFER_EVENT,
    args: { to: owner },
    fromBlock: 0n,
  });

  const candidates = Array.from(
    new Set(
      logs
        .map((l) => l.args.tokenId)
        .filter((id): id is bigint => typeof id === "bigint"),
    ),
  );

  if (candidates.length === 0) return [];

  // Step 2: ownerOf 校验 + 元数据
  const results = await Promise.all(
    candidates.map(async (tokenId) => {
      try {
        const [currentOwner, soulData] = await Promise.all([
          client.readContract({
            address: SOUL_NFT,
            abi: SoulNFTAbi,
            functionName: "ownerOf",
            args: [tokenId],
          }),
          client.readContract({
            address: SOUL_NFT,
            abi: SoulNFTAbi,
            functionName: "souls",
            args: [tokenId],
          }),
        ]);
        if (currentOwner.toLowerCase() !== owner.toLowerCase()) return null;
        const [agentName, , , tba, createdAt] = soulData;
        return {
          tokenId,
          agentName,
          tba: tba as Address,
          createdAt,
        } satisfies SoulCandidate;
      } catch {
        return null;
      }
    }),
  );

  return results
    .filter((x): x is SoulCandidate => x !== null)
    .sort((a, b) => Number(a.tokenId - b.tokenId));
}
