import type { Config } from "tailwindcss";

/**
 * Pneuma Hub — token-driven palette (V6.1 island theme support)
 *
 * 所有 color token 改用 `rgb(var(--color-X) / <alpha-value>)`，让 Tailwind
 * utility（text-ink / bg-bg / bg-soul / text-magenta / ...）实际编译为
 * CSS variable 引用，响应 globals.css 的三主题 override：
 *   :root                   cyber-soul violet void
 *   [data-theme="light"]    warm paper
 *   [data-theme="island"]   Animal-Crossing parchment + mint teal
 *
 * 之前 token 写死字面量值（rgb(255 255 255)），导致 @apply text-ink
 * 编译出写死的白色，island 主题下文字完全不响应（hero "AI Agent" 在
 * 米底上呈白色不可读）。改成 var 引用后所有 utility 自动响应主题切换。
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        elevated: "rgb(var(--color-elevated) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        "ink-dim": "rgb(var(--color-ink-dim) / <alpha-value>)",
        "ink-faint": "rgb(var(--color-ink-faint) / <alpha-value>)",
        soul: "rgb(var(--color-soul) / <alpha-value>)",
        "soul-soft": "rgb(var(--color-soul-soft) / <alpha-value>)",
        magenta: "rgb(var(--color-magenta) / <alpha-value>)",
        cyan: "rgb(var(--color-cyan) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "ui-monospace", "Menlo", "monospace"],
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 16px 48px -12px rgb(88 44 255 / 0.5)",
        glowBig: "0 24px 80px -8px rgb(88 44 255 / 0.45)",
        card: "0 12px 24px -8px rgb(0 0 0 / 0.7)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        "fade-in": "fade-in 600ms cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
