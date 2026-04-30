/**
 * @pneuma/skill-firewall
 *
 * Drop-in input firewall for Pneuma skill providers.
 * 一行 import，挡住 prompt injection / command injection / SSRF / 超大 payload。
 *
 * 用法（Hono）：
 *   import { skillFirewall } from "@pneuma/skill-firewall/hono";
 *   app.post("/api/run", x402({...}), skillFirewall({ rules: ["prompt-injection", "command-injection", "ssrf"] }), handler);
 *
 * 用法（手动）：
 *   import { runFirewall } from "@pneuma/skill-firewall";
 *   const verdict = runFirewall({ body, headers, byteLength }, { rules: [...] });
 *   if (verdict.action === "block") return errorResponse(verdict);
 */

export type {
  FirewallInput,
  FirewallVerdict,
  FirewallRule,
  FirewallConfig,
  OnBlockHook,
} from "./types.js";

export { defaultBlockResponse } from "./types.js";

export {
  promptInjectionRule,
  commandInjectionRule,
  ssrfRule,
  sizeLimitRule,
  sizeLimitDefault,
  resolveRule,
} from "./rules/index.js";

import type { FirewallConfig, FirewallInput, FirewallVerdict } from "./types.js";
import { resolveRule } from "./rules/index.js";

/**
 * 框架无关的 firewall 执行器。
 *
 * 顺序执行 rules，遇到第一个 block 立即返回（短路）。
 * 全部 allow 才返回 { action: "allow" }。
 *
 * 这个函数是同步的 —— rule.inspect 必须同步。需要异步检测（调 LLM
 * / DNS resolve）请用 runFirewallAsync（v0.2 加，当前不需要）。
 */
export function runFirewall(input: FirewallInput, config: FirewallConfig): FirewallVerdict {
  for (const r of config.rules) {
    const rule = resolveRule(r);
    const verdict = rule.inspect(input);
    if (verdict.action === "block") return verdict;
  }
  return { action: "allow" };
}
