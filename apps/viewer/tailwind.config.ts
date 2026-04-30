import type { Config } from "tailwindcss";

/**
 * Viewer — warm independent dApp identity.
 * Deliberately the OPPOSITE visual direction of Pneuma Hub:
 * cream + amber/brick instead of black + violet.
 * The visual contrast tells the "different team, different product" story by itself.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "rgb(250 246 238 / <alpha-value>)",
        "cream-warm": "rgb(255 228 208 / <alpha-value>)",
        "cream-deep": "rgb(251 229 200 / <alpha-value>)",
        paper: "rgb(255 255 255 / <alpha-value>)",
        ink: "rgb(58 36 24 / <alpha-value>)",
        "ink-dim": "rgb(107 74 45 / <alpha-value>)",
        "ink-faint": "rgb(168 120 86 / <alpha-value>)",
        amber: "rgb(232 117 74 / <alpha-value>)",
        "amber-deep": "rgb(184 61 30 / <alpha-value>)",
        "amber-soft": "rgb(232 180 124 / <alpha-value>)",
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "ui-monospace", "Menlo", "monospace"],
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        warm: "0 16px 48px -16px rgb(232 117 74 / 0.35)",
        warmBig: "0 24px 80px -16px rgb(232 117 74 / 0.4)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 600ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
