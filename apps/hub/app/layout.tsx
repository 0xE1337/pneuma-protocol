import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
// 全局加载 animal-island-ui 预编译 CSS（class 已用 `animal-` 哈希前缀，零污染）
// 之前仅在 /island-demo layout 内加载；island 主题成为默认后，全站需要它来渲染
// island-demo 页面用到的 Button / Card / Modal / Phone 等组件
import "animal-island-ui/style";
import { Providers } from "./providers";
import { Navbar } from "./_components/Navbar";
import { WrongChainBanner } from "./_components/ChainGuard";

/* ─── Fonts ───────────────────────────────────────────────────────────
 * 原本用 next/font/google 自动拉 Nunito + Zen Maru Gothic，但中国大陆
 * dev/build 阶段 Google Fonts 域名被 GFW 阻断 → TLS 握手失败 → 编译
 * hang 死。改成 CSS 变量 + 系统字体栈兜底：
 *   - Nunito 风味     → 系统圆润 sans (Avenir/PingFang SC) 接近视觉
 *   - Zen Maru 风味   → 日系圆体 (Hiragino Maru Gothic ProN) 接近视觉
 *   - Geist Sans/Mono → 仍由 geist 包提供（@vercel/style 不走 Google）
 * 评审环境如需精确 Nunito/Zen Maru，把字体本地化到 public/fonts 后用
 * `next/font/local` 重新接入即可，不影响其他代码（style 仍读 var(--font-*)）。
 * ─────────────────────────────────────────────────────────────────── */
const fontFallbackStyle = `
:root {
  --font-nunito: "Avenir Next", "Avenir", "Nunito", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-zen-maru: "Hiragino Maru Gothic ProN", "Yu Gothic", "Avenir Next Rounded", "Nunito", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
`;

export const metadata: Metadata = {
  title: "Pneuma",
  description:
    "Open protocol for AI agents — portable identity, real token payments, cross-platform contribution attestations.",
};

/**
 * 全站 force-dynamic —— 关掉 SSG / static-generation
 *
 * 原因：
 * - hub 全站基本上是 dApp（用 wagmi/rainbowkit 客户端读链 + 钱包），SSG 阶段
 *   wagmi 的 storage adapter 会调用浏览器才有的 localStorage / indexedDB API，
 *   Vercel 冷启动 prerender 时直接 TypeError 退出 build。
 * - 静态生成对 dApp 价值很低（数据本来就是每次 client RPC 拉），SSR 反而更稳。
 * - Vercel Hobby plan 上 SSR 跟 SSG 性能差异可忽略；保 build 绿色优先。
 *
 * Cache-Control 仍由各 route handler / Next.js 默认控制；这里只关 SSG 不关
 * runtime cache。
 */
export const dynamic = "force-dynamic";

/**
 * Inline pre-hydration theme bootstrapper —— 防 FOUC 抖动的核心抓手
 *
 * 问题：之前在 SSR 写死 data-theme="island"，但 client mount 后
 * ThemeProvider 的 useEffect 才读 localStorage。如果用户曾切到 dark/light，
 * 浏览器先渲染 island 一帧 → useEffect 把 dataset.theme 改成 dark → 瞬切。
 *
 * 解决：把 localStorage→dataset.theme 这步**前移**到 `<head>` 的 inline script，
 * 它在 React hydrate 之前同步执行 —— server 渲染的 :root（无 data-theme，走
 * globals.css 的 `:root` cyber dark 默认）被 inline script 立刻覆盖成
 * localStorage 的真实主题。第一帧就是正确的视觉，零 FOUC。
 *
 * 为什么不在 SSR 写 data-theme：server 不知道 client 的 localStorage，
 * 写任何 hardcoded 值都可能跟 client 实际偏好不一致 → 同样抖动。
 *
 * suppressHydrationWarning：inline script 改了 documentElement，跟 React
 * 渲染的 props 不一致是预期的，要静音 hydration warning。
 */
// 与 lib/theme.tsx 的二态系统对齐 —— theme 只有 island / dark
// legacy "light" (历史第三态，2026-04-30 砍掉) 在 inline script 阶段就当
// island 处理，避免老用户刷新时先 set data-theme="light" → globals.css 没有
// 对应 block → CSS 走 :root cyber dark → 然后 ThemeProvider 再 migrate 到
// island，那是 FOUC 双闪。统一在第一帧就走 island。
const themeBootstrapScript = `
(function(){try{
  var s=localStorage.getItem('pneuma_theme');
  var t=(s==='dark')?'dark':'island';
  document.documentElement.dataset.theme=t;
}catch(e){document.documentElement.dataset.theme='island';}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        {/* 字体回退变量 —— 替代 next/font/google（GFW 阻断 fonts.googleapis.com） */}
        <style dangerouslySetInnerHTML={{ __html: fontFallbackStyle }} />
        {/* 必须放 <head>：浏览器解析 <body> 之前完成主题写入，渲染第 1 帧就对 */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      {/*
       * `animal-cursor` class 来自 animal-island-ui 包内置 CSS：把全站默认
       * cursor 替换成 Animal-Crossing 风格的手绘指针（hover 选择时还有 slide-in
       * 动效）。包是 opt-in，必须在根元素显式挂 class 才生效；之前 layout 没挂，
       * 所以 cursor 一直是系统 default。
       */}
      <body className="animal-cursor">
        {/* 全局 grain noise overlay：SVG feTurbulence 制造模拟信号质感
            opacity 0.04 + mix-blend-mode overlay；pointer-events: none 不挡交互
            区别于 SaaS 平铺色块（评委一眼能感知的"协议级氛围"） */}
        <div className="grain-overlay" aria-hidden="true" />
        <Providers>
          <Navbar />
          {/* 全局错链 banner — 用户连了非 Arc Testnet 的钱包时显示在 Navbar 下方
              提供「添加 Arc Testnet 并切换」一键按钮（wagmi switchChain 内部自动
              fallback 到 wallet_addEthereumChain，wallet 没添加过该链时弹出添加确认） */}
          <WrongChainBanner />
          <main>{children}</main>
          <footer className="border-t border-border/60 mt-32">
            <div className="max-w-7xl mx-auto px-8 py-12 flex items-center justify-between text-[11px] uppercase tracking-[0.13em] text-ink-faint">
              <span>Pneuma · Open protocol for AI agents</span>
              <span>Live on Arc Testnet · 5042002</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
