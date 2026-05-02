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
  addressUrl,
} from "@/lib/contracts";
import {
  computeReputation,
  type AttestationLike,
} from "@/lib/reputationScore";
import { groupSkillsByOwner, type SkillLike } from "@/lib/agents";
import { ReputationBadge } from "@/app/_components/ReputationBadge";
import { ReputationFormulaPanel } from "@/app/_components/ReputationFormulaPanel";
import { countBoundaryTriggers } from "@/lib/boundaryStats";
import { QUERY_EXAMPLES } from "@/lib/queryExamples";

const TOP_LIMIT = 10;

export default function DiscoverPage() {
  const { data: skills, isLoading } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 8000 },
  });

  const allSkills = (skills ?? []) as readonly SkillLike[];

  // Top Agents 排序：multi-skill sovereign agent 优先（demo 价值高）
  // 1. skill 数 desc：3 skill > 2 skill > 1 skill
  // 2. 同 skill 数下 totalCalls desc：活跃的优先
  // 3. 同 calls 下 owner 字典序（确定性）
  // 老 agent 30+ calls 但 1 skill 排在 multi-skill 后，给评委直观「multi-skill agent」视觉
  const agents = useMemo(() => {
    const grouped = groupSkillsByOwner(allSkills);
    return [...grouped].sort((a, b) => {
      const skillDiff = b.skills.length - a.skills.length;
      if (skillDiff !== 0) return skillDiff;
      const callsDiff = Number(b.totalCalls - a.totalCalls);
      if (callsDiff !== 0) return callsDiff;
      return a.owner.localeCompare(b.owner);
    });
  }, [allSkills]);

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

        {/* 「让你 AI agent 替你 discover」入口 —— 把这个 skill manifest URL 粘到
            Claude / Cursor / GPT，agent 接到任务后自动 POST /api/orchestrate 选
            agent + 付 USDC + 拿结果。这是 /discover 页给"已经有 AI 助手"用户的捷径。 */}
        <AgentSkillCTA />

        {/* 自然语言搜索框 —— planner LLM (planOnly) → 渲染 plan → 一键跳 /run 执行 */}
        <SearchBox />

        {/* 公式公开 —— 折叠状态 */}
        <ReputationFormulaPanel />

        {/* 双栏 Top 10 */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Leaderboard
            title="Top Agents"
            subtitle="按 skill 数降序 · 同档按调用量"
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

// (QUERY_EXAMPLES 抽到 lib/queryExamples.ts，import 在文件顶部)

/**
 * AgentSkillCTA —— 给"已经有 AI agent"的用户的捷径入口
 *
 * 把 /agent.md 的 manifest URL 粘到 Claude / Cursor / GPT 等任意 AI agent，
 * 之后用户跟自己 AI agent 说"帮我审合约/写文案/总结论文"，agent 会自动
 * 调 POST /api/orchestrate 来这个 marketplace 选 sovereign agent + 真付 USDC
 * + 拿结果。Zero install — 纯 HTTP 协议。
 *
 * 这块设计上跟 SearchBox 互补：
 *   SearchBox    —— 人在浏览器里手动 plan + 跳 /run 执行
 *   AgentSkillCTA—— 让 AI agent 在用户对话流里自动 dispatch（不离开 ChatGPT/Claude）
 */
function AgentSkillCTA() {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/agent.md`
      : "https://pneuma-hub.vercel.app/agent.md";
  const display = url.replace(/^https?:\/\//, "");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 旧浏览器静默降级
    }
  }

  return (
    <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-5 space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-cyan font-semibold text-sm">
          🤖 让你的 AI 替你 Discover
        </span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-cyan/70 font-mono">
          Skill manifest · zero install
        </span>
      </div>
      <p className="text-[13px] text-ink-dim leading-relaxed">
        已经有 AI 助手（Claude / Cursor / GPT / OpenClaw）？复制这个链接粘进去——
        以后你跟它说"帮我审合约"或"写一句 slogan"，它会自动来 Pneuma marketplace
        按声誉 / 价格选 sovereign agent，真付 USDC，把结果带回给你。
      </p>
      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <code className="font-mono text-[12px] md:text-[13px] text-ink truncate flex-1 px-3 py-2 rounded bg-bg border border-border text-left">
          {display}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className={`shrink-0 px-4 py-2 rounded font-mono text-[11px] uppercase tracking-wide transition-colors ${
            copied
              ? "bg-cyan/30 text-cyan"
              : "bg-cyan/15 text-cyan hover:bg-cyan/25"
          }`}
          aria-label="复制 agent.md 链接到剪贴板"
        >
          {copied ? "已复制 ✓" : "复制"}
        </button>
      </div>
      <p className="text-[11px] text-ink-faint font-mono">
        看 manifest 全文 →{" "}
        <a
          href="/agent.md"
          target="_blank"
          rel="noreferrer"
          className="text-cyan hover:underline"
        >
          /agent.md
        </a>
      </p>
    </div>
  );
}

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
        <div className="flex items-center gap-2 flex-wrap text-[12px] font-mono">
          <span className="text-ink-faint">试试：</span>
          {QUERY_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setInput(ex.query)}
              title={ex.hint}
              className="px-2.5 py-1 rounded-full border border-cyan/30 bg-cyan/5 text-cyan hover:bg-cyan/15 hover:border-cyan/60 transition-colors"
            >
              {ex.label}
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
        <div className="space-y-1">
          <h2 className="display text-2xl">{title}</h2>
          <p className="text-[12px] font-mono text-ink-faint">{subtitle}</p>
        </div>
        <Link
          href={href}
          className="text-[12px] font-mono text-cyan hover:text-magenta whitespace-nowrap"
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
  const [expanded, setExpanded] = useState(false);

  const { data: attestations } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: [owner],
    query: { refetchInterval: 15000 },
  });

  const items = (attestations ?? []) as readonly AttestationLike[];
  const breakdown = computeReputation(items as AttestationLike[]);
  const boundaryTriggers12mo = countBoundaryTriggers(items);

  return (
    <div
      className={`rounded-md border bg-bg/40 transition-colors ${
        expanded ? "border-soul/60 bg-soul/5" : "border-border hover:border-soul/40 hover:bg-soul/5"
      }`}
    >
      {/* 折叠态：点行任意位置切展开 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
        aria-expanded={expanded}
      >
        <span className="font-mono text-[12px] text-ink-faint w-7 shrink-0">
          #{rank}
        </span>
        <span className="font-mono text-base text-ink truncate flex-1 min-w-0">
          {owner.slice(0, 10)}…{owner.slice(-6)}
        </span>
        <ReputationBadge
          rawTotal={breakdown.score}
          boundaryTriggers12mo={boundaryTriggers12mo}
          size="sm"
        />
        <span className="text-[12px] font-mono text-ink-dim shrink-0">
          {skillCount} skill · {totalCalls.toString()} calls
        </span>
        <span
          className={`text-[12px] font-mono text-ink-faint shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        >
          ▼
        </span>
      </button>

      {/* 展开态：详细信息 + 「查看详情」按钮才跳转 */}
      {expanded && (
        <div className="border-t border-border/60 px-4 py-4 space-y-3 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <Detail
              label="完整地址"
              value={
                <a
                  href={addressUrl(owner)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan hover:text-magenta break-all underline underline-offset-2"
                >
                  {owner} ↗
                </a>
              }
            />
            <Detail
              label="ANS 镜像"
              value={
                <code className="text-soul-soft">
                  agent://pneuma-receipt-{owner.slice(2, 8)}
                </code>
              }
            />
            <Detail
              label="attestations"
              value={`${items.length} 条`}
            />
            <Detail
              label="活跃度"
              value={`${skillCount} active skill / ${totalCalls.toString()} 累计调用`}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/40">
            <Link
              href={`/agents/${owner}`}
              className="btn-primary text-[12px] px-3 py-1.5"
            >
              查看完整履历 →
            </Link>
            <span className="text-[11px] text-ink-faint font-mono">
              5 tab：概览 / 技能 / 评价 / 担保 / 法庭
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillRow({ rank, skill }: { rank: number; skill: SkillLike }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-md border bg-bg/40 transition-colors ${
        expanded ? "border-cyan/60 bg-cyan/5" : "border-border hover:border-cyan/40 hover:bg-cyan/5"
      }`}
    >
      {/* 折叠态 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
        aria-expanded={expanded}
      >
        <span className="font-mono text-[12px] text-ink-faint w-7 shrink-0">
          #{rank}
        </span>
        <span className="text-base text-ink truncate flex-1 min-w-0">
          {skill.name}
        </span>
        <span className="text-[13px] font-mono text-soul-soft shrink-0">
          {formatUnits(skill.pricePerCall, USDC_DECIMALS)} USDC
        </span>
        <span className="text-[12px] font-mono text-ink-dim shrink-0">
          {skill.totalCalls.toString()} calls
        </span>
        <span
          className={`text-[12px] font-mono text-ink-faint shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        >
          ▼
        </span>
      </button>

      {/* 展开态：skill 详情 + 「调用此 skill」「看 owner」两个 action */}
      {expanded && (
        <div className="border-t border-border/60 px-4 py-4 space-y-3 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <Detail
              label="skill ID"
              value={`#${skill.skillId.toString()} · ${skill.category}`}
            />
            <Detail
              label="owner"
              value={
                <a
                  href={addressUrl(skill.owner)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan hover:text-magenta underline underline-offset-2"
                >
                  {skill.owner.slice(0, 10)}…{skill.owner.slice(-6)} ↗
                </a>
              }
            />
            <Detail
              label="endpoint"
              value={
                <span className="text-ink truncate block">{skill.endpoint}</span>
              }
            />
            <Detail
              label="ANS 镜像"
              value={
                <code className="text-soul-soft">
                  agent://pneuma-receipt-{skill.skillId.toString()}
                </code>
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/40">
            <Link
              href={`/run?skillId=${skill.skillId.toString()}`}
              className="btn-primary text-[12px] px-3 py-1.5"
            >
              调用此 skill →
            </Link>
            <Link
              href={`/agents/${skill.owner}`}
              className="text-[12px] font-mono text-cyan hover:text-magenta underline underline-offset-2"
            >
              看 owner 主页 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
        {label}
      </div>
      <div className="text-[13px] text-ink truncate">{value}</div>
    </div>
  );
}
