import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Nunito, Zen_Maru_Gothic } from "next/font/google";
import "./globals.css";
// 全局加载 animal-island-ui 预编译 CSS（class 已用 `animal-` 哈希前缀，零污染）
// 之前仅在 /island-demo layout 内加载；island 主题成为默认后，全站需要它来渲染
// island-demo 页面用到的 Button / Card / Modal / Phone 等组件
import "animal-island-ui/style";
import { Providers } from "./providers";
import { Navbar } from "./_components/Navbar";
import { WrongChainBanner } from "./_components/ChainGuard";

/* ─── Fonts ───────────────────────────────────────────────────────────
 * next/font/google 自托管 + 零 CLS + 自动 preload。
 * 暴露 CSS variable 给 globals.css 主题切换时按需切栈。
 *   - Nunito        : island 主体 / 按钮（warm rounded sans）
 *   - Zen Maru Gothic: island 标题（手写圆润日系）
 *   - Geist Sans/Mono: cyber-soul 原字体栈（保留协议数据观感）
 *
 * 注：Noto Sans SC（中文 fallback）暂不通过 next/font 加载——
 *      Google 的 SC 子集体积大，preload 反而拖累 LCP；
 *      改为 system fallback (`PingFang SC` / `Microsoft YaHei`)，
 *      实际中文渲染由系统字体接管。
 * ─────────────────────────────────────────────────────────────────── */
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const zenMaruGothic = Zen_Maru_Gothic({
  subsets: ["latin"],
  variable: "--font-zen-maru",
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pneuma",
  description:
    "Open protocol for AI agents — portable identity, real token payments, cross-platform contribution attestations.",
};

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
      className={`${GeistSans.variable} ${GeistMono.variable} ${nunito.variable} ${zenMaruGothic.variable}`}
    >
      <head>
        {/* 必须放 <head>：浏览器解析 <body> 之前完成主题写入，渲染第 1 帧就对 */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
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
