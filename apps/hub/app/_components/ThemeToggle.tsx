"use client";

import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";

/**
 * ThemeToggle —— 二态主题切换 (island ↔ dark)
 *
 * Icon 设计语言：「icon = 按下后切换到的目标主题」
 *   - 当前 island → 下一态 dark   → icon 🌙 (cyber void)
 *   - 当前 dark   → 下一态 island → icon 🏝 (Animal Crossing 暖色社区)
 *
 * 历史：2026-04-30 之前是三态 island/dark/light 循环，现砍掉 light 让
 * 切换决策更直接（评委 demo 时不需要解释三个主题各代表啥）。
 *
 * 跟 LanguageToggle 风格一致：border + mono + 等高紧凑单字符按钮。
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();

  const icon = theme === "island" ? "🌙" : "🏝";
  const titleKey =
    theme === "island" ? "theme.toggle.to_dark" : "theme.toggle.to_island";

  return (
    <button
      type="button"
      onClick={toggle}
      className="font-mono text-base px-2.5 py-1.5 border border-border hover:border-soul/60 transition-colors rounded text-ink-dim hover:text-ink leading-none"
      aria-label="Toggle theme"
      title={t(titleKey as Parameters<typeof t>[0])}
    >
      {icon}
    </button>
  );
}
