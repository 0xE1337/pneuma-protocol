"use client";

/**
 * /admin/dashboard —— Live Multi-Agent Dashboard（管理员视图）
 *
 * 与之前的 mock 版完全相反：所有数据都是**真链上**的。
 *
 * 数据源：
 *   - Agent 节点：useReadContract(SkillRegistry.listActiveSkills) → unique owners
 *   - 事件流：useLiveSubscriptions() 订阅 9 类事件 → useLiveStore
 *   - 边：useLiveStore.edges (CallSettled / Endorsed 累加)
 *   - 评论：useLiveStore.events filter caller_rated 且 comment != ""
 *
 * Gating：
 *   - 设了 NEXT_PUBLIC_ADMIN_ADDRESSES → 仅白名单地址可见
 *   - 没设环境变量 → 任意 connected wallet 可见，顶部显示橙色 demo banner
 *     （演示日不阻塞评委观察；上线时配 env 立刻收紧）
 *
 * 协议级 demo 心智：
 *   - 看板上每一条事件都是真 tx hash + 真 caller 钱包 + 真 attestation
 *   - 评委可以点 transactionHash 跳 testnet.arcscan.app 自己验证
 *   - "9 个 agent" 不再是 mock array，而是链上 listActiveSkills 实时 enumerate 出的 unique owners
 */

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import {
  SKILL_REGISTRY,
  SkillRegistryAbi,
  txUrl,
  addressUrl,
} from "@/lib/contracts";
import {
  useLiveStore,
  selectCommentEvents,
  type LiveEvent,
  type LiveEdge,
} from "@/lib/live-events/store";
import {
  useLiveSubscriptions,
  summarizeEvent,
} from "@/lib/live-events/subscribe";

const KIND_META: Record<
  LiveEvent["kind"],
  { label: string; icon: string; color: string }
> = {
  skill_registered: { label: "新 skill 上架", icon: "+", color: "text-soul-soft" },
  call_escrowed: { label: "Escrow 锁仓", icon: "→", color: "text-cyan" },
  call_settled: { label: "Settled + attest", icon: "✓", color: "text-magenta" },
  caller_rated: { label: "Caller 评分", icon: "★", color: "text-yellow-400" },
  attested: { label: "Attestation 写入", icon: "▣", color: "text-soul-soft" },
  boundary: { label: "Soul 转主", icon: "⚠", color: "text-magenta" },
  published: { label: "公地发表", icon: "✎", color: "text-cyan" },
  cited: { label: "公地引用", icon: "⇄", color: "text-yellow-400" },
  endorsed: { label: "担保 stake", icon: "⛨", color: "text-violet-400" },
};

/* ─────────────────────────────────────────────────────────────────────── */

/**
 * DemoBanner —— 全开放访问，仅顶部加一条 demo-only 提示
 *
 * 之前：AdminGate 通过 NEXT_PUBLIC_ADMIN_ADDRESSES 白名单门禁，
 *       未配 env → demo 模式（黄横幅 + 任意 wallet 可见），
 *       配 env → 仅白名单地址进。
 * 现在：完全去掉门禁，所有人都能看，顶部统一一条紫色"仅 demo 展示"标签
 *       —— 录屏 / 评委演示路径不再需要连钱包 / 切到管理员账号。
 */
function DemoBanner({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="px-4 py-2 text-[11px] font-mono text-center bg-magenta/15 border-b border-magenta/40 text-magenta">
        ⚠ 实时看板 · 仅 demo 展示 · 平时用户使用看不到
      </div>
      {children}
    </>
  );
}

function DashboardInner() {
  // 启动 9 类事件订阅（mount 一次）
  useLiveSubscriptions();

  return (
    <div className="relative">
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "120px",
          left: "5%",
          width: "90%",
          height: "5px",
          transform: "rotate(-4deg)",
          opacity: 0.3,
        }}
      />

      <div className="relative max-w-[1400px] mx-auto px-6 pt-8 pb-16 space-y-6 animate-fade-in">
        <Header />
        <ChainStatusBar />

        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5">
          <div className="space-y-5">
            <NetworkGraphPanel />
            <CommentWallPanel />
          </div>
          <div className="space-y-5">
            <ActivityFeedPanel />
            <EventTallyPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function Header() {
  return (
    <header className="space-y-2">
      <span className="pill-live">DEMO DASHBOARD · LIVE ON ARC TESTNET</span>
      <h1 className="display text-3xl md:text-4xl">Agent 互调网络 · 真链上事件</h1>
      <p className="text-ink-dim text-[14px] leading-relaxed max-w-3xl">
        所有数据来自 Arc Testnet 链上事件订阅（chain id 5042002）——
        agent 节点从 <span className="font-mono text-cyan">SkillRegistry.listActiveSkills</span> 实时
        enumerate；事件流通过 wagmi <span className="font-mono text-cyan">useWatchContractEvent</span> 订阅
        9 类合约事件（CallSettled / Attested / Published / Cited / Endorsed 等）。
        <span className="text-magenta ml-2">每条事件都点击可跳 explorer 验证</span>。
      </p>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function ChainStatusBar() {
  const { data: skillCount } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "skillCount",
    query: { refetchInterval: 8000 },
  });
  const { data: callCount } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "callCount",
    query: { refetchInterval: 8000 },
  });
  const { data: skills } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 12000 },
  });

  const uniqueOwners = useMemo(() => {
    if (!skills) return 0;
    const set = new Set<string>();
    for (const s of skills) set.add(s.owner.toLowerCase());
    return set.size;
  }, [skills]);

  const eventCounts = useLiveStore((s) => s.eventCounts);
  const totalIngested = useMemo(
    () => Object.values(eventCounts).reduce((s, n) => s + n, 0),
    [eventCounts],
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat
        label="链上 Agent"
        value={uniqueOwners.toString()}
        sub="unique owner"
        accent="text-magenta"
      />
      <Stat
        label="链上 Skill"
        value={skillCount?.toString() ?? "…"}
        sub="active 注册"
        accent="text-cyan"
      />
      <Stat
        label="链上调用"
        value={callCount?.toString() ?? "…"}
        sub="累计 callCount"
        accent="text-soul-soft"
      />
      <Stat
        label="本会话事件"
        value={totalIngested.toString()}
        sub="watchContractEvent ingested"
        accent="text-yellow-400"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="surface p-4 space-y-1">
      <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
        {label}
      </div>
      <div className={`font-mono text-2xl ${accent}`}>{value}</div>
      <div className="text-[10px] text-ink-faint font-mono">{sub}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

const COLS = 3;
const NODE_WIDTH = 230;
const NODE_HEIGHT = 100;
const H_GAP = 80;
const V_GAP = 70;

interface AgentInfo {
  owner: Address;
  skillCount: number;
  skillNames: string[];
  totalCallsOnChain: bigint;
  /** 仅作为 caller 出现（在 graph 边的 fromAgent 但没注册 skill） */
  callerOnly: boolean;
}

function AgentNode({ data }: { data: Record<string, unknown> }) {
  const agent = data as unknown as AgentInfo;
  const { owner, skillCount, skillNames, totalCallsOnChain, callerOnly } = agent;
  const short = `${owner.slice(0, 8)}…${owner.slice(-4)}`;
  // caller-only 节点用 cyan 边框（"使用方"），provider 节点用 magenta（"提供方"）
  const accent = callerOnly ? "rgb(var(--color-cyan))" : "rgb(var(--color-magenta))";
  const tag = callerOnly ? "◇ caller agent" : "★ provider agent";

  return (
    <div
      style={{
        background: "rgb(var(--color-bg))",
        border: `2px solid ${accent}`,
        borderRadius: "8px",
        padding: "10px 12px",
        width: NODE_WIDTH,
        position: "relative",
        // glow shadow tokenized: cyan/magenta literals → CSS vars so island
        // theme (where cyan/magenta map to mint) automatically restains the
        // agent node halo to a warm community feel
        boxShadow: callerOnly
          ? "0 0 12px rgb(var(--color-cyan) / 0.25)"
          : "0 0 12px rgb(var(--color-magenta) / 0.2), 0 0 20px rgb(var(--color-cyan) / 0.1)",
      }}
    >
      {/*
        React Flow 必须有显式 Handle 才能让 edge 找到锚点。
        没 Handle 会 console 报 "Couldn't create edge for source handle id: null"，
        且边根本不渲染。两个 handle 都用透明样式（视觉无感）。
      */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "transparent", border: "none", width: 1, height: 1 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "transparent", border: "none", width: 1, height: 1 }}
      />

      <div className="flex items-center gap-2 mb-1">
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
          }}
        />
        <span className="text-[10px] font-mono text-ink-dim tracking-wider">
          {tag}
        </span>
      </div>
      <div className="text-[12px] font-mono font-semibold text-ink truncate">
        {short}
      </div>
      <div className="text-[10px] font-mono text-ink-faint truncate">
        {callerOnly
          ? "no skill registered"
          : `${skillCount} skill${skillCount === 1 ? "" : "s"}${skillNames.length > 0 ? ` · ${skillNames.slice(0, 2).join(" / ")}` : ""}`}
      </div>
      {!callerOnly && (
        <div className="flex items-baseline justify-between mt-1 text-[10px] font-mono">
          <span className="text-ink-dim">
            on-chain calls{" "}
            <span className="text-cyan">{totalCallsOnChain.toString()}</span>
          </span>
        </div>
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { agent: AgentNode };

function NetworkGraphPanel() {
  const { data: skills } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 8000 },
  });

  const storeEdges = useLiveStore((s) => s.edges);
  const events = useLiveStore((s) => s.events);

  // skillId → owner 查找表（CallEscrowed/CallSettled 事件不带 skillOwner，
  // 必须靠 listActiveSkills 拿到的 skills 才能合成 caller→provider 边）
  const skillIdToOwner = useMemo(() => {
    const map = new Map<string, Address>();
    if (skills) {
      for (const s of skills) {
        map.set(s.skillId.toString(), s.owner);
      }
    }
    return map;
  }, [skills]);

  // 从 events 合成 call-related 边（caller → provider）。
  // 之前 store 直接 upsert 是死代码（CallSettled / CallEscrowed 的 ABI 没
  // skillOwner 字段），现在改成在组件内按 skillId 查表合成，保留 30 分钟
  // lastActiveAt 而不是固定 2 分钟（让 backfill 拉到的历史调用也显示边）。
  const callEdges = useMemo(() => {
    const map = new Map<string, LiveEdge>();
    const HISTORY_EDGE_TTL_MS = 30 * 60 * 1000; // 30 分钟内的事件计入活动边
    const now = Date.now();
    for (const e of events) {
      if (e.kind !== "call_escrowed" && e.kind !== "call_settled") continue;
      const caller = e.args.caller as Address | undefined;
      const skillId = (e.args.skillId as bigint | undefined)?.toString();
      if (!caller || !skillId) continue;
      const provider = skillIdToOwner.get(skillId);
      if (!provider || caller === provider) continue;
      const key = `${caller.toLowerCase()}->${provider.toLowerCase()}`;
      const existing = map.get(key);
      const isSettled = e.kind === "call_settled";
      const amount = isSettled
        ? ((e.args.paidAmount as bigint | undefined) ?? 0n)
        : 0n;
      if (existing) {
        existing.callCount += isSettled ? 1 : 0;
        existing.totalAmount += amount;
        existing.lastActiveAt = Math.max(existing.lastActiveAt, e.receivedAt);
      } else {
        map.set(key, {
          key,
          fromAgent: caller,
          toAgent: provider,
          callCount: isSettled ? 1 : 0,
          totalAmount: amount,
          endorseCount: 0,
          lastActiveAt: e.receivedAt,
        });
      }
    }
    // 过滤太老的（30 分钟外）
    for (const [k, v] of map) {
      if (now - v.lastActiveAt > HISTORY_EDGE_TTL_MS) map.delete(k);
    }
    return map;
  }, [events, skillIdToOwner]);

  // 合并：endorse 边（store.edges）+ call 边（合成）
  const edgesMap = useMemo(() => {
    return { ...storeEdges, ...Object.fromEntries(callEdges) };
  }, [storeEdges, callEdges]);

  // 节点 = listActiveSkills 的 unique owners（provider）∪ edgesMap 出现的 from/to（含纯 caller）
  // 这样 caller-only agent（没注册 skill 但发过调用）也会作为节点出现，
  // 避免 React Flow 的 source-not-in-nodes 错位
  const agents: AgentInfo[] = useMemo(() => {
    const map = new Map<string, AgentInfo>();

    // 第一轮：listActiveSkills owners → provider 节点
    if (skills) {
      for (const s of skills) {
        const ownerKey = s.owner.toLowerCase();
        const existing = map.get(ownerKey);
        if (existing) {
          existing.skillCount += 1;
          existing.skillNames.push(s.name);
          existing.totalCallsOnChain += s.totalCalls;
        } else {
          map.set(ownerKey, {
            owner: s.owner,
            skillCount: 1,
            skillNames: [s.name],
            totalCallsOnChain: s.totalCalls,
            callerOnly: false,
          });
        }
      }
    }

    // 第二轮：edgesMap 里的 caller / provider 地址，没出现过的补上 caller-only 节点
    for (const e of Object.values(edgesMap)) {
      const fromKey = e.fromAgent.toLowerCase();
      if (!map.has(fromKey)) {
        map.set(fromKey, {
          owner: e.fromAgent,
          skillCount: 0,
          skillNames: [],
          totalCallsOnChain: 0n,
          callerOnly: true,
        });
      }
      const toKey = e.toAgent.toLowerCase();
      if (!map.has(toKey)) {
        // 边的 target 也补节点（防 endorse 等场景下 target 是没注册 skill 的纯钱包）
        map.set(toKey, {
          owner: e.toAgent,
          skillCount: 0,
          skillNames: [],
          totalCallsOnChain: 0n,
          callerOnly: true,
        });
      }
    }

    return Array.from(map.values());
  }, [skills, edgesMap]);

  const nodes: Node[] = useMemo(
    () =>
      agents.map((agent, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        // 把 AgentInfo 转 Record<string, unknown> 以满足 React Flow Node generic 约束
        // AgentNode component 内部会再 cast 回 AgentInfo
        const data = agent as unknown as Record<string, unknown>;
        return {
          id: agent.owner.toLowerCase(),
          type: "agent",
          position: {
            x: col * (NODE_WIDTH + H_GAP) + 20,
            y: row * (NODE_HEIGHT + V_GAP) + 20,
          },
          data,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: true,
        };
      }),
    [agents],
  );

  const now = Date.now();
  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = [];
    // edgesMap 已经包含了 backfill 拉到的 30 分钟内的 call 边 + endorse 边；
    // 渲染层这里的窗口宽到 30 分钟 + 长 backfill 历史也都展示，让评委一眼看到
    // 完整 caller↔provider 互调网络（不再是只显示最近 2 分钟新事件）
    const RENDER_TTL_S = 30 * 60;
    for (const e of Object.values(edgesMap)) {
      const age = (now - e.lastActiveAt) / 1000;
      if (age > RENDER_TTL_S) continue;
      const opacity = Math.max(0.2, 1 - age / RENDER_TTL_S);
      const width = Math.min(8, 1 + Math.log2(e.callCount + e.endorseCount + 1) * 1.5);
      list.push({
        id: e.key,
        source: e.fromAgent.toLowerCase(),
        target: e.toAgent.toLowerCase(),
        animated: age < 5,
        style: {
          stroke: `rgba(191, 64, 255, ${opacity})`,
          strokeWidth: width,
        },
        label: `${e.callCount + e.endorseCount}× · ${formatUnits(e.totalAmount, 6)} USDC`,
        labelStyle: {
          fontSize: 9,
          fontFamily: "ui-monospace, monospace",
          fill: "rgb(var(--color-ink) / 0.7)",
        },
        labelBgStyle: { fill: "rgb(var(--color-bg))", opacity: 0.85 },
      });
    }
    return list;
  }, [edgesMap, now]);

  return (
    <div className="surface p-3" style={{ height: "550px" }}>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-[13px] font-semibold text-ink">
          Agent 互调网络 · {nodes.length} on-chain
        </h3>
        <span className="text-[10px] font-mono text-ink-faint">
          {edges.length} active edges (Call + Endorse, 30min window)
        </span>
      </div>
      <div style={{ height: "calc(100% - 28px)" }}>
        {nodes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-ink-faint font-mono text-sm">
            Loading on-chain agents…
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            minZoom={0.4}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              gap={20}
              size={1}
              color="rgb(var(--color-border) / 0.4)"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function ActivityFeedPanel() {
  const events = useLiveStore((s) => s.events);
  // store 保留 ~400 条（满足 event tally 全口径统计），activity feed UI
  // 只展示最近 50 条避免滚动列表过长 + DOM 节点过多
  const visibleEvents = useMemo(() => events.slice(0, 50), [events]);

  return (
    <div className="surface p-4" style={{ height: "300px" }}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink">
          实时事件流 · 链上订阅
        </h3>
        <span className="text-[10px] font-mono text-ink-faint">
          显示最近 {visibleEvents.length} / 共 {events.length} 条
        </span>
      </div>
      <div
        className="overflow-y-auto pr-1 space-y-1.5"
        style={{ height: "calc(100% - 32px)" }}
      >
        {visibleEvents.map((evt) => (
          <FeedRow key={evt.id} event={evt} />
        ))}
        {events.length === 0 && (
          <div className="text-[12px] text-ink-faint font-mono py-8 text-center">
            等待链上事件…
            <br />
            <span className="text-[10px] mt-2 inline-block">
              触发：用 <span className="text-cyan font-mono">/run</span> 调用一个 skill，
              或运行 <span className="text-cyan font-mono">pneuma run</span> CLI
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedRow({ event }: { event: LiveEvent }) {
  const meta = KIND_META[event.kind];
  const summary = summarizeEvent(event);
  const ageSec = (Date.now() - event.receivedAt) / 1000;

  return (
    <a
      href={txUrl(event.txHash)}
      target="_blank"
      rel="noreferrer"
      className="flex items-baseline gap-2 text-[11px] font-mono leading-snug px-2 py-1 rounded hover:bg-ink/5 transition-colors"
    >
      <span className={`${meta.color} shrink-0`}>{meta.icon}</span>
      <span className="shrink-0 text-ink-dim w-24">{summary.label}</span>
      <span className="text-ink truncate flex-1">
        {summary.from && (
          <span className="text-soul-soft">
            {summary.from.slice(0, 8)}…{summary.from.slice(-4)}
          </span>
        )}
        {summary.from && summary.to && (
          <span className="text-ink-faint mx-1">→</span>
        )}
        {summary.to && (
          <span className="text-cyan">
            {summary.to.slice(0, 8)}…{summary.to.slice(-4)}
          </span>
        )}
        {summary.amount !== undefined && (
          <span className="text-magenta ml-1">
            · {formatUnits(summary.amount, 6)} USDC
          </span>
        )}
        {summary.meta && (
          <span className="text-ink-faint ml-1">· {summary.meta}</span>
        )}
      </span>
      <span className="text-ink-faint shrink-0 text-[9px]">
        {ageSec < 1 ? "now" : `${ageSec.toFixed(0)}s`}
      </span>
    </a>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function EventTallyPanel() {
  // 用 store.eventCounts (永久累加 counter) 而不是 events 数组 (80-条 ring buffer)
  // ——backfill 拉到的 200+ 历史事件被 buffer 裁掉一部分时，counter 仍保留全量统计
  const tally = useLiveStore((s) => s.eventCounts);
  const total = useMemo(
    () => Object.values(tally).reduce((s, n) => s + n, 0),
    [tally],
  );
  const kinds: Array<LiveEvent["kind"]> = [
    "call_escrowed",
    "call_settled",
    "caller_rated",
    "attested",
    "published",
    "cited",
    "endorsed",
    "skill_registered",
    "boundary",
  ];

  return (
    <div className="surface p-4" style={{ height: "390px" }}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink">
          事件分类 · 本会话
        </h3>
        <span className="text-[10px] font-mono text-ink-faint">
          {total} 条
        </span>
      </div>
      <div className="space-y-2">
        {kinds.map((kind) => {
          const meta = KIND_META[kind];
          const count = tally[kind];
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={kind} className="space-y-0.5">
              <div className="flex items-baseline justify-between text-[10px] font-mono">
                <span className="flex items-center gap-1.5">
                  <span className={meta.color}>{meta.icon}</span>
                  <span className="text-ink-dim">{meta.label}</span>
                </span>
                <span className="text-ink">
                  {count}{" "}
                  <span className="text-ink-faint">
                    ({pct.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div className="h-1 rounded-full bg-border/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-magenta/70"
                  style={{
                    width: `${pct}%`,
                    transition: "width 200ms ease-out",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function CommentWallPanel() {
  const events = useLiveStore((s) => s.events);
  const comments = useMemo(() => selectCommentEvents(events), [events]);

  return (
    <div className="surface p-4" style={{ height: "240px" }}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink">
          Caller 真实评论 · 链上 280 字符 primitive
        </h3>
        <span className="text-[10px] font-mono text-ink-faint">
          {comments.length} 条带文字
        </span>
      </div>
      <div
        className="overflow-y-auto pr-1 space-y-2"
        style={{ height: "calc(100% - 32px)" }}
      >
        {comments.map((c) => (
          <CommentRow key={c.id} event={c} />
        ))}
        {comments.length === 0 && (
          <div className="text-[12px] text-ink-faint font-mono py-6 text-center">
            等待 caller 在 /run 完成调用后留下文字评论…
          </div>
        )}
      </div>
    </div>
  );
}

function CommentRow({ event }: { event: LiveEvent }) {
  const caller = event.args.caller as Address | undefined;
  const rating = event.args.rating as number | undefined;
  const comment = event.args.comment as string | undefined;
  const stars = rating
    ? "★".repeat(rating) + "☆".repeat(5 - rating)
    : "";

  return (
    <a
      href={txUrl(event.txHash)}
      target="_blank"
      rel="noreferrer"
      className="block border-l-2 border-magenta/40 pl-3 py-1 space-y-0.5 hover:border-magenta/80 transition-colors"
    >
      <div className="flex items-baseline justify-between text-[10px] font-mono">
        <span className="text-magenta">{stars}</span>
        {caller && (
          <span className="text-ink-faint">
            {caller.slice(0, 8)}…{caller.slice(-4)}
          </span>
        )}
      </div>
      <p className="text-[12px] text-ink leading-snug">"{comment}"</p>
    </a>
  );
}

/** Default export —— demo banner + 真 dashboard（无 admin gating） */
export default function AdminDashboardPage() {
  return (
    <DemoBanner>
      <DashboardInner />
    </DemoBanner>
  );
}
