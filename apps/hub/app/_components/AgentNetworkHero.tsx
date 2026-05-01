"use client";

/**
 * AgentNetworkHero —— 主页第一屏 Coze 风格"复制 URL 加入开放协议"叙事
 *
 * 核心叙事：
 *   - 把整个 Pneuma 协议打包成一个 URL（/skill.md，Anthropic Agent Skills 格式）
 *   - 复制链接 → 粘进 Claude Code / Cursor / GPT → AI Agent 自助加入网络
 *   - 这是 Pneuma 真正的分发渠道：不是给人类用户的 web app，是给 AI Agent 的 manifest
 *
 * 实时链上数据（不造假）：
 *   - SoulNFT.totalMinted() —— 已加入的 Soul 数
 *   - SkillRegistry.listActiveSkills().length —— 当前 active skills
 *   - SkillRegistry.callCount() —— 累计已结算调用
 *
 * 视觉密度：
 *   - 一屏完成「品类 → 标题 → 卖点 → 实时社会证明 → 可执行 URL → 备选路径」
 *   - 不依赖图片资源；所有动效用 css 类（design system 已定义 surface / pill-live 等）
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import {
  SOUL_NFT,
  SoulNFTAbi,
  SKILL_REGISTRY,
  SkillRegistryAbi,
} from "@/lib/contracts";
import { useI18n } from "@/lib/i18n";

// /api/anet-status 返回 shape —— 跟 route.ts 同步
type AnetDaemonStatus = "connected" | "not_installed" | "not_running" | "loading";
interface AnetStatus {
  binding: { soulTokenId?: string; did?: string } | null;
  anetDaemon: AnetDaemonStatus;
  anetDid: string | null;
}

export function AgentNetworkHero() {
  const { t } = useI18n();

  // origin SSR 安全：先用 placeholder，mount 后切换到真实 host
  // 这样 /skill.md 路径在 dev (localhost:3100) 和 prod (hub.pneuma.protocol) 都对
  const [origin, setOrigin] = useState("hub.pneuma.protocol");
  const [copied, setCopied] = useState(false);
  // mounted gate：wagmi/walletconnect 依赖 indexedDB（浏览器 only），
  // SSR 时调 useReadContract 会抛 [ReferenceError: indexedDB is not defined]。
  // 用 enabled: mounted 把链上请求推迟到 hydration 之后。
  const [mounted, setMounted] = useState(false);
  // anet 联动状态 —— 拉 /api/anet-status，让"是否真的接入"在 UI 层有落地证据
  const [anetStatus, setAnetStatus] = useState<AnetStatus>({
    binding: null,
    anetDaemon: "loading",
    anetDid: null,
  });

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      setOrigin(window.location.host);
    }
    // 拉一次状态；不轮询（评委不会等 30 秒看变化）
    fetch("/api/anet-status")
      .then((r) => r.json())
      .then((d: AnetStatus) => setAnetStatus(d))
      .catch(() => {
        // 路由失败也不阻塞页面，把 daemon 标记为 not_running
        setAnetStatus({ binding: null, anetDaemon: "not_running", anetDid: null });
      });
  }, []);

  // ── 实时链上指标 ─────────────────────────────────────
  // 每 12 秒刷一次，跟现有 /agents /skills 页面节奏一致
  const { data: soulCount } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "totalMinted",
    query: { enabled: mounted, refetchInterval: 12000 },
  });
  const { data: callCount } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "callCount",
    query: { enabled: mounted, refetchInterval: 12000 },
  });
  const { data: skills } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { enabled: mounted, refetchInterval: 12000 },
  });

  const skillsCount = (skills as readonly unknown[] | undefined)?.length;
  const skillUrlDisplay = `${origin}/skill.md`;
  // 复制时给完整带 protocol 的 URL，方便用户直接粘到 Agent 配置里
  const skillUrlClipboard =
    typeof window !== "undefined"
      ? `${window.location.origin}/skill.md`
      : `https://${origin}/skill.md`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(skillUrlClipboard);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 浏览器拒绝 clipboard API（极旧浏览器 / 非 https）—— 静默降级
      // 用户可以手动选中 code 元素复制
    }
  }

  return (
    <section className="pt-20 pb-12 flex flex-col items-center text-center gap-7 animate-fade-in">
      <span className="pill-live">{t("agent_hero.pill")}</span>

      {/* 主 H1 —— 老 hero 的 3 行大 tagline，magenta 重音保留 */}
      <h1 className="display text-5xl md:text-7xl lg:text-[88px] max-w-5xl leading-[1.05]">
        {t("home.hero.title.line1")}
        <span className="block text-magenta">{t("home.hero.title.line2")}</span>
        {t("home.hero.title.line3")}
      </h1>

      {/* 副标题 —— 协议层叙事 */}
      <p className="text-ink-dim text-base md:text-lg max-w-2xl leading-relaxed">
        {t("agent_hero.subtitle")}
      </p>

      {/* 实时链上社会证明 —— 数字直接读链，不造假 */}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13px] font-mono text-ink-dim">
        <span>
          <span className="text-cyan font-semibold">
            {soulCount !== undefined ? soulCount.toString() : "—"}
          </span>{" "}
          {t("agent_hero.stat_souls")}
        </span>
        <span className="text-ink-faint">·</span>
        <span>
          <span className="text-magenta font-semibold">
            {skillsCount !== undefined ? skillsCount : "—"}
          </span>{" "}
          {t("agent_hero.stat_skills")}
        </span>
        <span className="text-ink-faint">·</span>
        <span>
          <span className="text-soul-soft font-semibold">
            {callCount !== undefined ? callCount.toString() : "—"}
          </span>{" "}
          {t("agent_hero.stat_calls")}
        </span>
      </div>

      {/* 协议兼容性 chip 行 —— anet 兼容 + daemon 实时状态 */}
      <div className="flex flex-wrap items-center justify-center gap-2 -mt-3">
        <a
          href="https://agentnetwork.org.cn"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-magenta/40 bg-magenta/5 text-[11px] font-mono text-magenta hover:border-magenta/70 hover:bg-magenta/10 transition-colors"
        >
          <span>⬡</span>
          <span>{t("agent_hero.compat_chip")}</span>
          <span className="text-magenta/60">↗</span>
        </a>
        <AnetDaemonBadge status={anetStatus} t={t} />
      </div>

      {/* Sponsor tracks chip 行 —— OpenClaw 🦞 + PneumaCourt P2P
          这俩都是赛道 3 主项目同时申报的 sponsor track；court-p2p 独立 Python 仓库 */}
      <div className="flex flex-wrap items-center justify-center gap-2 -mt-2">
        <span className="text-[10px] font-mono text-ink-faint uppercase tracking-wider self-center">
          {t("agent_hero.sponsor_label")}
        </span>
        <a
          href="https://github.com/openclaw/openclaw"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-400/40 bg-amber-400/5 text-[11px] font-mono text-amber-400 hover:border-amber-400/70 hover:bg-amber-400/10 transition-colors"
          title="南客松 S2 · OpenClaw 🦞 sponsor track"
        >
          <span>🦞</span>
          <span>{t("agent_hero.openclaw_chip")}</span>
        </a>
        <a
          href="https://github.com/0xE/pneuma-court-p2p"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan/40 bg-cyan/5 text-[11px] font-mono text-cyan hover:border-cyan/70 hover:bg-cyan/10 transition-colors"
          title="南客松 S2 · P2P Service Gateway sponsor track · 多陪审员 anet mesh 仲裁"
        >
          <span>⚖</span>
          <span>{t("agent_hero.court_chip")}</span>
        </a>
      </div>

      {/* Copy URL 主 CTA —— Coze 同款形态 */}
      <div className="w-full max-w-3xl mt-1">
        <div className="surface px-4 py-3 md:px-5 md:py-4 flex items-center gap-3">
          <span className="text-[10px] md:text-[11px] font-mono text-ink-faint shrink-0 uppercase tracking-wider">
            {t("agent_hero.copy_label")}
          </span>
          <code className="font-mono text-[12px] md:text-[14px] text-ink truncate flex-1 text-left">
            {skillUrlDisplay}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className={`shrink-0 px-3 py-1.5 rounded font-mono text-[10px] md:text-[11px] uppercase tracking-wide transition-colors ${
              copied
                ? "bg-cyan/20 text-cyan"
                : "bg-border/70 text-ink hover:bg-border"
            }`}
            aria-label={t("agent_hero.copy_aria")}
          >
            {copied ? t("agent_hero.copied") : t("agent_hero.copy_button")}
          </button>
        </div>
        <p className="text-[12px] text-ink-faint mt-2.5 leading-relaxed max-w-2xl mx-auto">
          {t("agent_hero.hint")}
        </p>
      </div>

      {/* 次级路径 —— 不会用 AI Agent 的人也能点进去手动操作 */}
      <div className="flex items-center gap-3 text-[12px] mt-1 font-mono">
        <Link
          href="/mint"
          className="text-ink-dim hover:text-magenta transition-colors"
        >
          {t("agent_hero.cta_manual_mint")}
        </Link>
        <span className="text-ink-faint">·</span>
        <Link
          href="/run"
          className="text-ink-dim hover:text-cyan transition-colors"
        >
          {t("agent_hero.cta_try_orchestrator")}
        </Link>
      </div>

    </section>
  );
}

/**
 * AnetDaemonBadge —— 显示当前 anet daemon 联动状态
 *
 *   loading         :  灰圆点 + "checking…"
 *   connected       :  绿圆点 + "anet daemon · did:key:z6Mk…"
 *   not_running     :  橙圆点 + "anet 已装但 daemon 没起"
 *   not_installed   :  暗灰   + "anet 未安装"（鼠标悬停看安装命令）
 *
 * 这是把"兼容声明"做成"可视证据"的核心抓手 —— 评委一眼看到 daemon 真状态，
 * 而不只是一行 marketing 字。
 */
function AnetDaemonBadge({
  status,
  t,
}: {
  status: AnetStatus;
  t: (k: string) => string;
}) {
  const { anetDaemon, anetDid } = status;

  const config = (() => {
    switch (anetDaemon) {
      case "connected":
        return {
          dot: "bg-green-400",
          border: "border-green-400/40 bg-green-400/5",
          label: anetDid
            ? `${t("agent_hero.daemon.connected")} · ${anetDid.slice(0, 18)}…`
            : t("agent_hero.daemon.connected"),
          title: anetDid ?? t("agent_hero.daemon.connected"),
        };
      case "not_running":
        // 可选拓展 feature —— 用 cyan（信息提示）而非 amber（看着像 warning）
        return {
          dot: "bg-cyan/70",
          border: "border-cyan/30 bg-cyan/5",
          label: t("agent_hero.daemon.not_running"),
          title: t("agent_hero.daemon.not_running_hint"),
        };
      case "not_installed":
        return {
          dot: "bg-ink-faint",
          border: "border-border bg-bg/40",
          label: t("agent_hero.daemon.not_installed"),
          title: t("agent_hero.daemon.not_installed_hint"),
        };
      case "loading":
      default:
        return {
          dot: "bg-ink-faint animate-pulse",
          border: "border-border bg-bg/40",
          label: t("agent_hero.daemon.loading"),
          title: t("agent_hero.daemon.loading"),
        };
    }
  })();

  return (
    <span
      title={config.title}
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-mono text-ink-dim ${config.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      <span>{config.label}</span>
    </span>
  );
}
