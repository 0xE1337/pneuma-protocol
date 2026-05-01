"use client";

/**
 * ReputationFormulaPanel — 声誉公式公开（折叠）
 *
 * 协议层卖点：声誉不是中心化打分，是"公式 + 数据"全开源——
 * 任意 dApp 可以用同样的输入算出同样的分数。这一面板把所有可调参数
 * 一次性摆出来，让审查者/用户/dApp 开发者立刻验证。
 *
 * 数据来源：@pneuma/reputation-formula (npm 上能装)
 *   - DIM_WEIGHTS  — 4 维权重
 *   - ROLE_WEIGHTS — raterRole 权重 (PROVIDER/CALLER/JUROR)
 *   - DECAY_LAMBDA — 30 天半衰期线性近似
 *   - AGE_RAMP_DAYS — age 因子 ramp 长度
 *   - TIERS         — 段位边界（产品决策可调，非 invariant）
 *
 * 折叠时只占 1 行，不打扰主体；点开才完整展开。
 */

import {
  DIM_WEIGHTS,
  ROLE_WEIGHTS,
  DECAY_LAMBDA,
  AGE_RAMP_DAYS,
  TIERS,
  BOUNDARY_TIERS,
  BOUNDARY_PENALTY,
} from "@pneuma/reputation-formula";

const TIER_DISPLAY_COLORS: Record<string, string> = {
  newcomer: "text-ink-faint",
  bronze: "text-amber-600",
  silver: "text-slate-300",
  gold: "text-yellow-400",
  platinum: "text-cyan",
  diamond: "text-magenta",
};

export function ReputationFormulaPanel() {
  return (
    <details className="rounded-md border border-border bg-bg/40 group">
      <summary className="cursor-pointer px-5 py-3 flex items-center gap-3 list-none select-none hover:bg-bg/70 transition-colors">
        <span className="text-cyan font-mono text-[10px] uppercase tracking-[0.13em]">
          公式公开
        </span>
        <span className="text-ink text-sm">声誉如何计算</span>
        <span className="ml-auto text-ink-faint text-[11px] font-mono group-open:rotate-90 transition-transform">
          ▶
        </span>
      </summary>

      <div className="px-5 pb-5 pt-2 space-y-4 border-t border-border/60">
        <p className="text-[12px] text-ink-dim leading-relaxed">
          声誉不是平台打的分。任何 dApp 装上 npm 包{" "}
          <code className="font-mono text-cyan">@pneuma/reputation-formula</code>{" "}
          + 链上 PneumaAttestation 数据，都能算出同一分数。下面是全部可调参数。
        </p>

        <Section title="4 维加权（DIM_WEIGHTS）">
          <Row label="Economic（付费交易）" value={`${DIM_WEIGHTS.economic} ×`} />
          <Row label="Intellectual（公地引用）" value={`${DIM_WEIGHTS.intellectual} ×`} />
          <Row label="Social（被担保 stake）" value={`${DIM_WEIGHTS.social} ×`} />
          <Row label="Judicial（陪审员准确率）" value={`${DIM_WEIGHTS.judicial} ×`} />
        </Section>

        <Section title="评分人角色权重（ROLE_WEIGHTS · 防 provider 自刷）">
          <Row label="PROVIDER 自评" value={`${ROLE_WEIGHTS[0]} ×`} />
          <Row
            label="CALLER 反向评（真金白银付钱方）"
            value={`${ROLE_WEIGHTS[1]} ×`}
          />
          <Row label="JUROR 第三方裁决" value={`${ROLE_WEIGHTS[2]} ×`} />
        </Section>

        <Section title="时间衰减">
          <Row
            label="age ramp（贡献早晚加权）"
            value={`${AGE_RAMP_DAYS} 天`}
          />
          <Row
            label="decay λ（30 天半衰期线性近似）"
            value={DECAY_LAMBDA.toFixed(3)}
          />
        </Section>

        <Section title="声誉段位（能力维度，display 0-1000 区间）">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                className="flex items-center gap-2 text-[11px] font-mono"
              >
                <span>{tier.emoji}</span>
                <span className={TIER_DISPLAY_COLORS[tier.id] ?? "text-ink"}>
                  {tier.enName}
                </span>
                <span className="text-ink-faint">
                  {tier.min}–{tier.id === "diamond" ? 1000 : tier.max - 1}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="v3 court-aware 调整">
          <Row
            label="punishmentFactor（Court guilty Laplace smoothing）"
            value="guilty / (guilty + innocent + 5)"
          />
          <Row
            label="slashedRatio（担保过的人多少被 slash）"
            value="slashed / (totalEndorsements + 1)"
          />
          <Row
            label="judicial accuracy（陪审员投票准确率）"
            value="sqrt(votes) × accuracy × decay × 8"
          />
          <Row
            label="段位 hard cap（court guilty 历史 → 钳到 Silver）"
            value="不衰减 · 永久标签"
          />
        </Section>

        <Section title="诚信段位（合规维度，反洗白阶梯）">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.values(BOUNDARY_TIERS).map((tier) => (
              <div
                key={tier.id}
                className="flex items-start gap-2 text-[11px] font-mono leading-snug"
              >
                <span>{tier.emoji}</span>
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div
                    className="font-semibold uppercase tracking-wider"
                    style={{ color: tier.color }}
                  >
                    {tier.enName} · {tier.zhName}
                  </div>
                  <div className="text-ink-faint text-[10px]">
                    {tier.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-ink-faint font-mono leading-relaxed mt-1.5">
            阶梯扣分 · 首次 -{BOUNDARY_PENALTY.FIRST_HIT} / 二次 -
            {BOUNDARY_PENALTY.SECOND_HIT} / 三次{" "}
            {BOUNDARY_PENALTY.THIRD_HIT_FREEZE
              ? "永久冻结增长"
              : "继续扣分"}
            ；rolling 12 个月窗口（窗口外触发自动滑出）。
          </div>
        </Section>

        <div className="text-[10px] text-ink-faint font-mono leading-relaxed pt-2 border-t border-border/40">
          公式实现：
          <a
            href="https://github.com/pneuma-protocol/pneuma-protocol/tree/main/packages/reputation-formula"
            target="_blank"
            rel="noreferrer"
            className="text-cyan hover:text-magenta ml-1 underline underline-offset-2"
          >
            packages/reputation-formula
          </a>
          {" · "}48 单元测试锁定参数 ·{" "}
          <a
            href="https://github.com/pneuma-protocol/pneuma-protocol/blob/main/docs/PUNISHMENT_DESIGN.md"
            target="_blank"
            rel="noreferrer"
            className="text-cyan hover:text-magenta underline underline-offset-2"
          >
            PUNISHMENT_DESIGN.md
          </a>
          {" · "}
          <a
            href="https://github.com/pneuma-protocol/pneuma-protocol/blob/main/docs/ANTI_SYBIL_DESIGN.md"
            target="_blank"
            rel="noreferrer"
            className="text-cyan hover:text-magenta underline underline-offset-2"
          >
            ANTI_SYBIL_DESIGN.md
          </a>
        </div>
      </div>
    </details>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[11px] font-mono">
      <span className="text-ink-dim">{label}</span>
      <span className="text-cyan font-semibold">{value}</span>
    </div>
  );
}
