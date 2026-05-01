"use client";

/**
 * useGuiltyRecord(owner) — 扫 PneumaCourt 所有 dispute，判断 owner 是否
 * 作为 defendant 被判过至少一次 guilty。
 *
 * 输出：
 *   - hasGuiltyRecord: boolean — 任何一条 dispute defendant=owner + verdict=GUILTY
 *   - guiltyCount / innocentCount — 完整统计（debug + UI 用）
 *   - loading: boolean — 还在扫 dispute 中
 *
 * 实现：
 *   1. 读 disputeCount → 拿到 total
 *   2. 用一个 ref-driven map<id, dispute> 记录每条 dispute 的 fetched 数据
 *   3. 通过隐藏 child component <DisputeProbe> 一个 id 一个 useReadContract，
 *      每个 fetch 完通过 onResult 回调写到父级 map
 *   4. derive 出 stats
 *
 * 性能：disputeCount 全量扫；demo 期 < 50 disputes 完全可接受；
 * 上规模后改 indexer + 单条 byOwner view function（合约 v6.2 议题）。
 *
 * 缓存：每个 useReadContract 走 wagmi 缓存（refetchInterval 30s），
 * 切到不同 owner 时各自的 dispute fetch 共用底层 cache。
 */

import { useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { type Address } from "viem";
import { PNEUMA_COURT, PneumaCourtAbi } from "@/lib/contracts";

interface DisputeRecord {
  defendant: Address;
  status: number; // 0=NONE 1=VOTING 2=RESOLVED
  verdict: number; // 0=PENDING 1=GUILTY 2=INNOCENT
}

interface GuiltyRecordResult {
  hasGuiltyRecord: boolean;
  guiltyCount: number;
  innocentCount: number;
  loading: boolean;
}

export function useGuiltyRecord(owner: Address): GuiltyRecordResult {
  const { data: countData, isLoading: countLoading } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "disputeCount",
    query: { refetchInterval: 30000 },
  });

  const total = countData !== undefined ? Number(countData) : 0;

  const ids = useMemo(
    () => Array.from({ length: total }, (_, i) => BigInt(i + 1)),
    [total],
  );

  // map id → DisputeRecord，子组件回调写入
  const [recordMap, setRecordMap] = useState<Record<string, DisputeRecord>>({});

  // owner 切换时清空 map（避免上个 owner 的数据沾染）
  useEffect(() => {
    setRecordMap({});
  }, [owner]);

  const stats = useMemo(() => {
    let guilty = 0;
    let innocent = 0;
    const lower = owner.toLowerCase();
    for (const rec of Object.values(recordMap)) {
      if (rec.defendant.toLowerCase() !== lower) continue;
      if (rec.status !== 2) continue;
      if (rec.verdict === 1) guilty++;
      else if (rec.verdict === 2) innocent++;
    }
    return {
      hasGuiltyRecord: guilty > 0,
      guiltyCount: guilty,
      innocentCount: innocent,
    };
  }, [recordMap, owner]);

  const loading =
    countLoading || (total > 0 && Object.keys(recordMap).length < total);

  return {
    ...stats,
    loading,
    // probes 是 React 元素数组，由调用方 render 在树中（隐藏即可）
    // 见 GuiltyRecordProbes 组件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _probes: ids.map((id) => ({
      id,
      onResult: (rec: DisputeRecord) =>
        setRecordMap((prev) => ({ ...prev, [id.toString()]: rec })),
    })) as any,
  } as GuiltyRecordResult & {
    _probes: Array<{
      id: bigint;
      onResult: (rec: DisputeRecord) => void;
    }>;
  };
}

/**
 * GuiltyRecordProbes — 配套 useGuiltyRecord 用的隐藏渲染组件。
 *
 * 调用方在 layout 里加一行 `<GuiltyRecordProbes probes={result._probes} />`，
 * 它会无 UI 地遍历 ids + 各自 fetch dispute + 把结果回调给父级 hook。
 *
 * 为什么不用 useReadContracts batch？因为它要求 contract calls 在 render 时
 * 静态已知；这里 ids 是 dynamic 的（依赖 disputeCount），用一个一个的子组件
 * 配合 onResult 回调更干净。
 */
export function GuiltyRecordProbes({
  probes,
}: {
  probes: Array<{
    id: bigint;
    onResult: (rec: DisputeRecord) => void;
  }>;
}) {
  return (
    <>
      {probes.map((p) => (
        <DisputeProbeRow
          key={p.id.toString()}
          disputeId={p.id}
          onResult={p.onResult}
        />
      ))}
    </>
  );
}

function DisputeProbeRow({
  disputeId,
  onResult,
}: {
  disputeId: bigint;
  onResult: (rec: DisputeRecord) => void;
}) {
  const { data } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "getDispute",
    args: [disputeId],
    query: { refetchInterval: 30000 },
  });

  useEffect(() => {
    if (!data) return;
    const d = data as { defendant: Address; status: number; verdict: number };
    onResult({ defendant: d.defendant, status: d.status, verdict: d.verdict });
    // onResult 是父级 hook 内闭包的 setState，每个 id 一个，稳定身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return null;
}
