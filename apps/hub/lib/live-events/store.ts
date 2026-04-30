/**
 * Live Events Store —— 收集真链上事件流
 *
 * 与之前的 demo-mock 完全相反：
 *   - mock：浏览器本地 setInterval 生成假数据
 *   - live：wagmi `useWatchContractEvent` 订阅链上 4 个合约的 9 类事件 → push 进 store
 *
 * 事件源：
 *   - SkillRegistry: SkillRegistered / CallEscrowed / CallSettled / CallerRatedSkill
 *   - PneumaAttestation: Attested / OwnershipBoundary
 *   - PneumaCommons: Published / Cited
 *   - ReputationGraph: Endorsed
 *
 * 边累加规则（用于 React Flow 显示 caller→provider 关系）：
 *   - CallSettled (调 skill 完成结算) → 累加 fromAgent → toAgent
 *   - Endorsed (担保) → 累加 endorser → endorsee
 *   - 其他事件不进 graph 边（publish/cite 走单独 panel）
 */

import { create } from "zustand";
import type { Address, Hex } from "viem";

export type LiveEventKind =
  | "skill_registered"
  | "call_escrowed"
  | "call_settled"
  | "caller_rated"
  | "attested"
  | "boundary"
  | "published"
  | "cited"
  | "endorsed";

export interface LiveEvent {
  /** 唯一 id：txHash + logIndex */
  id: string;
  kind: LiveEventKind;
  blockNumber: bigint;
  txHash: Hex;
  /** 客户端收到事件的时间（用于"刚刚"显示） */
  receivedAt: number;
  /** 各事件 args（按 kind 不同字段不同，使用方按 kind 解构） */
  args: Record<string, unknown>;
}

export interface LiveEdge {
  key: string; // "fromAddr->toAddr"
  fromAgent: Address;
  toAgent: Address;
  /** 累计调用次数（仅 settled） */
  callCount: number;
  /** 累计 USDC 流向（settled paidAmount + endorsement stake） */
  totalAmount: bigint;
  /** 累计担保次数 */
  endorseCount: number;
  /** 最近一次活动时间（用于淡出） */
  lastActiveAt: number;
}

interface LiveStore {
  events: LiveEvent[];
  edges: Record<string, LiveEdge>;
  /**
   * 按 kind 永久累加的 counter —— 不受 events ring buffer 裁切影响。
   * EventTallyPanel 用这个统计 9 类事件分布，让 backfill 拉到的早期事件
   * （publish / cite / endorse 等低频但重要的 V6 事件）即使被 ring buffer
   * 裁出 events 数组，仍然在分类 panel 里有体现。
   */
  eventCounts: Record<LiveEventKind, number>;
  /** 已 ingested 的 event id，去重防止 watchContractEvent 重发 */
  seen: Set<string>;

  pushEvent: (e: Omit<LiveEvent, "receivedAt">) => void;
  reset: () => void;
}

// 必须 ≥ backfill 单次拉取量（5000 blocks 历史经常 200+ events），否则
// 早期事件（publish / cite / endorse 等低频但重要的 V6 事件）会被 ring
// buffer 裁掉，看板对应 panel 显示 0% 误以为 ABI 错。
// activity feed UI 端会自己 slice(0, 50) 防止滚动列表过长。
const MAX_EVENTS = 400;

const ZERO_COUNTS: Record<LiveEventKind, number> = {
  skill_registered: 0,
  call_escrowed: 0,
  call_settled: 0,
  caller_rated: 0,
  attested: 0,
  boundary: 0,
  published: 0,
  cited: 0,
  endorsed: 0,
};

export const useLiveStore = create<LiveStore>((set, get) => ({
  events: [],
  edges: {},
  eventCounts: { ...ZERO_COUNTS },
  seen: new Set(),

  pushEvent: (raw) => {
    const state = get();
    if (state.seen.has(raw.id)) return; // dedupe

    const evt: LiveEvent = { ...raw, receivedAt: Date.now() };
    const seen = new Set(state.seen);
    seen.add(raw.id);

    let edges = state.edges;

    // 边累加：CallSettled / Endorsed
    if (evt.kind === "call_settled") {
      const caller = evt.args.caller as Address | undefined;
      const provider = evt.args.skillOwner as Address | undefined;
      const amount = (evt.args.paidAmount as bigint | undefined) ?? 0n;
      if (caller && provider && caller !== provider) {
        edges = upsertEdge(edges, caller, provider, {
          callDelta: 1,
          amountDelta: amount,
          endorseDelta: 0,
        });
      }
    } else if (evt.kind === "endorsed") {
      const endorser = evt.args.endorser as Address | undefined;
      const endorsee = evt.args.endorsee as Address | undefined;
      const stake = (evt.args.stake as bigint | undefined) ?? 0n;
      if (endorser && endorsee && endorser !== endorsee) {
        edges = upsertEdge(edges, endorser, endorsee, {
          callDelta: 0,
          amountDelta: stake,
          endorseDelta: 1,
        });
      }
    }

    const events = [evt, ...state.events].slice(0, MAX_EVENTS);

    // counter 永久累加，独立于 events ring buffer
    const eventCounts = {
      ...state.eventCounts,
      [evt.kind]: (state.eventCounts[evt.kind] ?? 0) + 1,
    };

    set({ events, edges, seen, eventCounts });
  },

  reset: () =>
    set({
      events: [],
      edges: {},
      eventCounts: { ...ZERO_COUNTS },
      seen: new Set(),
    }),
}));

function upsertEdge(
  edges: Record<string, LiveEdge>,
  from: Address,
  to: Address,
  delta: { callDelta: number; amountDelta: bigint; endorseDelta: number },
): Record<string, LiveEdge> {
  const key = `${from.toLowerCase()}->${to.toLowerCase()}`;
  const existing = edges[key];
  return {
    ...edges,
    [key]: {
      key,
      fromAgent: from,
      toAgent: to,
      callCount: (existing?.callCount ?? 0) + delta.callDelta,
      totalAmount: (existing?.totalAmount ?? 0n) + delta.amountDelta,
      endorseCount: (existing?.endorseCount ?? 0) + delta.endorseDelta,
      lastActiveAt: Date.now(),
    },
  };
}

/** 工具：从 events 里抽 caller_rated 的非空 comment */
export function selectCommentEvents(events: LiveEvent[]): LiveEvent[] {
  return events
    .filter((e) => e.kind === "caller_rated")
    .filter((e) => {
      const comment = e.args.comment as string | undefined;
      return comment && comment.length > 0;
    })
    .slice(0, 8);
}
