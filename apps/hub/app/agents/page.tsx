"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  SKILL_REGISTRY,
  SkillRegistryAbi,
  addressUrl,
} from "@/lib/contracts";
import {
  computeReputation,
  formatScore,
  type AttestationLike,
} from "@/lib/reputationScore";
import {
  agentDetailHref,
  groupSkillsByOwner,
  isV5Skill,
  type SkillLike,
} from "@/lib/agents";
import { useI18n } from "@/lib/i18n";

/**
 * /agents — Agent 网络主入口
 *
 * 与 /skills 的关系：
 *   - /agents = 主体视角（按 owner 聚合，sovereign Agent 为一等公民）
 *   - /skills = 能力视角（按需求筛选具体 skill；保留作为次入口）
 *
 * 核心叙事：
 *   - 每个 Agent 是网络中的 sovereign 实体（有 Soul / TBA / 声誉）
 *   - 卡片展开能直接看到该 Agent 的 tier ladder（V5 chat-short/medium/long）
 *   - 点进详情页 → 完整履历 + 真实评论 wall + sovereign 部署证据
 */
export default function AgentsPage() {
  const { t } = useI18n();
  const { data: skills, isLoading } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 6000 },
  });

  const agents = useMemo(
    () => (skills ? groupSkillsByOwner(skills as readonly SkillLike[]) : []),
    [skills],
  );

  const totalSkillCount = skills?.length ?? 0;
  const totalAgentCount = agents.length;

  return (
    <div className="relative overflow-hidden">
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "200px",
          left: "8%",
          width: "84%",
          height: "5px",
          transform: "rotate(-7deg)",
          opacity: 0.35,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-8 pt-12 pb-24 space-y-10 animate-fade-in">
        <header className="space-y-3">
          <span className="pill-live">{t("agents.eyebrow")}</span>
          <h1 className="display text-4xl md:text-5xl">{t("agents.title")}</h1>
          <p className="text-ink-dim leading-relaxed max-w-2xl">
            {t("agents.subtitle")}
          </p>
        </header>

        {/* 跟 /skills 的关系澄清 banner —— 同一份链上数据的双面镜 */}
        <div className="rounded-md border border-soul/30 bg-soul/5 px-5 py-4 flex flex-col md:flex-row md:items-start gap-3">
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.13em] text-soul-soft font-mono">
              {t("agents.relation_banner.title")}
            </div>
            <p className="text-[12px] text-ink-dim font-mono leading-relaxed">
              {t("agents.relation_banner.body")}
            </p>
          </div>
          <Link
            href="/skills"
            className="text-[11px] font-mono text-cyan hover:text-magenta transition-colors whitespace-nowrap shrink-0"
          >
            {t("agents.relation_banner.link")}
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Stat
            label={t("agents.stat.agents")}
            value={totalAgentCount.toString()}
            color="text-magenta"
          />
          <Stat
            label={t("agents.stat.skills")}
            value={totalSkillCount.toString()}
            color="text-cyan"
          />
          <Stat
            label={t("agents.stat.settlement")}
            value="USDC"
            color="text-soul-soft"
          />
        </div>

        {isLoading && (
          <div className="text-ink-faint font-mono">
            {t("agents.loading")}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-5">
          {agents.map((a) => (
            <AgentCard
              key={a.owner}
              owner={a.owner}
              skills={a.skills}
              totalCalls={a.totalCalls}
              hasV5={a.hasV5}
              upstreamModels={a.upstreamModels}
            />
          ))}
        </div>

        {agents.length === 0 && !isLoading && (
          <div className="surface p-10 text-center text-ink-dim">
            {t("agents.empty")}
          </div>
        )}

        {/* 次入口：仍然保留 /skills 给"按能力筛选"场景 */}
        <div className="pt-6 border-t border-border/60 flex items-baseline justify-between gap-4">
          <p className="text-[12px] text-ink-faint font-mono leading-relaxed max-w-3xl">
            {t("agents.skills_link.hint")}
          </p>
          <Link
            href="/skills"
            className="text-[12px] font-mono text-cyan hover:text-magenta transition-colors whitespace-nowrap"
          >
            {t("agents.skills_link.label")} →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Agent 卡 —— 主体视角
 *
 * 信息层级：
 *   1. 头部：owner 地址 + V5 标签 + sovereign indicator
 *   2. 上游披露：列出该 Agent 自声明的 upstream models（反中转抓手）
 *   3. Skill ladder：所有 skill 行（名字 + 价格 + V4/V5 模式）
 *   4. 评分：caller-rated avg + 总调用 + 详情入口
 */
function AgentCard({
  owner,
  skills,
  totalCalls,
  hasV5,
  upstreamModels,
}: {
  owner: Address;
  skills: SkillLike[];
  totalCalls: bigint;
  hasV5: boolean;
  upstreamModels: string[];
}) {
  const { t } = useI18n();

  // Stretched-link pattern：外层 div 不是 link（避免 <a> 嵌套 <a> 的 hydration 错），
  // 用 absolute inset-0 的 detail Link 覆盖整张卡片做点击区；
  // 内部 explorer link 用 relative + z-10 抬到上层，能正常点击且不被父链接吞事件。
  return (
    <div className="surface p-6 hover:border-soul/40 transition-colors space-y-4 relative">
      <Link
        href={agentDetailHref(owner)}
        aria-label={`${t("agents.card.view_detail")} ${owner.slice(0, 10)}`}
        className="absolute inset-0 z-0 rounded-[inherit]"
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 relative">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-mono text-lg font-semibold text-ink truncate">
              {owner.slice(0, 10)}…{owner.slice(-6)}
            </h3>
            {hasV5 && (
              <span className="text-[9px] uppercase tracking-[0.13em] px-1.5 py-0.5 rounded border border-magenta/40 text-magenta font-mono whitespace-nowrap">
                V5
              </span>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
            {t("agents.card.sovereign_label")}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-2xl font-semibold text-cyan">
            {skills.length}
          </div>
          <div className="stat-label mt-0.5">
            {skills.length === 1
              ? t("agents.card.skill_count_one")
              : t("agents.card.skill_count_many")}
          </div>
        </div>
      </div>

      {/* Upstream disclosure (per-byte 模式独有) */}
      {upstreamModels.length > 0 && (
        <div className="rounded-md border border-magenta/30 bg-magenta/5 px-3 py-2 space-y-0.5 relative">
          <div className="text-[9px] uppercase tracking-[0.13em] font-mono text-magenta">
            {t("agents.card.upstream_label")}
          </div>
          <div className="font-mono text-[12px] text-ink truncate">
            {upstreamModels.join(" · ")}
          </div>
        </div>
      )}

      {/* anet ANS 镜像 chip —— 让评委一眼看到该 agent 在 anet mesh 里也可被发现
          命名约定：取该 owner 名下第一个 skill 的 id 作为入口；
          约定 vs 强制：未来可改成 owner-EOA 短哈希以避免 skillId 漂移。 */}
      {skills.length > 0 && (
        <div className="rounded-md border border-cyan/30 bg-cyan/5 px-3 py-2 flex items-center justify-between gap-2 font-mono relative">
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-[0.13em] text-cyan">
              {t("agents.card.anet_label")}
            </div>
            <div className="text-[12px] text-ink truncate">
              agent://pneuma-receipt-{skills[0].skillId.toString()}
            </div>
          </div>
          <span className="text-[9px] text-ink-faint shrink-0 uppercase tracking-wider">
            {t("agents.card.anet_discoverable")}
          </span>
        </div>
      )}

      {/* Skill ladder */}
      <div className="space-y-1.5 relative">
        {skills.map((s) => (
          <SkillRow key={s.skillId.toString()} skill={s} />
        ))}
      </div>

      {/* Footer: reputation + total calls */}
      <div className="pt-3 border-t border-border/60 flex items-center justify-between gap-3 text-[11px] font-mono relative">
        <AgentReputationInline owner={owner} />
        <div className="text-ink-dim">
          <span className="text-ink-faint">
            {t("agents.card.total_calls")}{" "}
          </span>
          <span className="text-ink">{totalCalls.toString()}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-ink-faint font-mono relative">
        <a
          href={addressUrl(owner)}
          target="_blank"
          rel="noreferrer"
          className="hover:text-soul-soft transition-colors relative z-10"
        >
          {t("agents.card.view_explorer")} ↗
        </a>
        <span className="text-soul-soft">
          {t("agents.card.view_detail")} →
        </span>
      </div>
    </div>
  );
}

/**
 * Skill 行 —— 紧凑式，让"一个 Agent 的 tier ladder"一眼可读
 */
function SkillRow({ skill }: { skill: SkillLike }) {
  const v5 = isV5Skill(skill);
  const inKB = (Number(skill.maxInputBytes) / 1024).toFixed(1);
  const outKB = (Number(skill.maxOutputBytes) / 1024).toFixed(1);

  // 价格展示：V4 直显 pricePerCall；V5 显示 typical（base + full input + half output）
  const priceDisplay = v5
    ? formatV5Typical(skill)
    : `${formatUnits(skill.pricePerCall, 6)} USDC`;

  return (
    <div className="flex items-center gap-2 py-1.5 px-2.5 rounded bg-bg/40 border border-border/40">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[13px] text-ink truncate">
            {skill.name}
          </span>
          <span className="text-[9px] text-ink-faint font-mono whitespace-nowrap">
            #{skill.skillId.toString()} · {skill.category}
          </span>
        </div>
        <div className="text-[10px] text-ink-faint font-mono">
          ≤{inKB} KB in / ≤{outKB} KB out
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono text-[13px] text-cyan">{priceDisplay}</div>
        <div className="text-[9px] text-ink-faint font-mono">
          {v5 ? "V5 per-byte" : "V4 flat"}
        </div>
      </div>
    </div>
  );
}

function formatV5Typical(s: SkillLike): string {
  const inKB = Math.ceil(Number(s.maxInputBytes) / 1024);
  const outKB = Math.ceil(Number(s.maxOutputBytes) / 1024);
  // typical = base + full input + half output（与 skills/page.tsx PerBytePriceDisplay 同口径）
  const typical =
    Number(s.baseFee) +
    Number(s.inputPricePerKB) * inKB +
    Number(s.outputPricePerKB) * Math.ceil(outKB / 2);
  return `~${(typical / 1e6).toFixed(4)} USDC`;
}

/**
 * Agent 卡内嵌的 reputation 行 —— 单行展示，详情页有完整 breakdown
 */
function AgentReputationInline({ owner }: { owner: Address }) {
  const { t } = useI18n();
  const { data: attestations } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: [owner],
    query: { refetchInterval: 12000 },
  });

  const items = (attestations ?? []) as readonly AttestationLike[];
  const breakdown = computeReputation(items as AttestationLike[]);

  if (breakdown.validCount === 0) {
    return (
      <span className="text-ink-faint">{t("agents.card.no_reputation")}</span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-magenta">★</span>
      <span className="text-cyan">{formatScore(breakdown.score)}</span>
      <span className="text-ink-faint">/ 100</span>
      <span className="text-ink-faint">·</span>
      <span className="text-ink-dim">
        {breakdown.validCount}{" "}
        {breakdown.validCount === 1
          ? t("agents.card.attestation_count_one")
          : t("agents.card.attestation_count_many")}
      </span>
    </span>
  );
}
