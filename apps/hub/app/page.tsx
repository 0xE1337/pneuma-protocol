"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { AgentNetworkHero } from "@/app/_components/AgentNetworkHero";

/**
 * 主页 mockup 的 4 个 case —— 覆盖 4 类评委画像（学术 / Web3 / 大众 / 开发者）
 *
 * 设计原则：
 *   - 每个 case 必须展示"通用 LLM 干不了"的能力（实时数据 / 私有标签库 / 工具链 / EVM 执行）
 *   - 每个 skill 都对标真实在售的 SaaS（Semantic Scholar / Sourcegraph / Nansen / Tenderly / Skyscanner / Yelp / Slither+Mythril / Reservoir）
 *   - 文案部分（tab 名 / 用户请求 / 步骤 / 最终答案）走 i18n 双语
 *   - 不翻译的字段（skill 专有名词 / 价格 / 假 tx hash / 假 callId / escrow 数字）放静态数据
 *   - escrow 数据演示 x402 "一次签名上限 → N 笔原子结算 → 差额自动退款"的核心叙事
 */
const MOCKUP_CASES = [
  {
    id: "research",
    url: "hub.pneuma.protocol · /run · research",
    skill1: { name: "Paper + Cite Graph", cost: "0.03 USDC", tx: "0x4a8c14346460c824…30e01d", callId: "287" },
    skill2: { name: "Repo Deep Search", cost: "0.10 USDC", tx: "0x9ee494ed4595f2…0e85966", callId: "288" },
    escrow: { cap: "0.20 USDC", spent: "0.13 USDC", refund: "0.07 USDC" },
  },
  {
    id: "wallet_safety",
    url: "hub.pneuma.protocol · /run · wallet-safety",
    skill1: { name: "Wallet X-ray", cost: "0.10 USDC", tx: "0x7b14346460c824…30e01d", callId: "412" },
    skill2: { name: "Tx Simulate", cost: "0.10 USDC", tx: "0xe7c2845a93d81f…ab3c91", callId: "413" },
    escrow: { cap: "0.30 USDC", spent: "0.20 USDC", refund: "0.10 USDC" },
  },
  {
    id: "travel",
    url: "hub.pneuma.protocol · /run · travel",
    skill1: { name: "Flight Deal Watcher", cost: "0.05 USDC", tx: "0x3a9d22ef7c41b8…f25e10", callId: "691" },
    skill2: { name: "Restaurant Reserve", cost: "0.02 USDC", tx: "0xb6e7510de89c43…7d4f22", callId: "692" },
    escrow: { cap: "0.15 USDC", spent: "0.07 USDC", refund: "0.08 USDC" },
  },
  {
    id: "audit",
    url: "hub.pneuma.protocol · /run · audit",
    skill1: { name: "Contract Audit", cost: "0.30 USDC", tx: "0xc4e3f192a87b65…d8a04f", callId: "854" },
    skill2: { name: "NFT Fair Value", cost: "0.03 USDC", tx: "0x1d8b62e3a5f497…0c63b1", callId: "855" },
    escrow: { cap: "0.50 USDC", spent: "0.33 USDC", refund: "0.17 USDC" },
  },
] as const;

type MockupCaseId = (typeof MOCKUP_CASES)[number]["id"];

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      {/* Decorative neon streaks (Dark Centered Platform aesthetic) */}
      <div className="neon-streak" data-color="violet" style={{ top: "320px", left: "8%", width: "84%", height: "8px", transform: "rotate(-7deg)" }} />
      <div className="neon-streak" data-color="magenta" style={{ top: "680px", left: "14%", width: "70%", height: "6px", transform: "rotate(5deg)", opacity: 0.4 }} />
      <div className="neon-streak" data-color="cyan" style={{ top: "1180px", left: "5%", width: "90%", height: "5px", transform: "rotate(-9deg)", opacity: 0.35 }} />

      <div className="relative max-w-7xl mx-auto px-8">
        <AgentNetworkHero />
        <ProductMockup />
        <PillarsZone />
        <ProtocolFlow />
        <CrossPlatformHighlight />
      </div>
    </div>
  );
}

function ProductMockup() {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<MockupCaseId>("research");
  // 当前激活 case 的静态数据（skill 专有名词 / 假 tx / 假 callId）
  const c = MOCKUP_CASES.find((x) => x.id === activeId)!;
  // 当前激活 case 的 i18n key 前缀
  const k = (field: string) => `home.mockup.cases.${activeId}.${field}`;

  return (
    <section className="my-12 surface-glow overflow-hidden animate-fade-in">
      {/* Tab bar —— 4 个 case 标签，点击切换 */}
      <div className="flex flex-wrap gap-1 px-4 pt-3 border-b border-border bg-bg">
        {MOCKUP_CASES.map((mc) => {
          const isActive = mc.id === activeId;
          return (
            <button
              key={mc.id}
              type="button"
              onClick={() => setActiveId(mc.id)}
              className={`px-3 py-2 text-[11px] font-mono tracking-wide border-b-2 transition-colors ${
                isActive
                  ? "border-cyan text-cyan"
                  : "border-transparent text-ink-faint hover:text-ink"
              }`}
              aria-pressed={isActive}
            >
              {t(`home.mockup.cases.${mc.id}.tab`)}
            </button>
          );
        })}
      </div>

      {/* Browser chrome */}
      <div className="flex items-center gap-2 px-4 h-9 border-b border-border bg-bg">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="ml-6 flex items-center gap-2 px-3 py-0.5 rounded bg-border/60 text-[10px] text-ink-dim font-mono">
          <span className="text-cyan">⬣</span>
          {c.url}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 p-8">
        {/* Left: Query + plan */}
        <div className="flex flex-col gap-5">
          <div className="rounded-md p-4 bg-bg border border-soul/50">
            <div className="label mb-1.5">{t("home.mockup.user_request_label")}</div>
            <p className="text-ink text-sm leading-relaxed">
              {t(k("user_request"))}
            </p>
          </div>

          <div className="surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-magenta text-xs">⬡</span>
              <span className="text-[10px] uppercase tracking-[0.13em] text-magenta">{t("home.mockup.plan_label")}</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px] text-ink">
              <div>{t(k("step1"))}</div>
              <div>{t(k("step2"))}</div>
            </div>
          </div>
        </div>

        {/* Right: Execution + answer */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-cyan text-xs">⚡</span>
            <span className="text-[10px] uppercase tracking-[0.13em] text-cyan">{t("home.mockup.exec_label")}</span>
            <span className="ml-auto text-[10px] text-ink-dim font-mono">{t("home.mockup.exec_done")}</span>
          </div>

          <ExecRow name={c.skill1.name} cost={c.skill1.cost} tx={c.skill1.tx} callId={c.skill1.callId} />
          <ExecRow name={c.skill2.name} cost={c.skill2.cost} tx={c.skill2.tx} callId={c.skill2.callId} />

          {/* Escrow 结算总账 —— 一次签名 ≤ cap，N 笔原子结算后差额自动退款 */}
          <div className="mt-1 px-3 py-2 rounded border border-cyan/30 bg-cyan/5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono">
            <span className="flex items-center gap-1.5">
              <span className="text-cyan">⚐</span>
              <span className="text-ink-faint">{t("home.mockup.escrow_label")}</span>
              <span className="text-ink">≤ {c.escrow.cap}</span>
            </span>
            <span className="text-ink-faint">·</span>
            <span className="flex items-center gap-1.5">
              <span className="text-ink-faint">{t("home.mockup.escrow_actual_label")}</span>
              <span className="text-ink">{c.escrow.spent}</span>
            </span>
            <span className="text-ink-faint">·</span>
            <span className="flex items-center gap-1.5">
              <span className="text-ink-faint">{t("home.mockup.escrow_refund_label")}</span>
              <span className="text-soul-soft">{c.escrow.refund}</span>
            </span>
          </div>

          <div className="surface-gradient p-4 mt-1">
            <div className="text-[10px] uppercase tracking-[0.13em] text-magenta mb-2">
              {t("home.mockup.final_label")}
            </div>
            <p className="text-ink text-sm leading-relaxed">
              {t(k("final"))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExecRow({ name, cost, tx, callId }: { name: string; cost: string; tx: string; callId: string }) {
  return (
    <div className="surface p-3 flex items-center gap-3">
      <span className="text-cyan">✓</span>
      <span className="text-ink text-sm font-medium">{name}</span>
      <span className="ml-auto text-soul-soft text-xs font-mono">{cost}</span>
      <span className="text-[10px] text-ink-dim font-mono">tx {tx} · #{callId}</span>
    </div>
  );
}

function PillarsZone() {
  const { t } = useI18n();
  return (
    <section className="py-24 flex flex-col items-center text-center gap-10">
      <div className="space-y-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan font-mono">
          {t("home.pillars.eyebrow")}
        </div>
        <h2 className="display text-3xl md:text-4xl">
          {t("home.pillars.title")}
        </h2>
      </div>

      <div className="grid md:grid-cols-3 gap-5 w-full">
        <Pillar
          tag={t("home.pillars.identity.tag")}
          title={t("home.pillars.identity.title")}
          standards={t("home.pillars.identity.standards")}
          desc={t("home.pillars.identity.desc")}
        />
        <Pillar
          tag={t("home.pillars.money.tag")}
          title={t("home.pillars.money.title")}
          standards={t("home.pillars.money.standards")}
          desc={t("home.pillars.money.desc")}
        />
        <Pillar
          tag={t("home.pillars.rep.tag")}
          title={t("home.pillars.rep.title")}
          standards={t("home.pillars.rep.standards")}
          desc={t("home.pillars.rep.desc")}
        />
      </div>
    </section>
  );
}

function Pillar({ tag, title, standards, desc }: { tag: string; title: string; standards: string; desc: string }) {
  return (
    <div className="surface p-7 text-left flex flex-col gap-3 hover:border-soul/40 transition-colors">
      <span className="tag-soul w-fit">{tag}</span>
      <h3 className="font-mono font-semibold text-xl text-ink">{title}</h3>
      <div className="text-[11px] text-cyan font-mono">{standards}</div>
      <p className="text-ink-dim text-[13px] leading-relaxed">{desc}</p>
    </div>
  );
}

function ProtocolFlow() {
  const { t } = useI18n();
  const steps = [
    ["01", t("home.flow.step01"), "soul"],
    ["02", t("home.flow.step02"), "soul"],
    ["03", t("home.flow.step03"), "magenta"],
    ["04", t("home.flow.step04"), "soul"],
    ["05", t("home.flow.step05"), "magenta"],
    ["✓", t("home.flow.step_done"), "cyan"],
  ] as const;

  return (
    <section className="py-24 flex flex-col items-center gap-8">
      <div className="text-center space-y-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-cyan font-mono">{t("home.flow.eyebrow")}</div>
        <h2 className="display text-3xl md:text-4xl">{t("home.flow.title")}</h2>
      </div>

      <div className="surface p-7 w-full max-w-4xl space-y-3">
        {steps.map(([num, body, color]) => (
          <div key={num} className="flex items-start gap-5 font-mono text-[13px]">
            <span className={`shrink-0 font-semibold ${color === "soul" ? "text-soul-soft" : color === "magenta" ? "text-magenta" : "text-cyan"}`}>
              {num}
            </span>
            <span className={color === "cyan" ? "text-cyan" : "text-ink"}>{body}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CrossPlatformHighlight() {
  const { t } = useI18n();
  return (
    <section className="py-24">
      <div className="surface-gradient p-14 text-center flex flex-col items-center gap-6">
        <span className="pill-live">{t("home.cross.pill")}</span>

        <h2 className="display text-4xl md:text-5xl max-w-3xl">
          {t("home.cross.title.line1")}
          <span className="block text-magenta">{t("home.cross.title.line2")}</span>
        </h2>

        <p className="text-ink-dim text-base md:text-lg max-w-2xl leading-relaxed">
          {t("home.cross.tagline")} <strong className="text-ink">{t("home.cross.tagline_strong")}</strong>
        </p>

        <div className="flex items-center gap-4 mt-2 flex-wrap justify-center">
          {/* DAppChip 用 CSS variable 表达颜色 ring，自动跨主题切换：
              cyber 下 = violet/cyan ring；island 下 = mint ring (因为 island token
              里 --color-soul 和 --color-cyan 都映射到 mint teal) */}
          <DAppChip name={t("home.cross.dapp_a_name")} accent="soul" gradient />
          <span className="text-ink-dim font-mono">→</span>
          <DAppChip name={t("home.cross.dapp_b_name")} accent="cyan" />
          <span className="text-[11px] text-ink-faint font-mono">{t("home.cross.dapp_chips_etc")}</span>
        </div>
      </div>
    </section>
  );
}

function DAppChip({ name, accent, gradient }: { name: string; accent: "soul" | "cyan"; gradient?: boolean }) {
  // Token-driven ring + filling — cyber dark 下走 violet / cyan，island 下走 mint
  // 不再用 inline rgb literal，改成 var(--color-X) CSS reference
  const ringVar = accent === "soul" ? "var(--color-soul)" : "var(--color-cyan)";
  const fillStyle: React.CSSProperties = gradient
    ? {
        background:
          "linear-gradient(135deg, rgb(var(--color-soul)), rgb(var(--color-magenta)))",
      }
    : { background: "rgb(var(--color-cyan))" };
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 rounded-md bg-bg font-mono text-xs"
      style={{ border: `1px solid rgb(${ringVar} / 0.6)` }}
    >
      <span className="w-3.5 h-3.5 rounded-sm" style={fillStyle} />
      <span className="text-ink">{name}</span>
    </div>
  );
}
