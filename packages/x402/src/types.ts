/**
 * Pneuma x402 协议类型定义
 *
 * 协议设计：
 *   1. 客户端首次请求服务（无 X-PAYMENT 头）
 *   2. 服务端返回 402 + PaymentChallenge（要付多少 USDC、给谁、skillId）
 *   3. 客户端链上调用 SkillRegistry.escrowForCall() 锁仓 → 拿到 callId
 *   4. 客户端重试请求，带 X-PAYMENT 头携带 callId 和签名
 *   5. 服务端链上验证 callId 状态 + 签名 → 跑业务 → settleCall() 结算并触发 attestation
 *
 * 支付资产：Arc Testnet 原生 USDC（合约 0x3600...0000，6 decimals）。
 */

import type { Address, Hex } from "viem";

/**
 * x402 协议版本号
 */
export const X402_VERSION = 1 as const;

/**
 * 服务端 402 响应中的支付挑战
 */
export interface PaymentChallenge {
  x402Version: typeof X402_VERSION;
  accepts: PaymentRequirement[];
}

/**
 * 单条支付要求 — 一个服务可以同时接受多种支付方式（hackathon 阶段只支持 Arc 原生 USDC）
 */
export interface PaymentRequirement {
  /** 支付方案：hackathon 阶段固定为 "pneuma-ec-escrow" */
  scheme: "pneuma-ec-escrow";
  /** 链 ID */
  chainId: number;
  /** 支付代币合约地址（Arc Testnet 上的 USDC，6 decimals） */
  asset: Address;
  /** 接收方：SkillRegistry 合约地址 */
  payTo: Address;
  /** 价格（最小单位字符串，避免 JSON number 精度问题） */
  maxAmountRequired: string;
  /** 调用方截止时间（Unix 秒） */
  deadline: number;
  /** 业务字段 */
  extra: {
    skillId: number;
    skillName: string;
  };
}

/**
 * 客户端在 X-PAYMENT 头里发送的支付凭证
 *
 * 编码：base64(JSON.stringify(X402PaymentHeader))
 *
 * V5 EIP-712 安全升级：caller escrow 后签 PaymentAuth typed-data 绑定
 *   (callId, paymentHash, caller, callerTBA, maxAmount, deadline)
 * 服务端 middleware 在 verifyPayment 阶段恢复签名地址比对链上 c.caller。
 *
 * 没有签名时（V4 stub `signature: "0x"`），任何监听链的人看到 callId 都可以
 * 消费 caller 的 escrow，攻击向量真实存在。
 */
export interface X402PaymentHeader {
  x402Version: typeof X402_VERSION;
  scheme: "pneuma-ec-escrow";
  /** 链上 SkillRegistry.escrowForCall() 返回的 callId */
  callId: string;
  /** EIP-712 PaymentAuth 签名（v5 起必填）—— 证明 caller 本人授权使用此 callId */
  signature: Hex;
  /** 用于反伪造的 paymentHash（也写到了链上） */
  paymentHash: Hex;
  /** caller 期望的签名者地址（server 比对链上 c.caller） */
  caller: Address;
  /** callerTBA 地址（多重绑定，确保签名跟身份关联） */
  callerTBA: Address;
  /** escrow 锁仓上限（V5 = maxCost；V4 = pricePerCall）—— 字符串避免 JSON number 精度损失 */
  maxAmount: string;
  /** 签名失效时间（Unix 秒）—— 建议 ≤ skill.slaTimeoutSec */
  deadline: number;
}

/**
 * 服务端中间件配置
 */
export interface MiddlewareConfig {
  /** 服务对应的 skill id（在 SkillRegistry 上注册过） */
  skillId: number;
  /** 服务名（用于 attestation） */
  skillName: string;
  /** 链 ID */
  chainId: number;
  /** 支付代币合约地址（Arc Testnet 上的 USDC，6 decimals） */
  paymentToken: Address;
  /** SkillRegistry 合约地址 */
  skillRegistry: Address;
  /** 服务方钱包私钥（settle 用） */
  serverPrivateKey: Hex;
  /** RPC URL */
  rpcUrl: string;
  /** 默认评分（settle 时给 caller 的） */
  defaultRating?: number;
  /** 价格（USDC 最小单位 = 1e-6 USDC），如果不传则链上读 */
  pricePerCall?: bigint;
}

/**
 * 客户端调用 skill 时的输入
 */
export interface CallSkillInput {
  /** 服务 endpoint */
  endpoint: string;
  /** 业务请求体 */
  body?: unknown;
  /** 调用方的 SoulAccount TBA 地址（attestation 挂这里） */
  callerTBA: Address;
  /** 自定义 paymentHash，不传则随机生成 */
  paymentHash?: Hex;
}

/**
 * 客户端 callSkill 返回值
 */
export interface CallSkillResult<T = unknown> {
  /** 业务返回 */
  data: T;
  /** 链上 escrow callId */
  callId: string;
  /** 链上支付的代币数量（USDC 最小单位 = 1e-6 USDC） */
  paidAmount: bigint;
  /** transaction hash of escrow */
  escrowTxHash: Hex;
}
