"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Navbar —— 三态主题感知导航
 *
 * 视觉策略：
 *   - island 主题（默认）: pill 形 nav link + Zen Maru Gothic logo + 底部 5px
 *     按钮压感阴影；active link 是 mint teal 实色 pill
 *   - dark / light 主题: 保留原 cyber-soul 视觉（gradient logo + soul/15 active）
 *
 * 实现说明：
 *   - 视觉切换依赖 globals.css 的 CSS variable override + 本组件 styled-jsx
 *     里 :global([data-theme="island"]) 选择器
 *   - 不用 useTheme() hook 跑分支，避免 SSR / hydration mismatch
 */

/**
 * 主 nav 5 项 IA：Discover · 执行台 · 法庭 · 我的 Agent · 实时看板
 *
 * 设计取舍：
 *   - Agent / Skill 两个对象类型合并为 Discover 入口，避免逼用户先做"找谁 / 找什么"分类
 *   - /run 留作执行台（手动 + Smart 双模式）
 *   - /court 在主 nav 而非藏二级，因为多陪审员争议是协议层差异化叙事
 *   - /admin/dashboard 实时看板：评委演示日的"链上 9 类事件订阅 + 真 tx hash 滚动"主屏，
 *     需要在主 nav 直达，不能藏二级（评委不会自己摸路径）
 *   - 铸造、钱包从主 nav 撤下：
 *       /mint            → 首页 hero CTA + /run /profile 空状态入口
 *       /wallet          → 即将合并进 /profile 顶部钱包 tab
 *   - /agents /skills /commons /island-demo 路由仍可访问，仅从主 nav 隐藏
 */
const NAV_ITEMS = [
  { href: "/discover", labelKey: "nav.discover" as const },
  { href: "/run", labelKey: "nav.run" as const },
  { href: "/court", labelKey: "nav.court" as const },
  { href: "/profile", labelKey: "nav.profile" as const },
  { href: "/admin/dashboard", labelKey: "nav.demo" as const },
];

export function Navbar() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg/75 border-b border-border/60">
      <div className="max-w-7xl mx-auto px-8 h-[72px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="logo-mark relative">
            <span className="absolute inset-0 grid place-items-center font-mono font-bold text-[11px] text-ink island-logo-letter">
              P
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="island-brand-name font-mono font-semibold text-ink text-lg">
              Pneuma
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-faint mt-0.5">
              Protocol
            </span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`island-nav-link px-3 py-1.5 rounded-md text-[13px] font-mono transition-all ${
                  active
                    ? "text-ink bg-soul/15 island-nav-link-active"
                    : "text-ink-dim hover:text-ink hover:bg-ink/5"
                }`}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
        </div>
      </div>

      {/* island-only 视觉细节 —— 通过 :global([data-theme="island"]) 选择器
          直接触达，不需要 client-side 主题判断，零 hydration 风险 */}
      <style jsx>{`
        :global([data-theme="island"]) .island-brand-name {
          font-family: var(--font-zen-maru), var(--font-nunito), sans-serif;
          font-size: 22px;
          letter-spacing: 0;
          color: rgb(var(--color-ink));
        }
        :global([data-theme="island"]) .island-nav-link {
          font-family: var(--font-nunito), sans-serif;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.01em;
          border-radius: 999px;
          padding: 6px 16px;
        }
        :global([data-theme="island"]) .island-nav-link-active {
          background: rgb(var(--color-soul));
          color: #fff;
          box-shadow: 0 3px 0 0 var(--island-shadow-rest, #bdaea0);
        }
        :global([data-theme="island"]) .island-nav-link:not(.island-nav-link-active):hover {
          background: rgba(25, 200, 185, 0.1);
          color: rgb(var(--color-ink));
          transform: translateY(-1px);
        }
        :global([data-theme="island"]) .logo-mark {
          background: linear-gradient(135deg, rgb(var(--color-soul)), rgb(var(--color-soul-soft)));
          border-radius: 12px;
          box-shadow: 0 3px 0 0 var(--island-shadow-rest, #bdaea0);
        }
        :global([data-theme="island"]) .island-logo-letter {
          color: #fff;
          font-family: var(--font-nunito), sans-serif;
          font-weight: 800;
        }
      `}</style>
    </header>
  );
}
