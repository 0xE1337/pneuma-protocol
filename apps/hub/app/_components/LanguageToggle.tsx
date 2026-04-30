"use client";

import { useI18n } from "@/lib/i18n";

/**
 * LanguageToggle —— 中 / EN 一键切换
 *
 * 视觉：跟 Navbar 风格统一（border + mono font + tracking-wide），
 * 按钮文字显示**目标**语言（当前中文时显示 "EN" = 切到英文，反之亦然），
 * 跟 Twitter / GitHub 等主流站的 lang switcher 行为一致。
 */
export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "zh" ? "en" : "zh")}
      className="font-mono text-[11px] px-2.5 py-1.5 border border-border hover:border-amber-deep transition-colors rounded uppercase tracking-[0.13em] text-ink-dim hover:text-ink"
      aria-label="Toggle language"
      title={lang === "zh" ? "Switch to English" : "切换到中文"}
    >
      {t("lang.toggle")}
    </button>
  );
}
