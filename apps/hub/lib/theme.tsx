"use client";

/**
 * ThemeProvider —— 二态主题：island / dark
 *
 * 设计:
 *   - "island" 是 V6 micro-society 默认外壳（warm parchment + mint teal accent
 *     + Nunito/Zen Maru Gothic 字体），由 globals.css 的 `[data-theme="island"]`
 *     block 定义所有 CSS variable override —— 默认主题
 *   - "dark" 是原 cyber-soul violet void —— "协议视图 / 开发者观感"出口
 *
 * 历史：曾有第三态 "light" (warm paper) 作渐进过渡，2026-04-30 砍掉；
 *      旧 localStorage 里的 "light" 自动 fallback 回默认 island。
 *
 *   - 默认主题 "island"，演示日开屏即温暖社区视觉
 *   - 现有页面通过 token override 自动响应，零 page-level 改动
 *   - localStorage 持久化（key: pneuma_theme）
 *   - toggle() 在 island ↔ dark 之间切换
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "island";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Context = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = "pneuma_theme";
const DEFAULT_THEME: Theme = "island";

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "island";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // 旧 "light" 值已废弃 → 自动回默认 island，保证升级用户不会看到坏掉的中间态
    const initial: Theme = isTheme(saved) ? saved : DEFAULT_THEME;
    setThemeState(initial);
    document.documentElement.dataset.theme = initial;
    // 把旧的 "light" 写回正确值，避免下次 mount 又走 fallback
    if (saved !== initial) {
      window.localStorage.setItem(STORAGE_KEY, initial);
    }
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.dataset.theme = next;
    }
  };

  // 二态切换：island ↔ dark
  const toggle = () => setTheme(theme === "island" ? "dark" : "island");

  return <Context.Provider value={{ theme, setTheme, toggle }}>{children}</Context.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Context);
  if (ctx) return ctx;
  return { theme: DEFAULT_THEME, setTheme: () => {}, toggle: () => {} };
}
