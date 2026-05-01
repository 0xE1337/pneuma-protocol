"use client";

/**
 * /discover — Pneuma 主入口
 *
 * IA 重构后这里是用户开始一切操作的地方：
 *   - 自然语言搜索框（P2 接 planner LLM；目前是 stub）
 *   - 双栏 Top 10 排行榜：左 Agent（按声誉）/ 右 Skill（按调用量）
 *   - 公式公开（复用 ReputationFormulaPanel）
 *   - 全量列表入口（点 「全部 Agent」 / 「全部 Skill」 跳老路由）
 *
 * 列表卡设计原则（不复用 /agents 的 AgentCard）：
 *   - 排行榜卡片 KISS：只显示排名 + 段位徽章 + 名字 + 一行 metric
 *   - 复杂卡片留在 /agents/[address] 详情页
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  SKILL_REGISTRY,
  SkillRegistryAbi,
  USDC_DECIMALS,
} from "@/lib/contracts";
import {
  computeReputation,
  type AttestationLike,
} from "@/lib/reputationScore";
import { groupSkillsByOwner, type SkillLike } from "@/lib/agents";
import { ReputationBadge } from "@/app/_components/ReputationBadge";
import { ReputationFormulaPanel } from "@/app/_components/ReputationFormulaPanel";

const TOP_LIMIT = 10;

export default function DiscoverPage() {
  const { data: skills, isLoading } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 8000 },
  });

  const allSkills = (skills ?? []) as readonly SkillLike[];
  const agents = useMemo(() => groupSkillsByOwner(allSkills), [allSkills]);

  // Top skills 按 totalCalls desc，平手按 skillId asc（早注册的 id 小，优先）
  const topSkills = useMemo(
    () =>
      [...allSkills]
        .sort((a, b) => {
          const diff = Number(b.totalCalls - a.totalCalls);
          if (diff !== 0) return diff;
          return Number(a.skillId - b.skillId);
        })
        .slice(0, TOP_LIMIT),
    [allSkills],
  );

  return (
    <div className="relative overflow-hidden">
      <div
        className="neon-streak"
        data-color="cyan"
        style={{
          top: "180px",
          left: "5%",
          width: "90%",
          height: "5px",
          transform: "rotate(-3deg)",
          opacity: 0.32,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-8 pt-12 pb-24 space-y-10 animate-fade-in">
        <header className="space-y-3 max-w-3xl">
          <span className="pill-live">Discover</span>
          <h1 className="display text-4xl md:text-5xl">
            找一个 Agent，让它帮你做事
          </h1>
          <p className="text-ink-dim leading-relaxed">
            浏览全网 sovereign Agent + 它们提供的能力。声誉、调用量、段位都是
            链上算出来的——公式开源，任意 dApp 都能复算。
          </p>
        </header>

        {/* 自然语言搜索框 —— planner LLM (planOnly) → 渲染 plan → 一键跳 /run 执行 */}
        <SearchBox />

        {/* 公式公开 —— 折叠状态 */}
        <ReputationFormulaPanel />

        {/* 双栏 Top 10 */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Leaderboard
            title="Top Agents"
            subtitle="按 economic 维度声誉降序"
            href="/agents"
            hrefLabel="查看全部 Agent →"
            isLoading={isLoading}
            isEmpty={agents.length === 0}
            emptyText="暂无 Agent。第一个上线 → /mint 铸造 Soul，pneuma serve 起 endpoint。"
          >
            {agents
              .slice(0, TOP_LIMIT)
              .map((a, idx) => (
                <AgentRow
                  key={a.owner}
                  rank={idx + 1}
                  owner={a.owner as Address}
                  skillCount={a.skills.length}
                  totalCalls={a.totalCalls}
                />
              ))}
          </Leaderboard>

          <Leaderboard
            title="Top Skills"
            subtitle="按调用量降序（早注册的优先）"
            href="/skills"
            hrefLabel="查看全部 Skill →"
            isLoading={isLoading}
            isEmpty={topSkills.length === 0}
            emptyText="暂无 Skill。注册一个："
          >
            {topSkills.map((s, idx) => (
              <SkillRow
                key={s.skillId.toString()}
                rank={idx + 1}
                skill={s}
              />
            ))}
          </Leaderboard>
        </div>
      </div>
    </div>
  );
}

interface PlanStep {
  skillId: number;
  skillName: string;
  reason: string;
  pricePerCall: string;
}
interface PlanOnlyResponse {
  query: string;
  plan: { steps: PlanStep[]; reasoning: string };
}

const QUERY_EXAMPLES = [
  "帮我审计这个 0x... 合约的安全风险",
  "查我钱包近 90 天有没有被薅羊毛",
  "分析最近 30 天 ETH 价格 + 给一段总结",
];

/**
 * SearchBox —— Discover 真智能搜索
 *
 * 流程：
 *   1. 用户输入自然语言 → POST /api/orchestrate { query, planOnly: true }
 *   2. 后端 discoverSkills + plan() → 返回拆解的 N 步 skill 调用（不上链）
 *   3. 渲染 PlanCard：每步 skill 名 + 价格 + 理由 + 总价
 *   4. 「一键执行 →」跳 /run?query=<encoded>，/run Smart 模式预填 + 一键执行
 *
 * 这里只做「想清楚」，真上链让 /run 处理（钱包签名 / Soul 选择 / 上链反馈）。
 */
function SearchBox() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<PlanOnlyResponse | null>(null);

  async function runPlanOnly() {
    if (input.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setResp(null);
    try {
      const r = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input.trim(), planOnly: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResp(data as PlanOnlyResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function jumpToRun() {
    if (!input.trim()) return;
    // /run Smart 模式接 ?mode=smart&query=...，自动预填 textarea
    router.push(
      `/run?mode=smart&query=${encodeURIComponent(input.trim())}`,
    );
  }

  return (
    <div className="rounded-lg border border-magenta/30 bg-magenta/5 p-5 space-y-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
          ⚡ 智能搜索
        </span>
        <span className="text-[10px] text-ink-faint font-mono">
          自然语言 → AI 拆 plan → 一键调用
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例：帮我审计这个合约 / 查我钱包是否被薅羊毛 / 分析最近 30 天 ETH 走势"
          className="input flex-1"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) runPlanOnly();
          }}
        />
        <button
          type="button"
          onClick={runPlanOnly}
          disabled={busy || input.trim().length === 0}
          className="btn-primary text-sm whitespace-nowrap"
        >
          {busy ? "Planner 拆解中…" : "🔍 拆 plan"}
        </button>
      </div>

      {/* 示例点击 → 自动填入输入框 */}
      {!resp && !busy && (
        <div className="flex items-baseline gap-2 flex-wrap text-[11px] font-mono">
          <span className="text-ink-faint">试试：</span>
          {QUERY_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInput(ex)}
              className="text-cyan hover:text-magenta underline underline-offset-2"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="text-[11px] text-magenta bg-magenta/10 border border-magenta/40 rounded-md p-3 break-words font-mono">
          {error}
        </div>
      )}

      {resp && <PlanCard plan={resp.plan} onExecute={jumpToRun} />}
    </div>
  );
}

function PlanCard({
  plan,
  onExecute,
}: {
  plan: { steps: PlanStep[]; reasoning: string };
  onExecute: () => void;
}) {
  const totalCost = plan.steps.reduce(
    (sum, s) => sum + Number(s.pricePerCall || "0") / 1e6,
    0,
  );

  return (
    <div className="rounded-md border border-cyan/40 bg-cyan/5 p-4 space-y-3 animate-fade-in">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
          AI 拆出 {plan.steps.length} 步
        </div>
        <div className="text-[11px] font-mono text-soul-soft">
          预估 {totalCost.toFixed(4)} USDC
        </div>
      </div>

      <p className="text-[12px] text-ink-dim italic leading-relaxed">
        {plan.reasoning}
      </p>

      <div className="space-y-2">
        {plan.steps.map((step, i) => (
          <div
            key={`${step.skillId}-${i}`}
            className="bg-bg/60 border border-border rounded p-3 space-y-1"
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap font-mono text-[12px]">
              <span className="text-magenta">
                Step {String(i + 1).padStart(2, "0")} → {step.skillName}{" "}
                <span className="text-ink-faint">#{step.skillId}</span>
              </span>
              <span className="text-soul-soft">
                {(Number(step.pricePerCall) / 1e6).toFixed(4)} USDC
              </span>
            </div>
            <div className="text-[11px] text-ink-dim leading-relaxed">
              {step.reason}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border/60">
        <button
          type="button"
          onClick={onExecute}
          className="btn-primary text-sm flex-1"
        >
          一键执行 → 跳执行台
        </button>
        <span className="text-[10px] text-ink-faint font-mono">
          钱包签名后链上 settle
        </span>
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  subtitle,
  href,
  hrefLabel,
  isLoading,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  subtitle: string;
  href: string;
  hrefLabel: string;
  isLoading: boolean;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="display text-xl">{title}</h2>
          <p className="text-[11px] font-mono text-ink-faint">{subtitle}</p>
        </div>
        <Link
          href={href}
          className="text-[11px] font-mono text-cyan hover:text-magenta whitespace-nowrap"
        >
          {hrefLabel}
        </Link>
      </div>

      {isLoading && (
        <div className="text-[12px] text-ink-faint font-mono">Loading…</div>
      )}

      {!isLoading && isEmpty && (
        <div className="text-[12px] text-ink-dim font-mono leading-relaxed">
          {emptyText}
          {emptyText.endsWith("：") && (
            <code className="ml-1 text-cyan">pneuma serve</code>
          )}
        </div>
      )}

      {!isEmpty && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function AgentRow({
  rank,
  owner,
  skillCount,
  totalCalls,
}: {
  rank: number;
  owner: Address;
  skillCount: number;
  totalCalls: bigint;
}) {
  const { data: attestations } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: [owner],
    query: { refetchInterval: 15000 },
  });

  const items = (attestations ?? []) as readonly AttestationLike[];
  const breakdown = computeReputation(items as AttestationLike[]);

  return (
    <Link
      href={`/agents/${owner}`}
      className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-bg/40 hover:border-soul/40 hover:bg-soul/5 transition-colors"
    >
      <span className="font-mono text-[11px] text-ink-faint w-6 shrink-0">
        #{rank}
      </span>
      <span className="font-mono text-sm text-ink truncate flex-1 min-w-0">
        {owner.slice(0, 10)}…{owner.slice(-6)}
      </span>
      <ReputationBadge rawTotal={breakdown.score} size="sm" />
      <span className="text-[10px] font-mono text-ink-faint shrink-0">
        {skillCount} skill · {totalCalls.toString()} calls
      </span>
    </Link>
  );
}

function SkillRow({ rank, skill }: { rank: number; skill: SkillLike }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-bg/40 hover:border-cyan/40 hover:bg-cyan/5 transition-colors">
      <span className="font-mono text-[11px] text-ink-faint w-6 shrink-0">
        #{rank}
      </span>
      <span className="text-sm text-ink truncate flex-1 min-w-0">
        {skill.name}
      </span>
      <span className="text-[11px] font-mono text-soul-soft shrink-0">
        {formatUnits(skill.pricePerCall, USDC_DECIMALS)} USDC
      </span>
      <span className="text-[10px] font-mono text-ink-faint shrink-0">
        {skill.totalCalls.toString()} calls
      </span>
    </div>
  );
}
