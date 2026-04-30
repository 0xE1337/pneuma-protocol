/**
 * 框架无关的 x402 中间件核心逻辑
 *
 * 工作流程：
 *   1. 收到请求，检查 X-PAYMENT 头
 *   2. 没有 → 返回 402 + PaymentChallenge（要付多少 USDC、给谁、skillId）
 *   3. 有 → 解析 callId，链上验证 callId 是 Pending 且属于本 skill
 *   4. 验证通过 → 让框架跑业务 handler
 *   5. handler 跑完 → 调用 settleCall(callId, rating) 结算 + 触发 attestation
 *
 * 各框架 adapter（hono / express / nextjs）只是把这套逻辑翻译成框架的 middleware/handler。
 */

import type { Hex } from "viem";
import type {
  MiddlewareConfig,
  PaymentChallenge,
  PaymentRequirement,
  X402PaymentHeader,
} from "../types.js";
import { X402_VERSION } from "../types.js";
import { buildPaymentDomain, verifyPaymentAuth } from "../eip712.js";
import {
  createServerClients,
  readSkill,
  settleCall,
  verifyCall,
} from "./contract.js";

const DEFAULT_DEADLINE_SECONDS = 5 * 60; // 5 分钟

/**
 * Pneuma 中间件运行时实例 —— adapter 创建一次，每次请求复用
 */
export class PneumaMiddleware {
  private config: MiddlewareConfig;
  private clients: ReturnType<typeof createServerClients>;
  /** 缓存的价格（避免每次请求都链上读） */
  private cachedPrice?: bigint;
  private cachedSkillName?: string;

  constructor(config: MiddlewareConfig) {
    this.config = config;
    this.clients = createServerClients(config);
  }

  /**
   * 获取支付要求（如果 config 没传 price 就链上读 + 缓存）
   */
  async getPaymentChallenge(): Promise<PaymentChallenge> {
    let price = this.config.pricePerCall ?? this.cachedPrice;
    let name = this.config.skillName ?? this.cachedSkillName ?? "skill";

    if (!price) {
      const skill = await readSkill(
        this.clients.publicClient,
        this.config.skillRegistry,
        this.config.skillId,
      );
      if (!skill.active) {
        throw new Error(`skill ${this.config.skillId} is not active`);
      }
      price = skill.pricePerCall;
      name = skill.name || name;
      this.cachedPrice = price;
      this.cachedSkillName = name;
    }

    const requirement: PaymentRequirement = {
      scheme: "pneuma-ec-escrow",
      chainId: this.config.chainId,
      asset: this.config.paymentToken,
      payTo: this.config.skillRegistry,
      maxAmountRequired: price.toString(),
      deadline: Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS,
      extra: {
        skillId: this.config.skillId,
        skillName: name,
      },
    };

    return { x402Version: X402_VERSION, accepts: [requirement] };
  }

  /**
   * 解析 X-PAYMENT 头（base64 编码的 JSON）
   *
   * V5 起强制要求 EIP-712 字段（signature / caller / callerTBA / maxAmount / deadline）
   * 缺任一字段直接拒绝（防 v4 stub `signature: "0x"` 被滥用）
   */
  parsePaymentHeader(headerValue: string | null): X402PaymentHeader | null {
    if (!headerValue) return null;
    try {
      const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded) as X402PaymentHeader;
      if (parsed.x402Version !== X402_VERSION) return null;
      if (parsed.scheme !== "pneuma-ec-escrow") return null;
      if (!parsed.callId || !parsed.paymentHash) return null;
      // V5 EIP-712 必填字段
      if (!parsed.signature || parsed.signature === "0x") return null;
      if (!parsed.caller || !parsed.callerTBA) return null;
      if (!parsed.maxAmount || typeof parsed.deadline !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * 链上验证 callId + EIP-712 签名验证 caller 身份
   *
   * 双重闭环：
   *   1) 链上 verifyCall 确保 callId 状态合法 + paymentHash 匹配 + 属于本 skill
   *   2) EIP-712 verifyPaymentAuth 确保 X-Payment 是链上 c.caller 本人签的
   *
   * 第 (2) 步是 V5 安全升级：之前 stub `signature: "0x"` 让任何监听者拿到 callId
   * 都能消费 caller 的 escrow，攻击向量真实存在。
   */
  async verifyPayment(payload: X402PaymentHeader): Promise<{
    valid: boolean;
    reason?: string;
    callId?: bigint;
    callerTBA?: string;
  }> {
    const callId = BigInt(payload.callId);
    const result = await verifyCall(
      this.clients.publicClient,
      this.config.skillRegistry,
      callId,
      this.config.skillId,
      payload.paymentHash as Hex,
    );

    if (!result.valid) return { valid: false, reason: result.reason };
    if (!result.caller) return { valid: false, reason: "on-chain caller missing" };

    // 链上声明的 caller 必须跟 X-Payment 头里的 caller 字段一致
    if (result.caller.toLowerCase() !== payload.caller.toLowerCase()) {
      return {
        valid: false,
        reason: `caller mismatch: on-chain ${result.caller}, header ${payload.caller}`,
      };
    }

    // EIP-712 验签 —— 恢复签名地址必须 === 链上 c.caller
    const domain = buildPaymentDomain({
      chainId: this.config.chainId,
      skillRegistry: this.config.skillRegistry,
    });
    const sigCheck = await verifyPaymentAuth({
      domain,
      message: {
        callId,
        paymentHash: payload.paymentHash as Hex,
        caller: payload.caller,
        callerTBA: payload.callerTBA,
        maxAmount: BigInt(payload.maxAmount),
        deadline: BigInt(payload.deadline),
      },
      signature: payload.signature as Hex,
      expectedCaller: result.caller,
    });

    if (!sigCheck.valid) {
      return {
        valid: false,
        reason: `EIP-712 sig invalid: ${sigCheck.reason}`,
      };
    }

    return {
      valid: true,
      callId,
      callerTBA: result.callerTBA,
    };
  }

  /**
   * Settle —— handler 跑完之后调用，链上完成结算并触发 attestation
   */
  async settle(callId: bigint, rating?: number): Promise<{ txHash: Hex }> {
    return settleCall(
      this.clients.walletClient,
      this.clients.publicClient,
      this.config.skillRegistry,
      callId,
      rating ?? this.config.defaultRating ?? 5,
    );
  }
}
