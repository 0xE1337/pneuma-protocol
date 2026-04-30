/**
 * size-limit rule
 *
 * 拦截"超大 input 灌爆 provider"的 DDoS 风格攻击。
 *
 * 跟 SkillRegistry.maxInputBytes 是双层防御：
 *   - 链上 maxInputBytes 是 caller 申报值，攻击者可以谎报
 *   - 这里在 provider 端实际测 byte 数，一致性校验
 *
 * 默认 8 KB（≈ 2k tokens）。需要更大可在 firewall config 里指定 "size-limit:N"。
 *
 * 注意：byteLength 由 adapter 在 stream 阶段算好传入，rule 不再读 body 字节
 * （这样支持 stream parsing，不必先全读到内存才能拦）。
 */

import type { FirewallInput, FirewallRule, FirewallVerdict } from "../types.js";

/** 创建一个 size-limit rule 实例 */
export function sizeLimitRule(maxBytes: number): FirewallRule {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error(`size-limit: invalid maxBytes ${maxBytes}`);
  }
  return {
    id: `size-limit:${maxBytes}`,
    description: `拒绝 byteLength > ${maxBytes} 的请求`,
    inspect(input: FirewallInput): FirewallVerdict {
      if (input.byteLength > maxBytes) {
        return {
          action: "block",
          rule: `size-limit:${maxBytes}`,
          evidence: `byteLength=${input.byteLength}`,
          reason: `payload exceeds ${maxBytes} bytes`,
        };
      }
      return { action: "allow" };
    },
  };
}

/** 默认 8 KB 上限的 size-limit rule */
export const sizeLimitDefault = sizeLimitRule(8192);
