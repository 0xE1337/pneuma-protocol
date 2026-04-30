/**
 * Express adapter for x402 middleware
 *
 * 一行接入：
 *   app.post("/api/skill",
 *     x402({ skillId: 1, ... }),
 *     async (req, res) => res.json({ result: "..." })
 *   );
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { PneumaMiddleware } from "../server/middleware.js";
import type { MiddlewareConfig } from "../types.js";

/**
 * Pneuma 在 Express req 上挂的字段 — handler 通过 (req as any).pneumaCallId 读取。
 * 没用 module augmentation，避免 @types/express 内部模块名不稳定的问题。
 */
type PneumaRequest = Request & {
  pneumaCallId?: string;
  pneumaCallerTBA?: string;
};

/**
 * Express middleware factory
 */
export function x402(config: MiddlewareConfig): RequestHandler {
  const middleware = new PneumaMiddleware(config);

  return async (req: Request, res: Response, next: NextFunction) => {
    const pneumaReq = req as PneumaRequest;
    const headerValue =
      (req.headers["x-payment"] as string | undefined) ?? null;

    if (!headerValue) {
      try {
        const challenge = await middleware.getPaymentChallenge();
        return res.status(402).json(challenge);
      } catch (err) {
        return res.status(500).json({ error: (err as Error).message });
      }
    }

    const payload = middleware.parsePaymentHeader(headerValue);
    if (!payload) {
      return res.status(400).json({ error: "invalid X-PAYMENT header" });
    }

    const verification = await middleware.verifyPayment(payload);
    if (!verification.valid) {
      return res.status(402).json({
        error: `payment verification failed: ${verification.reason}`,
      });
    }

    pneumaReq.pneumaCallId = verification.callId!.toString();
    pneumaReq.pneumaCallerTBA = verification.callerTBA!;

    // 拦截 res.send 来在响应后 settle —— 简化做法
    const callId = verification.callId!;
    const originalSend = res.send.bind(res);
    res.send = function (body: unknown) {
      // 异步 settle，不阻塞响应（容忍 settle 失败）
      middleware
        .settle(callId)
        .then((r) => {
          res.setHeader("X-Pneuma-Settle-Tx", r.txHash);
        })
        .catch((err) => {
          console.error("[x402] settle failed:", (err as Error).message);
        });
      return originalSend(body);
    };

    next();
  };
}
