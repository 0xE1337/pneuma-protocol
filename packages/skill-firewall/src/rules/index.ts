/**
 * 内置规则汇总 + 按 id 解析（让 firewall config 用字符串 id 也能加载）
 */

import type { FirewallRule } from "../types.js";
import { promptInjectionRule } from "./prompt-injection.js";
import { commandInjectionRule } from "./command-injection.js";
import { ssrfRule } from "./ssrf.js";
import { sizeLimitRule, sizeLimitDefault } from "./size-limit.js";

export {
  promptInjectionRule,
  commandInjectionRule,
  ssrfRule,
  sizeLimitRule,
  sizeLimitDefault,
};

/**
 * 把 firewall config.rules 的字符串 id 解析成 Rule 实例。
 * 支持的 id：
 *   - "prompt-injection"
 *   - "command-injection"
 *   - "ssrf"
 *   - "size-limit"        → 默认 8 KB
 *   - "size-limit:N"      → N 字节
 */
export function resolveRule(idOrRule: FirewallRule | string): FirewallRule {
  if (typeof idOrRule !== "string") return idOrRule;

  switch (idOrRule) {
    case "prompt-injection":
      return promptInjectionRule;
    case "command-injection":
      return commandInjectionRule;
    case "ssrf":
      return ssrfRule;
    case "size-limit":
      return sizeLimitDefault;
    default:
      // size-limit:N
      if (idOrRule.startsWith("size-limit:")) {
        const n = Number(idOrRule.slice("size-limit:".length));
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`skill-firewall: invalid size-limit id "${idOrRule}"`);
        }
        return sizeLimitRule(n);
      }
      throw new Error(`skill-firewall: unknown rule id "${idOrRule}"`);
  }
}
