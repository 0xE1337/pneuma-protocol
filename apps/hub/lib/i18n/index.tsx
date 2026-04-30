"use client";

/**
 * i18n Provider —— 轻量自建（不引第三方依赖如 react-i18next，避免 ~50KB bundle 增量）
 *
 * 设计要点：
 * - 默认中文（CLAUDE.md "中文优先" + 南大 AI 学术评委）
 * - localStorage 持久化用户选择，跨 session 保留
 * - SSR 默认渲染中文；client mount 后 useEffect 同步 localStorage
 *   （SSR/hydration 不一致时短暂闪烁，demo 阶段可接受；
 *    要彻底解决需要走 cookie + Server Component 的 lang 注入路径，留待 Phase 2）
 * - t() 缺失 key 时 fallback 到 key 字符串本身，不抛错不阻塞渲染
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { messages, type Lang, type MessageKey } from "./messages";

const STORAGE_KEY = "pneuma_lang";

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: MessageKey | string) => string;
}

const Context = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");

  // 客户端 mount 时从 localStorage 同步偏好
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") setLangState(saved);
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  const t = (key: MessageKey | string): string => {
    const dict = messages[lang] as Record<string, string>;
    return dict[key] ?? key;
  };

  return <Context.Provider value={{ lang, setLang, t }}>{children}</Context.Provider>;
}

/**
 * useI18n — 在 client component 内取 lang/setLang/t
 *
 * 容错：未在 Provider 内部时返回 zh-default 静态实现，
 * 避免老页面忘记 wrap 时炸渲染（degrade gracefully）
 */
export function useI18n(): I18nCtx {
  const ctx = useContext(Context);
  if (ctx) return ctx;
  return {
    lang: "zh",
    setLang: () => {},
    t: (k: MessageKey | string) => {
      const dict = messages.zh as Record<string, string>;
      return dict[k] ?? k;
    },
  };
}

export type { Lang, MessageKey };
