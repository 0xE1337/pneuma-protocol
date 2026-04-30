/**
 * Hono adapter for x402 middleware
 *
 * 一行接入：
 *   app.post("/api/skill",
 *     x402({ skillId: 1, ... }),
 *     async (c) => c.json({ result: "..." })
 *   );
 */

import type { Context, MiddlewareHandler } from "hono";
import { PneumaMiddleware } from "../server/middleware.js";
import type { MiddlewareConfig } from "../types.js";

/**
 * Hono middleware factory
 */
export function x402(config: MiddlewareConfig): MiddlewareHandler {
  const middleware = new PneumaMiddleware(config);

  return async (c: Context, next) => {
    const headerValue = c.req.header("X-Payment") ?? c.req.header("x-payment");

    // 没付款头 → 返回 402 + challenge
    if (!headerValue) {
      try {
        const challenge = await middleware.getPaymentChallenge();
        return c.json(challenge, 402);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 500);
      }
    }

    // 解析 + 验证
    const payload = middleware.parsePaymentHeader(headerValue);
    if (!payload) {
      return c.json(
        { error: "invalid X-PAYMENT header" },
        400,
      );
    }

    const verification = await middleware.verifyPayment(payload);
    if (!verification.valid) {
      return c.json(
        { error: `payment verification failed: ${verification.reason}` },
        402,
      );
    }

    // 把 callId 和 callerTBA 放进 context，handler 可以读
    c.set("pneumaCallId", verification.callId!.toString());
    c.set("pneumaCallerTBA", verification.callerTBA!);

    // 跑业务 handler
    await next();

    // settle（不阻塞响应，但要等 handler 完成）
    try {
      const settleResult = await middleware.settle(verification.callId!);
      // 把 settle tx hash 加到响应头供调试用
      c.header("X-Pneuma-Settle-Tx", settleResult.txHash);
    } catch (err) {
      // settle 失败不影响业务响应（hackathon 阶段：log 出来即可）
      console.error("[x402] settle failed:", (err as Error).message);
      c.header("X-Pneuma-Settle-Error", (err as Error).message);
    }
  };
}
