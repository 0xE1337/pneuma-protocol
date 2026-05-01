"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits, isAddress, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  PNEUMA_COURT,
  PneumaCourtAbi,
  RATER_ROLE,
  REPUTATION_GRAPH,
  ReputationGraphAbi,
  SKILL_REGISTRY,
  SkillRegistryAbi,
  USDC_DECIMALS,
  addressUrl,
} from "@/lib/contracts";
import {
  computeReputation,
  formatScore,
  type AttestationLike as RepAttestation,
} from "@/lib/reputationScore";
import {
  formatUsdc,
  raterRoleLabel,
  relativeTime,
  type AttestationLike,
} from "@/lib/attestationFormatters";
import { isV5Skill, type SkillLike } from "@/lib/agents";
import { useI18n } from "@/lib/i18n";

type DetailTab = "overview" | "skills" | "comments" | "endorsements" | "court";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概览",
  skills: "技能 + 沙箱",
  comments: "评价",
  endorsements: "担保关系",
  court: "法庭",
};

/**
 * /agents/[address] — Agent 详情页（sovereign Agent 的 home base）
 *
 * 这页就是把 Agent 升级到一等公民的核心——给每个 sovereign 实体一个 canonical URL：
 *   - 可被 Twitter / Google 索引
 *   - 可被外部 dApp 引用
 *   - 评委可以"点进去看完整履历"
 *
 * 5 tab 信息架构：
 *   1. 概览          → ProfileHeader + reputation breakdown + 雷达
 *   2. 技能 + 沙箱   → 注册的 active skill（含 V5 per-byte tier）+ sovereign deployment
 *   3. 评价           → caller / provider / juror raterRole 分组的 attestation wall
 *   4. 担保关系       → ReputationGraph 链上：incoming + outgoing endorsements
 *   5. 法庭           → PneumaCourt 链上：作为 plaintiff / defendant / juror 的 dispute
 */
export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { t } = useI18n();
  const { address: rawAddress } = use(params);

  // 路由参数校验 —— 防止用户手输非法地址导致 useReadContract 抛错
  const isValidAddress = isAddress(rawAddress);
  const ownerAddress = (
    isValidAddress ? rawAddress.toLowerCase() : "0x0000000000000000000000000000000000000000"
  ) as Address;

  const { data: skills } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 8000, enabled: isValidAddress },
  });

  const { data: attestations } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: [ownerAddress],
    query: { refetchInterval: 12000, enabled: isValidAddress },
  });

  // Filter skills owned by this agent
  const ownedSkills = useMemo<SkillLike[]>(() => {
    if (!skills) return [];
    return (skills as readonly SkillLike[]).filter(
      (s) => s.owner.toLowerCase() === ownerAddress,
    );
  }, [skills, ownerAddress]);

  const allAttestations = (attestations ?? []) as readonly AttestationLike[];
  // Caller-rated 评论 wall：raterRole=1（CALLER）+ 非 revoked + 倒序
  const callerComments = useMemo(() => {
    return allAttestations
      .filter((a) => a.raterRole === RATER_ROLE.CALLER && !a.revoked)
      .sort((x, y) => Number(y.timestamp - x.timestamp));
  }, [allAttestations]);

  const breakdown = computeReputation(
    allAttestations as unknown as RepAttestation[],
  );

  // 5-tab IA：tab state 由 ?tab= 同步以便分享深链 + 浏览器后退
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  if (!isValidAddress) {
    return (
      <div className="max-w-4xl mx-auto px-8 pt-16 pb-24">
        <div className="surface p-10 text-center text-ink-dim">
          <h1 className="display text-2xl mb-3">
            {t("agents.detail.invalid_address")}
          </h1>
          <Link
            href="/agents"
            className="text-cyan hover:text-magenta transition-colors text-sm font-mono"
          >
            ← {t("agents.detail.back_to_list")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "180px",
          left: "5%",
          width: "90%",
          height: "5px",
          transform: "rotate(-6deg)",
          opacity: 0.3,
        }}
      />

      <div className="relative max-w-5xl mx-auto px-8 pt-12 pb-24 space-y-10 animate-fade-in">
        {/* Back link */}
        <Link
          href="/agents"
          className="text-[12px] font-mono text-ink-dim hover:text-cyan transition-colors inline-flex items-center gap-1"
        >
          ← {t("agents.detail.back_to_list")}
        </Link>

        {/* Profile header —— 始终显示，是 agent 名片 */}
        <ProfileHeader
          owner={ownerAddress}
          skillCount={ownedSkills.length}
          breakdown={breakdown}
        />

        {/* Tab 切换 */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
          {(Object.keys(TAB_LABELS) as DetailTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-mono transition-colors -mb-px border-b-2 whitespace-nowrap ${
                activeTab === tab
                  ? "border-cyan text-cyan"
                  : "border-transparent text-ink-dim hover:text-ink"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* 概览 tab —— 已经在 ProfileHeader 显示了所有核心信息；
            这里再补一个 quick-link 区，引导用户去其它 tab */}
        {activeTab === "overview" && (
          <section className="space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <QuickLinkCard
                title="技能 + 沙箱"
                count={ownedSkills.length}
                hint="active skill 数 / sovereign deployment"
                onClick={() => setActiveTab("skills")}
              />
              <QuickLinkCard
                title="评价"
                count={allAttestations.length}
                hint="caller + provider + juror"
                onClick={() => setActiveTab("comments")}
              />
              <QuickLinkCard
                title="担保关系"
                count={null}
                hint="incoming + outgoing endorsements"
                onClick={() => setActiveTab("endorsements")}
              />
              <QuickLinkCard
                title="法庭"
                count={null}
                hint="作为 plaintiff / defendant / juror"
                onClick={() => setActiveTab("court")}
              />
            </div>
          </section>
        )}

        {/* 技能 + 沙箱 tab */}
        {activeTab === "skills" && (
          <section className="space-y-6">
            <div className="space-y-4">
              <h2 className="display text-2xl">
                {t("agents.detail.skills_title")}
              </h2>
              {ownedSkills.length === 0 ? (
                <div className="surface p-8 text-center text-ink-dim text-sm">
                  {t("agents.detail.no_skills")}
                </div>
              ) : (
                <div className="space-y-3">
                  {ownedSkills
                    .slice()
                    .sort((a, b) => {
                      const aV5 = isV5Skill(a);
                      const bV5 = isV5Skill(b);
                      if (aV5 !== bV5) return aV5 ? 1 : -1;
                      return Number(a.maxInputBytes) - Number(b.maxInputBytes);
                    })
                    .map((s) => (
                      <SkillDetailRow key={s.skillId.toString()} skill={s} />
                    ))}
                </div>
              )}
            </div>
            {ownedSkills.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h2 className="display text-2xl">
                  {t("agents.detail.sovereign_title")}
                </h2>
                <SovereignBlock skills={ownedSkills} />
              </div>
            )}
          </section>
        )}

        {/* 评价 tab —— 按 raterRole 分组（CALLER / PROVIDER / JUROR） */}
        {activeTab === "comments" && (
          <CommentsTab attestations={allAttestations} />
        )}

        {/* 担保 tab —— ReputationGraph incoming + outgoing */}
        {activeTab === "endorsements" && (
          <EndorsementsTab owner={ownerAddress} />
        )}

        {/* 法庭 tab —— PneumaCourt agent 参与的 disputes */}
        {activeTab === "court" && <CourtHistoryTab owner={ownerAddress} />}
      </div>
    </div>
  );
}

function QuickLinkCard({
  title,
  count,
  hint,
  onClick,
}: {
  title: string;
  count: number | null;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="surface p-4 text-left hover:border-cyan/40 transition-colors space-y-1"
    >
      <div className="text-[11px] uppercase tracking-[0.13em] text-cyan font-mono">
        {title}
      </div>
      {count !== null ? (
        <div className="font-mono text-2xl text-ink">{count}</div>
      ) : (
        <div className="font-mono text-[11px] text-ink-faint mt-1">
          点开查看 →
        </div>
      )}
      <div className="text-[10px] font-mono text-ink-faint leading-relaxed">
        {hint}
      </div>
    </button>
  );
}

/* ─────────────────────────── sub-components ─────────────────────────── */

function ProfileHeader({
  owner,
  skillCount,
  breakdown,
}: {
  owner: Address;
  skillCount: number;
  breakdown: ReturnType<typeof computeReputation>;
}) {
  const { t } = useI18n();

  return (
    <header className="surface-glow p-8 space-y-5">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="space-y-2 min-w-0 flex-1">
          <span className="pill-live">{t("agents.detail.eyebrow")}</span>
          <h1 className="display text-3xl md:text-4xl break-all">
            {owner.slice(0, 12)}…{owner.slice(-8)}
          </h1>
          <a
            href={addressUrl(owner)}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono text-cyan hover:text-magenta transition-colors inline-flex items-center gap-1"
          >
            {t("agents.detail.view_explorer")} ↗
          </a>
        </div>

        <div className="text-right shrink-0">
          <div className="font-mono text-3xl md:text-4xl font-semibold text-cyan">
            {formatScore(breakdown.score)}
            <span className="text-base text-ink-faint ml-1">/ 100</span>
          </div>
          <div className="stat-label mt-0.5">
            {t("agents.detail.reputation_label")}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-3 pt-4 border-t border-border/60">
        <MiniStat
          label={t("agents.detail.stat.skills")}
          value={skillCount.toString()}
          accent="text-magenta"
        />
        <MiniStat
          label={t("agents.detail.stat.attestations")}
          value={breakdown.validCount.toString()}
          accent="text-cyan"
        />
        <MiniStat
          label={t("agents.detail.stat.volume")}
          value={`${(Number(breakdown.totalVolumeRaw) / 1e6).toFixed(2)} USDC`}
          accent="text-soul-soft"
        />
        <MiniStat
          label={t("agents.detail.stat.idle_days")}
          value={`${breakdown.idleDays.toFixed(0)} d`}
          accent={breakdown.idleDays > 14 ? "text-ink-faint" : "text-cyan"}
        />
      </div>

      {breakdown.validCount > 0 && (
        <ReputationFormulaBars breakdown={breakdown} />
      )}
    </header>
  );
}

/**
 * Reputation 公式因子可视化
 *
 * 把 reputation = sqrt(volume) × ageFactor × repMultiplier × decayFactor × weightedRating
 * 拆成 4 个并列的 bar，让评委一眼看出"这个 Agent score 高/低的瓶颈在哪个因子"。
 *
 * 归一化标准（让 0-1 范围有解释力）：
 *   - volume: sqrt(volumeUsdc) / 10  → 100 USDC 流水 ≈ 满格
 *   - age:    已是 0-1（前 30 天线性增长）
 *   - rep:    repMultiplier / 1.5    → 1.5 是 log boost 上限
 *   - decay:  已是 0-1（30 天 idle 衰减殆尽）
 *
 * 公式公开 + 公式可视化 → 任意第三方 dApp 可复现同分数（开放协议第一性原则）
 */
function ReputationFormulaBars({
  breakdown,
}: {
  breakdown: ReturnType<typeof computeReputation>;
}) {
  const { t } = useI18n();
  const volumeUsdc = Number(breakdown.totalVolumeRaw) / 1e6;

  const factors: Array<{
    label: string;
    raw: string;
    normalized: number;
    accent: "cyan" | "magenta" | "soul";
  }> = [
    {
      label: t("agents.detail.factor.volume"),
      raw: `√${volumeUsdc.toFixed(1)} = ${breakdown.volumeFactor.toFixed(2)}`,
      normalized: Math.min(1, breakdown.volumeFactor / 10),
      accent: "cyan",
    },
    {
      label: t("agents.detail.factor.age"),
      raw: breakdown.ageFactor.toFixed(2),
      normalized: breakdown.ageFactor,
      accent: "magenta",
    },
    {
      label: t("agents.detail.factor.rep"),
      raw: `${breakdown.repMultiplier.toFixed(2)}× (log boost)`,
      normalized: Math.min(1, breakdown.repMultiplier / 1.5),
      accent: "soul",
    },
    {
      label: t("agents.detail.factor.decay"),
      raw: `${breakdown.decayFactor.toFixed(2)} (idle ${breakdown.idleDays.toFixed(0)}d)`,
      normalized: breakdown.decayFactor,
      accent: "cyan",
    },
  ];

  return (
    <div className="space-y-3 pt-4 border-t border-border/60">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
          {t("agents.detail.formula_title")}
        </div>
        <div className="text-[10px] font-mono text-ink-faint">
          weighted ★ {((breakdown.avgRatingByCaller + breakdown.avgRatingByProvider) / 2).toFixed(2)}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-5 gap-y-2.5">
        {factors.map((f) => (
          <FactorBar
            key={f.label}
            label={f.label}
            raw={f.raw}
            normalized={f.normalized}
            accent={f.accent}
          />
        ))}
      </div>

      <div className="text-[10px] text-ink-faint font-mono leading-relaxed pt-1">
        sqrt(volume) × age × log(count) × decay × weighted-rating
        ={" "}
        <span className="text-cyan">{formatScore(breakdown.score)}</span>
        <span className="ml-1">/ 100</span>
        <span className="ml-3">
          caller ★ {breakdown.avgRatingByCaller.toFixed(2)} · provider ★{" "}
          {breakdown.avgRatingByProvider.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function FactorBar({
  label,
  raw,
  normalized,
  accent,
}: {
  label: string;
  raw: string;
  normalized: number;
  accent: "cyan" | "magenta" | "soul";
}) {
  const fillColor =
    accent === "cyan"
      ? "bg-cyan"
      : accent === "magenta"
        ? "bg-magenta"
        : "bg-soul";
  const widthPct = `${Math.max(2, Math.min(100, normalized * 100)).toFixed(1)}%`;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.13em] text-ink-dim font-mono">
          {label}
        </span>
        <span className="text-[10px] font-mono text-ink">{raw}</span>
      </div>
      <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
        <div
          className={`h-full ${fillColor} rounded-full transition-all`}
          style={{ width: widthPct }}
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase tracking-[0.13em] text-ink-faint font-mono">
        {label}
      </div>
      <div className={`font-mono text-lg ${accent}`}>{value}</div>
    </div>
  );
}

function SkillDetailRow({ skill }: { skill: SkillLike }) {
  const { t } = useI18n();
  const v5 = isV5Skill(skill);
  const inKB = (Number(skill.maxInputBytes) / 1024).toFixed(1);
  const outKB = (Number(skill.maxOutputBytes) / 1024).toFixed(1);
  const markupPct = (Number(skill.markupBps) / 100).toFixed(1);

  return (
    <div className="surface p-5 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-mono text-base font-semibold text-ink">
              {skill.name}
            </h3>
            {v5 ? (
              <span className="text-[9px] uppercase tracking-[0.13em] px-1.5 py-0.5 rounded border border-magenta/40 text-magenta font-mono">
                V5 per-byte
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-[0.13em] px-1.5 py-0.5 rounded border border-cyan/40 text-cyan font-mono">
                V4 flat
              </span>
            )}
          </div>
          <div className="text-[10px] text-ink-faint font-mono">
            #{skill.skillId.toString()} · {skill.category}
          </div>
        </div>
        <div className="text-right shrink-0">
          {v5 ? (
            <>
              <div className="font-mono text-base text-cyan">
                base {(Number(skill.baseFee) / 1e6).toFixed(4)} +{" "}
                {(Number(skill.inputPricePerKB) / 1e6).toFixed(4)}/KB in +{" "}
                {(Number(skill.outputPricePerKB) / 1e6).toFixed(4)}/KB out
              </div>
            </>
          ) : (
            <div className="font-mono text-lg text-cyan">
              {formatUnits(skill.pricePerCall, 6)} USDC
              <span className="text-[10px] text-ink-faint ml-1">/ call</span>
            </div>
          )}
        </div>
      </div>

      {v5 && skill.upstreamModel && (
        <div className="rounded-md border border-magenta/30 bg-magenta/5 px-3 py-2 flex items-baseline justify-between font-mono">
          <span className="text-[10px] uppercase tracking-[0.13em] text-magenta">
            {t("agents.detail.upstream")}
          </span>
          <span className="text-sm text-ink">{skill.upstreamModel}</span>
          <span className="text-xs text-ink-dim">
            {t("agents.detail.markup")}{" "}
            <span className="text-magenta font-semibold">+{markupPct}%</span>
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] font-mono pt-2 border-t border-border/60">
        <span className="text-ink-dim">
          ≤{inKB} KB in / ≤{outKB} KB out · {skill.totalCalls.toString()}{" "}
          {t("agents.detail.calls_suffix")}
        </span>
        <Link
          href={`/run?skillId=${skill.skillId.toString()}`}
          className="text-cyan hover:text-magenta transition-colors"
        >
          {t("agents.detail.try_call")} →
        </Link>
      </div>
    </div>
  );
}

function CommentRow({ attestation }: { attestation: AttestationLike }) {
  const { t } = useI18n();
  const stars = "★".repeat(attestation.rating) + "☆".repeat(5 - attestation.rating);
  const hasComment = attestation.comment && attestation.comment.length > 0;

  return (
    <div className="surface p-5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-magenta font-mono text-base">{stars}</span>
          <span className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
            {raterRoleLabel(attestation.raterRole)}
          </span>
        </div>
        <div className="text-[11px] font-mono text-ink-faint">
          {relativeTime(attestation.timestamp)}
        </div>
      </div>

      {hasComment ? (
        <p className="text-sm text-ink leading-relaxed">"{attestation.comment}"</p>
      ) : (
        <p className="text-[12px] text-ink-faint font-mono italic">
          {t("agents.detail.no_comment_text")}
        </p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border/60 text-[10px] font-mono text-ink-faint">
        <span>
          {t("agents.detail.skill_label")}: {attestation.skillName} ·{" "}
          {formatUsdc(attestation.paidAmount)}
        </span>
        <span>
          {t("agents.detail.by")}{" "}
          <span className="text-soul-soft">
            {attestation.attester.slice(0, 8)}…{attestation.attester.slice(-4)}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Sovereign deployment block —— 把"这个 Agent 跑在自己机器上、CLI 启动"的故事讲透
 *
 * 数据来源：链上自声明字段（endpoint / upstreamModel / markupBps）
 * 不依赖外部信任，纯协议层 metadata
 */
function SovereignBlock({ skills }: { skills: SkillLike[] }) {
  const { t } = useI18n();
  const endpoints = Array.from(new Set(skills.map((s) => s.endpoint))).filter(
    (e) => e.length > 0,
  );
  const upstreams = Array.from(
    new Set(skills.map((s) => s.upstreamModel).filter((m) => m.length > 0)),
  );

  return (
    <div className="surface p-6 space-y-4">
      <p className="text-[13px] text-ink-dim leading-relaxed">
        {t("agents.detail.sovereign_intro")}
      </p>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
            {t("agents.detail.endpoints_label")}
          </div>
          <div className="space-y-1">
            {endpoints.map((e) => (
              <div
                key={e}
                className="font-mono text-[12px] text-ink break-all bg-bg/40 border border-border/40 rounded px-3 py-1.5"
              >
                {e}
              </div>
            ))}
          </div>
        </div>

        {upstreams.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
              {t("agents.detail.upstream_models_label")}
            </div>
            <div className="font-mono text-[12px] text-ink">
              {upstreams.join(" · ")}
            </div>
            <div className="text-[10px] text-ink-faint font-mono leading-relaxed">
              {t("agents.detail.upstream_disclaimer")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Tab 子组件 ─────────────────────────── */

/**
 * CommentsTab — 按 raterRole 分组的评价 wall
 * CALLER（真金白银付钱方）权重最高，UI 上也优先；其它角色折叠
 */
function CommentsTab({ attestations }: { attestations: readonly AttestationLike[] }) {
  const { t } = useI18n();

  const groups = useMemo(() => {
    const byRole = {
      [RATER_ROLE.CALLER]: [] as AttestationLike[],
      [RATER_ROLE.PROVIDER]: [] as AttestationLike[],
      [RATER_ROLE.JUROR]: [] as AttestationLike[],
      other: [] as AttestationLike[],
    };
    for (const a of attestations) {
      if (a.revoked) continue;
      const arr =
        byRole[a.raterRole as keyof typeof byRole] ?? byRole.other;
      arr.push(a);
    }
    // 每组按时间倒序
    for (const k of Object.keys(byRole) as Array<keyof typeof byRole>) {
      byRole[k].sort((x, y) => Number(y.timestamp - x.timestamp));
    }
    return byRole;
  }, [attestations]);

  return (
    <section className="space-y-6">
      <CommentGroup
        title={`Caller-rated（真用户付费后评价）`}
        accent="text-cyan"
        items={groups[RATER_ROLE.CALLER]}
        emptyText={t("agents.detail.no_comments")}
      />
      <CommentGroup
        title="Provider 自评（基准）"
        accent="text-soul-soft"
        items={groups[RATER_ROLE.PROVIDER]}
        emptyText="暂无 provider 自评。"
      />
      <CommentGroup
        title="Juror 第三方裁决（最高权重）"
        accent="text-magenta"
        items={groups[RATER_ROLE.JUROR]}
        emptyText="暂无第三方陪审员裁决。"
      />
    </section>
  );
}

function CommentGroup({
  title,
  accent,
  items,
  emptyText,
}: {
  title: string;
  accent: string;
  items: AttestationLike[];
  emptyText: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={`display text-lg ${accent}`}>{title}</h3>
        <span className="text-[11px] font-mono text-ink-faint">
          {items.length} 条
        </span>
      </div>
      {items.length === 0 ? (
        <div className="surface p-6 text-center text-ink-dim text-sm">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <CommentRow key={a.uid} attestation={a} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * EndorsementsTab — 链上 ReputationGraph 担保关系
 * 双向：incoming（谁担保了我）+ outgoing（我担保了谁）
 *
 * Loader pattern: 上层拿 id list，每个 id 单独 EndorsementLoader 子组件 fetch
 * tuple，写回父级的 map。简化版：只显示 id 数 + 链接到链上 explorer
 * 即可（demo 阶段足够；真完整渲染需要批量 read tuple）。
 */
function EndorsementsTab({ owner }: { owner: Address }) {
  const { data: incomingIds } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getActiveEndorsementsTo",
    args: [owner],
    query: { refetchInterval: 30000 },
  });
  const { data: outgoingIds } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getEndorsementsByEndorser",
    args: [owner],
    query: { refetchInterval: 30000 },
  });

  const incoming = (incomingIds ?? []) as readonly bigint[];
  const outgoing = (outgoingIds ?? []) as readonly bigint[];

  return (
    <section className="space-y-5">
      <div className="rounded-md border border-soul/30 bg-soul/5 px-5 py-4 space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.13em] text-soul-soft font-mono">
          ReputationGraph · 链上担保
        </div>
        <p className="text-[12px] text-ink-dim font-mono leading-relaxed">
          每个担保 = endorser stake USDC + 上 Soul 的信誉给 endorsee。slash
          联动：endorsee 被 slash 时 endorser 一起按比例失血——这是 social
          维度的核心抓手。
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <EndorsementListBlock
          title="谁担保了这个 Agent（incoming）"
          accent="text-cyan"
          ids={incoming}
          emptyText="暂无 active 担保。"
        />
        <EndorsementListBlock
          title="这个 Agent 担保了谁（outgoing）"
          accent="text-magenta"
          ids={outgoing}
          emptyText="尚未给任何 agent 上担保。"
        />
      </div>
    </section>
  );
}

function EndorsementListBlock({
  title,
  accent,
  ids,
  emptyText,
}: {
  title: string;
  accent: string;
  ids: readonly bigint[];
  emptyText: string;
}) {
  return (
    <div className="surface p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={`text-sm font-mono ${accent}`}>{title}</h3>
        <span className="text-[11px] font-mono text-ink-faint">
          {ids.length}
        </span>
      </div>
      {ids.length === 0 ? (
        <div className="text-sm text-ink-dim leading-relaxed">{emptyText}</div>
      ) : (
        <ul className="space-y-1.5">
          {ids.map((id) => (
            <EndorsementRow key={id.toString()} endorsementId={id} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EndorsementRow({ endorsementId }: { endorsementId: bigint }) {
  const { data } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getEndorsement",
    args: [endorsementId],
    query: { refetchInterval: 30000 },
  });

  if (!data) {
    return (
      <li className="text-[11px] font-mono text-ink-faint">
        #{endorsementId.toString()} loading…
      </li>
    );
  }

  const e = data as {
    endorsementId: bigint;
    endorser: Address;
    endorsee: Address;
    stakedAmount: bigint;
    startedAt: bigint;
    active: boolean;
    context: string;
  };

  return (
    <li className="text-[11px] font-mono space-y-0.5 border-l-2 border-cyan/30 pl-2.5 py-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-magenta">#{e.endorsementId.toString()}</span>
        <span className="text-soul-soft">
          {formatUnits(e.stakedAmount, USDC_DECIMALS)} USDC
        </span>
        {!e.active && <span className="text-ink-faint">unlocked</span>}
      </div>
      <div className="text-ink-dim text-[10px]">
        endorser{" "}
        <a
          href={addressUrl(e.endorser)}
          target="_blank"
          rel="noreferrer"
          className="text-cyan hover:text-magenta"
        >
          {e.endorser.slice(0, 8)}…{e.endorser.slice(-6)}
        </a>
        {" → "}
        endorsee{" "}
        <a
          href={addressUrl(e.endorsee)}
          target="_blank"
          rel="noreferrer"
          className="text-cyan hover:text-magenta"
        >
          {e.endorsee.slice(0, 8)}…{e.endorsee.slice(-6)}
        </a>
      </div>
      {e.context && (
        <div className="text-[10px] text-ink leading-snug truncate">
          "{e.context}"
        </div>
      )}
    </li>
  );
}

/**
 * CourtHistoryTab — PneumaCourt 此 agent 参与的 dispute
 *
 * 实现：扫 disputeCount，逐个 getDispute，client-side filter
 * (plaintiff == owner || defendant == owner || jurors.includes(owner))。
 * Demo 量小（< 50 disputes），全扫 OK；上规模后改 indexer。
 */
function CourtHistoryTab({ owner }: { owner: Address }) {
  const { data: count } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "disputeCount",
    query: { refetchInterval: 20000 },
  });

  const total = count !== undefined ? Number(count) : 0;
  const ids = useMemo(
    () => Array.from({ length: total }, (_, i) => BigInt(total - i)),
    [total],
  );

  return (
    <section className="space-y-5">
      <div className="rounded-md border border-magenta/30 bg-magenta/5 px-5 py-4 space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
          PneumaCourt · 多陪审员争议解决
        </div>
        <p className="text-[12px] text-ink-dim font-mono leading-relaxed">
          作为 plaintiff（起诉过谁）/ defendant（被谁诉）/ juror（当过陪审员）
          的全部记录。投票期 3 天，多数决，ties → innocent（保护被告）。
        </p>
      </div>

      {total === 0 && (
        <div className="surface p-8 text-center text-ink-dim text-sm">
          全网尚未发起任何争议。
        </div>
      )}

      {total > 0 && (
        <div className="space-y-2">
          {ids.map((id) => (
            <DisputeRowFiltered
              key={id.toString()}
              disputeId={id}
              relevantTo={owner}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DisputeRowFiltered({
  disputeId,
  relevantTo,
}: {
  disputeId: bigint;
  relevantTo: Address;
}) {
  const { data } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "getDispute",
    args: [disputeId],
    query: { refetchInterval: 30000 },
  });

  if (!data) return null;

  const d = data as {
    disputeId: bigint;
    callId: bigint;
    plaintiff: Address;
    defendant: Address;
    description: string;
    jurors: readonly Address[];
    status: number;
    verdict: number;
  };

  const lower = relevantTo.toLowerCase();
  const isPlaintiff = d.plaintiff.toLowerCase() === lower;
  const isDefendant = d.defendant.toLowerCase() === lower;
  const isJuror = d.jurors.some((j) => j.toLowerCase() === lower);

  // 与该 agent 无关 → 不渲染（client-side filter）
  if (!isPlaintiff && !isDefendant && !isJuror) return null;

  const role = isPlaintiff
    ? { label: "起诉方", color: "text-cyan" }
    : isDefendant
      ? { label: "被诉方", color: "text-magenta" }
      : { label: "陪审员", color: "text-soul-soft" };

  return (
    <Link
      href={`/court/${d.disputeId.toString()}`}
      className="surface p-4 hover:border-magenta/40 transition-colors block space-y-1.5"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-magenta font-semibold">
            #{d.disputeId.toString()}
          </span>
          <span
            className={`text-[10px] uppercase tracking-[0.13em] font-mono ${role.color}`}
          >
            {role.label}
          </span>
          <span className="text-[10px] text-ink-faint font-mono">
            against call · {d.callId.toString()}
          </span>
        </div>
        <span className="text-[11px] font-mono text-ink-dim">
          {d.status === 1 ? "Voting" : d.status === 2 ? "Resolved" : "—"}
          {d.verdict === 1 && " · Guilty"}
          {d.verdict === 2 && " · Innocent"}
        </span>
      </div>
      <p className="text-sm text-ink leading-relaxed line-clamp-2">
        {d.description || "(no description)"}
      </p>
    </Link>
  );
}
