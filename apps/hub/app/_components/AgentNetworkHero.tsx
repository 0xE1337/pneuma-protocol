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

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      setOrigin(window.location.host);
    }
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

      {/* anet 兼容 chip —— 比底部小字更可见，跟 live counter 一行节奏 */}
      <a
        href="https://agentnetwork.org.cn"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-magenta/40 bg-magenta/5 text-[11px] font-mono text-magenta hover:border-magenta/70 hover:bg-magenta/10 transition-colors -mt-3"
      >
        <span>⬡</span>
        <span>{t("agent_hero.compat_chip")}</span>
        <span className="text-magenta/60">↗</span>
      </a>

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
