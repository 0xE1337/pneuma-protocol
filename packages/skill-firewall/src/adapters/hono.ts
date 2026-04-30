/**
 * Hono adapter for @pneuma/skill-firewall
 *
 * 在 x402 middleware 之后插入：
 *
 *   app.post("/api/run",
 *     x402({...}),                    // 链上验证 caller 已付钱
 *     skillFirewall({                 // 链下验证 input 不带毒
 *       rules: ["prompt-injection", "command-injection", "ssrf", "size-limit:8192"],
 *       onBlock: async (verdict, input) => {
 *         // 可选：写一条 SYSTEM-rater attestation 警告其他 provider
 *         console.warn(`[firewall] blocked ${verdict.rule} from callId=${input.callId}`);
 *       },
 *     }),
 *     async (c) => { ... your business handler ... }
 *   );
 *
 * 注意：必须排在 x402 之后，因为 onBlock hook 需要 callId / callerTBA（来自 x402 c.set）。
 */

import type { Context, MiddlewareHandler } from "hono";
import type { FirewallConfig, FirewallInput } from "../types.js";
import { runFirewall } from "../index.js";
import { defaultBlockResponse } from "../types.js";

/** Hono context 里 x402 middleware 设置的字段 — 软依赖，没有也能跑 */
type X402ContextVars = {
  pneumaCallId?: string;
  pneumaCallerTBA?: string;
};

export function skillFirewall(config: FirewallConfig): MiddlewareHandler {
  if (!config.rules || config.rules.length === 0) {
    throw new Error("skillFirewall: config.rules must contain at least one rule");
  }

  return async (c: Context<{ Variables: X402ContextVars }>, next) => {
    // 1. 收集 input —— 复制 body 让 firewall 看，但保留原始 stream 给后续 handler
    let body: unknown = null;
    let bodyText = "";
    try {
      bodyText = await c.req.text();
      body = bodyText.length > 0 ? JSON.parse(bodyText) : null;
    } catch {
      // 非 JSON body —— 用原始 text 传给 firewall，handler 自己 re-parse
      body = bodyText;
    }

    // 2. 重塞 body 让下游 handler 还能读
    //    Hono 的 c.req.text() 会消耗 body，必须重写 c.req.raw
    if (bodyText.length > 0) {
      const original = c.req.raw;
      c.req.raw = new Request(original.url, {
        method: original.method,
        headers: original.headers,
        body: bodyText,
      });
    }

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    const input: FirewallInput = {
      body,
      headers,
      byteLength: new TextEncoder().encode(bodyText).length,
      ...(c.get("pneumaCallId") !== undefined && { callId: c.get("pneumaCallId") }),
      ...(c.get("pneumaCallerTBA") !== undefined && { callerTBA: c.get("pneumaCallerTBA") }),
    };

    // 3. 跑 firewall
    const verdict = runFirewall(input, config);
    if (verdict.action === "block") {
      // onBlock hook —— 失败不阻塞，已经 block
      if (config.onBlock) {
        try {
          await config.onBlock(verdict, input);
        } catch (err) {
          console.warn(`[skill-firewall] onBlock hook failed: ${(err as Error).message}`);
        }
      }
      const status = (config.blockStatus ?? 400) as 400 | 422 | 451;
      const responseBody = config.blockResponseFn
        ? config.blockResponseFn(verdict)
        : defaultBlockResponse(verdict);
      return c.json(responseBody as object, status);
    }

    // 4. 放行
    await next();
  };
}
