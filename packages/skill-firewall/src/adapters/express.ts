/**
 * Express adapter for @pneuma/skill-firewall
 *
 *   import express from "express";
 *   import { x402Express } from "@pneuma/x402/express";
 *   import { skillFirewallExpress } from "@pneuma/skill-firewall/express";
 *
 *   app.post("/api/run",
 *     express.json(),                     // 必须先解析 body
 *     x402Express({...}),                 // 链上付钱校验
 *     skillFirewallExpress({              // 链下毒入 firewall
 *       rules: ["prompt-injection", "ssrf"],
 *     }),
 *     (req, res) => { ... your handler ... }
 *   );
 *
 * 注意：必须先 express.json() 让 req.body 是 parsed object；非 JSON body 路径走 raw text。
 */

import type { Request, Response, NextFunction } from "express";
import type { FirewallConfig, FirewallInput } from "../types.js";
import { runFirewall } from "../index.js";
import { defaultBlockResponse } from "../types.js";

/** Express middleware function */
type Middleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

export function skillFirewallExpress(config: FirewallConfig): Middleware {
  if (!config.rules || config.rules.length === 0) {
    throw new Error("skillFirewallExpress: config.rules must contain at least one rule");
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    // body 已经被 express.json() / express.text() 解析；rawBody 是 Buffer 备份
    const body = req.body ?? null;

    // 计算 byteLength —— Content-Length 优先，没的话回退 JSON.stringify
    let byteLength = 0;
    const cl = req.headers["content-length"];
    if (typeof cl === "string") {
      const n = Number(cl);
      if (Number.isFinite(n) && n >= 0) byteLength = n;
    }
    if (byteLength === 0 && body != null) {
      // 兜底：用 JSON 估算（不精确但足够 size-limit 用）
      try {
        byteLength = new TextEncoder().encode(JSON.stringify(body)).length;
      } catch {
        byteLength = 0;
      }
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") {
        headers[k.toLowerCase()] = v;
      } else if (Array.isArray(v) && typeof v[0] === "string") {
        headers[k.toLowerCase()] = v[0];
      }
    }

    // x402 middleware 把 callId / callerTBA 挂在 req（约定 res.locals）
    const callId = (res.locals?.["pneumaCallId"] as string | undefined) ?? undefined;
    const callerTBA = (res.locals?.["pneumaCallerTBA"] as string | undefined) ?? undefined;

    const input: FirewallInput = {
      body,
      headers,
      byteLength,
      ...(callId !== undefined && { callId }),
      ...(callerTBA !== undefined && { callerTBA }),
    };

    const verdict = runFirewall(input, config);
    if (verdict.action === "block") {
      if (config.onBlock) {
        try {
          await config.onBlock(verdict, input);
        } catch (err) {
          console.warn(`[skill-firewall] onBlock hook failed: ${(err as Error).message}`);
        }
      }
      const status = config.blockStatus ?? 400;
      const responseBody = config.blockResponseFn
        ? config.blockResponseFn(verdict)
        : defaultBlockResponse(verdict);
      res.status(status).json(responseBody);
      return;
    }

    next();
  };
}
