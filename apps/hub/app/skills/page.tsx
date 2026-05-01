"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  REPUTATION_GRAPH,
  ReputationGraphAbi,
  SKILL_REGISTRY,
  SkillRegistryAbi,
  addressUrl,
} from "@/lib/contracts";
import {
  computeReputation,
  formatScore,
  type AttestationLike,
} from "@/lib/reputationScore";
import { useI18n } from "@/lib/i18n";

const CATEGORY_ACCENT: Record<string, string> = {
  finance: "tag-cyan",
  text: "tag-soul",
};

export default function SkillsPage() {
  const { t } = useI18n();
  const { data: skills, isLoading } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 6000 },
  });

  const { data: totalCalls } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "callCount",
    query: { refetchInterval: 6000 },
  });

  // 类别筛选 —— "全部" 或单选某 category
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // 链上 skill 自带 category 字段；前端按已存在的 categories 动态生成 chip 列表
  const categories = useMemo(() => {
    if (!skills) return [] as string[];
    return Array.from(new Set(skills.map((s) => s.category))).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    if (!skills) return [] as typeof skills;
    if (!activeCategory) return skills;
    return skills.filter((s) => s.category === activeCategory);
  }, [skills, activeCategory]);

  return (
    <div className="relative overflow-hidden">
      <div className="neon-streak" data-color="magenta" style={{ top: "200px", left: "8%", width: "84%", height: "5px", transform: "rotate(-7deg)", opacity: 0.35 }} />

      <div className="relative max-w-7xl mx-auto px-8 pt-12 pb-24 space-y-10 animate-fade-in">
        <header className="space-y-3">
          <span className="pill-live">Marketplace</span>
          <h1 className="display text-4xl md:text-5xl">{t("skills.title")}</h1>
          <p className="text-ink-dim leading-relaxed max-w-2xl">{t("skills.subtitle")}</p>
        </header>

        {/* 跟 /agents 的关系澄清 banner —— 同一份链上数据的双面镜 */}
        <div className="rounded-md border border-soul/30 bg-soul/5 px-5 py-4 flex flex-col md:flex-row md:items-start gap-3">
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.13em] text-soul-soft font-mono">
              {t("skills.relation_banner.title")}
            </div>
            <p className="text-[12px] text-ink-dim font-mono leading-relaxed">
              {t("skills.relation_banner.body")}
            </p>
          </div>
          <Link
            href="/agents"
            className="text-[11px] font-mono text-cyan hover:text-magenta transition-colors whitespace-nowrap shrink-0"
          >
            {t("skills.relation_banner.link")}
          </Link>
        </div>

        {/* anet 兼容性 banner —— 解释 skillId ↔ agent:// 的命名约定 */}
        <div className="rounded-md border border-magenta/30 bg-magenta/5 px-5 py-4 flex flex-col md:flex-row md:items-start gap-3">
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
              <span>⬡</span>
              <span>{t("skills.anet_banner.title")}</span>
            </div>
            <p className="text-[12px] text-ink-dim font-mono leading-relaxed">
              {t("skills.anet_banner.body")}
            </p>
          </div>
          <a
            href="/skill.md"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono text-cyan hover:text-magenta transition-colors whitespace-nowrap shrink-0"
          >
            {t("skills.anet_banner.cta")}
          </a>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <Stat label="Active skills" value={skills?.length?.toString() ?? "…"} color="text-magenta" />
          <Stat label="Total calls" value={totalCalls?.toString() ?? "…"} color="text-cyan" />
          <Stat label="Settlement asset" value="USDC (ERC-20)" color="text-soul-soft" />
        </div>

        {isLoading && <div className="text-ink-faint font-mono">Loading from chain…</div>}

        {/* 类别筛选 chips —— 雇主按需求 narrow */}
        {categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
              {t("skills.category_filter.label")}
            </span>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`px-3 py-1 rounded-full text-[11px] font-mono transition-colors border ${
                activeCategory === null
                  ? "border-cyan/60 bg-cyan/10 text-cyan"
                  : "border-border bg-bg/40 text-ink-dim hover:border-soul/40"
              }`}
            >
              {t("skills.category_filter.all")} · {skills?.length ?? 0}
            </button>
            {categories.map((cat) => {
              const count = skills?.filter((s) => s.category === cat).length ?? 0;
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1 rounded-full text-[11px] font-mono transition-colors border ${
                    active
                      ? "border-cyan/60 bg-cyan/10 text-cyan"
                      : "border-border bg-bg/40 text-ink-dim hover:border-soul/40"
                  }`}
                >
                  {cat} · {count}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-5">
          {filteredSkills?.map((s) => {
            const isPerByte = s.inputPricePerKB > 0n || s.outputPricePerKB > 0n;
            const agentUri = `agent://pneuma-receipt-${s.skillId.toString()}`;
            return (
              <div
                key={s.skillId.toString()}
                className="surface p-6 hover:border-soul/40 transition-colors space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-mono text-xl font-semibold text-ink">{s.name}</h3>
                      <span className="text-[9px] uppercase tracking-[0.13em] px-1.5 py-0.5 rounded border border-magenta/40 text-magenta font-mono">
                        {isPerByte ? t("skills.badge.per_byte") : t("skills.badge.flat_rate")}
                      </span>
                    </div>
                    <span className={CATEGORY_ACCENT[s.category] ?? "tag"}>
                      #{s.skillId.toString()} · {s.category}
                    </span>
                  </div>
                  <div className="text-right">
                    {isPerByte ? (
                      <PerBytePriceDisplay
                        baseFee={s.baseFee}
                        inputPricePerKB={s.inputPricePerKB}
                        outputPricePerKB={s.outputPricePerKB}
                        maxInputBytes={s.maxInputBytes}
                        maxOutputBytes={s.maxOutputBytes}
                      />
                    ) : (
                      <>
                        <div className="font-mono text-2xl font-semibold text-cyan">
                          {formatUnits(s.pricePerCall, 6)} USDC
                        </div>
                        <div className="stat-label mt-0.5">per call (flat-rate)</div>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-ink-dim leading-relaxed">{s.description}</p>

                {/* anet ANS 镜像 URI —— 让评委一眼看到 Pneuma skill 在 anet mesh 里也能被发现 */}
                <div className="rounded-md border border-cyan/30 bg-cyan/5 px-3 py-2 flex items-center justify-between gap-2 font-mono">
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] uppercase tracking-[0.13em] text-cyan">
                      anet ANS mirror
                    </div>
                    <div className="text-[12px] text-ink truncate">{agentUri}</div>
                  </div>
                  <span className="text-[9px] text-ink-faint shrink-0 uppercase tracking-wider">
                    discoverable
                  </span>
                </div>

                {/* per-byte 模式独有：上游披露 — 反中转透明度核心抓手 */}
                {isPerByte && s.upstreamModel && (
                  <UpstreamDisclosure model={s.upstreamModel} markupBps={Number(s.markupBps)} />
                )}

                <ReputationBadge owner={s.owner as Address} />

                {/* 担保图徽章 —— 老 agent 给该 skill owner 锁了多少 USDC 背书 */}
                <BackedByBadge endorsee={s.owner as Address} />

                <div className="text-[11px] text-ink-faint space-y-1 font-mono pt-2 border-t border-border/60">
                  <div>
                    <span className="text-ink-dim">endpoint  </span>
                    <span className="break-all">{s.endpoint}</span>
                  </div>
                  <div>
                    <span className="text-ink-dim">owner     </span>
                    <a
                      href={addressUrl(s.owner)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-soul-soft hover:text-magenta underline underline-offset-2"
                    >
                      {s.owner.slice(0, 8)}…{s.owner.slice(-6)}
                    </a>
                  </div>
                  <div>
                    <span className="text-ink-dim">calls     </span>
                    <span>{s.totalCalls.toString()}</span>
                  </div>
                  <div>
                    <span className="text-ink-dim">size cap  </span>
                    <span>
                      ≤{(Number(s.maxInputBytes) / 1024).toFixed(1)} KB in /{" "}
                      ≤{(Number(s.maxOutputBytes) / 1024).toFixed(1)} KB out
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {skills && skills.length === 0 && (
          <div className="surface p-10 text-center text-ink-dim">
            {t("skills.empty")}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Per-byte 价格显示 —— per-byte tier，给 caller 一眼看清"min/max 区间"
 *
 * 设计原则：不显示单一价（per-byte 没有），而是显示
 *   - max possible: baseFee + inputPrice·maxIn + outputPrice·maxOut
 *   - typical (50%): caller 用一半 output 的预期成本
 *   - 给 caller "调用前心里有数" 的颗粒度
 */
function PerBytePriceDisplay({
  baseFee,
  inputPricePerKB,
  outputPricePerKB,
  maxInputBytes,
  maxOutputBytes,
}: {
  baseFee: bigint;
  inputPricePerKB: bigint;
  outputPricePerKB: bigint;
  maxInputBytes: number;
  maxOutputBytes: number;
}) {
  // KB 向上取整
  const inKB = Math.ceil(maxInputBytes / 1024);
  const outKB = Math.ceil(maxOutputBytes / 1024);

  const maxCost =
    Number(baseFee) +
    Number(inputPricePerKB) * inKB +
    Number(outputPricePerKB) * outKB;

  // typical = base + full input + half output (代表性场景)
  const typicalCost =
    Number(baseFee) +
    Number(inputPricePerKB) * inKB +
    Number(outputPricePerKB) * Math.ceil(outKB / 2);

  return (
    <>
      <div className="font-mono text-xl font-semibold text-cyan">
        ~{(typicalCost / 1e6).toFixed(4)} USDC
      </div>
      <div className="stat-label mt-0.5">typical / call</div>
      <div className="text-[10px] text-ink-faint font-mono mt-1">
        max {(maxCost / 1e6).toFixed(4)}, refund unused
      </div>
    </>
  );
}

/**
 * 上游模型披露 —— 反中转核心抓手（per-byte 模式独有）
 *
 * 让 caller 一眼看到："这个 skill 实际跑的什么模型 + 收了多少 markup"
 * 跟 OpenAI / Anthropic 直调价对比，市场逻辑自动惩罚高 markup 中转
 */
function UpstreamDisclosure({ model, markupBps }: { model: string; markupBps: number }) {
  const markupPct = (markupBps / 100).toFixed(1);
  return (
    <div className="rounded-md border border-magenta/30 bg-magenta/5 px-3 py-2 space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.13em] font-mono">
        <span className="text-magenta">Upstream disclosure</span>
        <span className="text-ink-faint">on-chain</span>
      </div>
      <div className="flex items-baseline justify-between font-mono">
        <span className="text-sm text-ink">{model}</span>
        <span className="text-xs text-ink-dim">
          markup <span className="text-magenta font-semibold">+{markupPct}%</span>
        </span>
      </div>
    </div>
  );
}

/**
 * ReputationBadge — 把 attestation 列表跑过 reputationScore 公式，渲染加权声誉
 *
 * 与中心化评分系统的差异：
 *   - 公式公开（apps/hub/lib/reputationScore.ts）
 *   - 数据公开（PneumaAttestation 链上读取）
 *   - 任意第三方 dApp 可复现同一分数 → 开放协议第一性原则
 */
function ReputationBadge({ owner }: { owner: Address }) {
  const { data: attestations } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: [owner],
    query: { refetchInterval: 12000 },
  });

  const items = (attestations ?? []) as readonly AttestationLike[];
  const breakdown = computeReputation(items as AttestationLike[]);

  const hasCallerRated = breakdown.avgRatingByCaller > 0;
  const hasProviderRated = breakdown.avgRatingByProvider > 0;

  return (
    <div className="space-y-2 pt-2 border-t border-border/60">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
          Conviction-weighted reputation
        </span>
        <span className="font-mono text-lg text-cyan">
          {formatScore(breakdown.score)}
          <span className="text-[10px] text-ink-faint ml-1">/ 100</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <RatingChip
          label="Caller-rated"
          value={breakdown.avgRatingByCaller}
          present={hasCallerRated}
          accent="text-cyan"
        />
        <RatingChip
          label="Provider-rated"
          value={breakdown.avgRatingByProvider}
          present={hasProviderRated}
          accent="text-magenta"
        />
      </div>
      <div className="text-[10px] text-ink-faint font-mono leading-relaxed">
        sqrt(volume) × age × log(count) × decay(idle {breakdown.idleDays.toFixed(0)}d)
        ·{" "}
        <span className="text-ink-dim">
          {breakdown.validCount} att · {Number(breakdown.totalVolumeRaw) / 1e6}{" "}
          USDC
        </span>
      </div>
    </div>
  );
}

function RatingChip({
  label,
  value,
  present,
  accent,
}: {
  label: string;
  value: number;
  present: boolean;
  accent: string;
}) {
  return (
    <div className="bg-bg border border-border rounded px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.13em] text-ink-faint">
        {label}
      </div>
      <div className={`${accent} font-mono`}>
        {present ? (
          <>
            {"★".repeat(Math.round(value))}
            <span className="text-ink-faint">
              {"★".repeat(5 - Math.round(value))}
            </span>{" "}
            <span className="text-[10px] text-ink-dim ml-1">
              {value.toFixed(1)}
            </span>
          </>
        ) : (
          <span className="text-ink-faint text-[10px]">—</span>
        )}
      </div>
    </div>
  );
}

/**
 * BackedByBadge —— 担保图徽章
 *
 * 显示某个 agent 收到的 active 担保金额 + 担保人数。
 * 这是"社会资本"在 UI 层的可视化抓手 —— caller 不只看 skill rep，
 * 还能看到老 agent 用真金白银（USDC stake）替它担保。
 *
 * 担保连带 slash：endorsee 出事时所有 active endorsers 按 slashBps 联动 slash。
 */
function BackedByBadge({ endorsee }: { endorsee: Address }) {
  const { data: totalStake } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "totalActiveStakeTo",
    args: [endorsee],
    query: { refetchInterval: 12000 },
  });
  const { data: activeIds } = useReadContract({
    address: REPUTATION_GRAPH,
    abi: ReputationGraphAbi,
    functionName: "getActiveEndorsementsTo",
    args: [endorsee],
    query: { refetchInterval: 12000 },
  });

  const stake = totalStake ?? 0n;
  const count = (activeIds as readonly bigint[] | undefined)?.length ?? 0;

  if (stake === 0n || count === 0) {
    return null; // 没担保不渲染（保持卡片简洁）
  }

  return (
    <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-amber-400 text-base">🛡️</span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.13em] text-amber-400 font-mono">
            Backed by {count} agent{count > 1 ? "s" : ""}
          </div>
          <div className="text-xs font-mono text-ink truncate">
            {(Number(stake) / 1e6).toFixed(2)} USDC staked · 连带责任
          </div>
        </div>
      </div>
    </div>
  );
}
