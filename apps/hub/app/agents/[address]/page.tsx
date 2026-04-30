"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { useReadContract } from "wagmi";
import { formatUnits, isAddress, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  RATER_ROLE,
  SKILL_REGISTRY,
  SkillRegistryAbi,
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

/**
 * /agents/[address] — Agent 详情页（sovereign Agent 的 home base）
 *
 * 这页就是把 Agent 升级到一等公民的核心——给每个 sovereign 实体一个 canonical URL：
 *   - 可被 Twitter / Google 索引
 *   - 可被外部 dApp 引用
 *   - 评委可以"点进去看完整履历"
 *
 * 信息分区：
 *   1. Profile header：address + Soul indicator + reputation breakdown
 *   2. Skill ladder：该 Agent 注册的全部 active skill（含 V5 per-byte tier）
 *   3. Caller-rated attestation wall：真实用户评论文字（V5 反中转透明度的最终证据）
 *   4. Sovereign deployment：endpoints + 上游模型 + markup（自声明）
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

        {/* 1. Profile header */}
        <ProfileHeader
          owner={ownerAddress}
          skillCount={ownedSkills.length}
          breakdown={breakdown}
        />

        {/* 2. Skill ladder */}
        <section className="space-y-4">
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
                  // V4 在前（简单flat-price）, V5 按 maxInputBytes 升序（tier ladder 自然顺序）
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
        </section>

        {/* 3. Caller-rated 评论 wall — V5 反中转透明度的最终证据 */}
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display text-2xl">
              {t("agents.detail.comments_title")}
            </h2>
            <span className="text-[11px] font-mono text-ink-faint">
              {callerComments.length}{" "}
              {t("agents.detail.caller_rated_count")}
            </span>
          </div>
          {callerComments.length === 0 ? (
            <div className="surface p-8 text-center text-ink-dim text-sm">
              {t("agents.detail.no_comments")}
            </div>
          ) : (
            <div className="space-y-3">
              {callerComments.map((a) => (
                <CommentRow key={a.uid} attestation={a} />
              ))}
            </div>
          )}
        </section>

        {/* 4. Sovereign deployment block */}
        {ownedSkills.length > 0 && (
          <section className="space-y-4">
            <h2 className="display text-2xl">
              {t("agents.detail.sovereign_title")}
            </h2>
            <SovereignBlock skills={ownedSkills} />
          </section>
        )}
      </div>
    </div>
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
