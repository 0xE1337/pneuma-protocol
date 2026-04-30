/**
 * EIP-712 typed-data 签名 —— x402 X-Payment 头的核心抓手
 *
 * 解决的安全问题（v5 必修）：
 *   - callId 是公开的（CallEscrowed 事件链上可见），任何监听者都能拿到
 *   - 没有签名时，攻击者拿到 Alice 的 callId 后，可以向 service endpoint 发请求消费 Alice 的 escrow
 *   - Alice 在不知情的情况下被扣 USDC（escrow 被消费 + provider 拿到钱）
 *
 * 解决方式：
 *   - Caller escrow 后，签 EIP-712 PaymentAuth 消息（绑定 callId + paymentHash + caller + callerTBA + chainId）
 *   - 服务端 middleware 在 verify 阶段校验签名 + 比对链上 c.caller
 *   - 只有持有 caller 私钥的人能授权调用 endpoint
 *
 * 设计选择：domain.verifyingContract = SkillRegistry 地址 ——
 *   把签名绑死到具体合约部署；同一签名换一个 chain / 换一个 SkillRegistry 即失效（防跨链 / 跨部署 replay）
 */

import {
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
  type WalletClient,
} from "viem";

/** EIP-712 域版本 —— 协议升级时 bump（强制旧签名失效） */
export const PNEUMA_PAYMENT_VERSION = "1";

/** EIP-712 域名 */
export const PNEUMA_PAYMENT_DOMAIN_NAME = "PneumaPayment";

/**
 * PaymentAuth 类型定义 —— EIP-712 标准 typed-data
 *
 * 字段语义：
 *   callId       — 链上 escrow 的 callId（绑定具体那笔 escrow）
 *   paymentHash  — escrow 时写入链上的 paymentHash（防换 callId 重放）
 *   caller       — 期望的签名者（链上 c.caller，server 用此比对）
 *   callerTBA    — TBA 地址（多重绑定，确保签名跟身份关联）
 *   maxAmount    — escrow 上限（V5 模式 = maxCost；V4 = pricePerCall）
 *   deadline     — 签名失效时间（Unix 秒，建议 ≤ skill.slaTimeoutSec）
 */
export const PAYMENT_AUTH_TYPES = {
  PaymentAuth: [
    { name: "callId", type: "uint256" },
    { name: "paymentHash", type: "bytes32" },
    { name: "caller", type: "address" },
    { name: "callerTBA", type: "address" },
    { name: "maxAmount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface PaymentAuthMessage {
  callId: bigint;
  paymentHash: Hex;
  caller: Address;
  callerTBA: Address;
  maxAmount: bigint;
  deadline: bigint;
}

/**
 * 构造 EIP-712 域 —— SkillRegistry 地址 + chainId 双重绑定
 */
export function buildPaymentDomain(params: {
  chainId: number;
  skillRegistry: Address;
}): TypedDataDomain {
  return {
    name: PNEUMA_PAYMENT_DOMAIN_NAME,
    version: PNEUMA_PAYMENT_VERSION,
    chainId: params.chainId,
    verifyingContract: params.skillRegistry,
  };
}

/**
 * Caller 端签 PaymentAuth —— 在 escrow 之后、发 X-Payment 请求之前调用
 *
 * @param walletClient viem wallet client（必须有 account）
 * @param domain       EIP-712 域（chainId + SkillRegistry）
 * @param message      PaymentAuth 消息体
 * @returns 65-byte ECDSA 签名（r + s + v）
 */
export async function signPaymentAuth(
  walletClient: WalletClient,
  domain: TypedDataDomain,
  message: PaymentAuthMessage,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error("eip712: wallet client missing account");
  }
  return walletClient.signTypedData({
    account: walletClient.account,
    domain,
    types: PAYMENT_AUTH_TYPES,
    primaryType: "PaymentAuth",
    message,
  });
}

/**
 * Server 端验签 —— 恢复签名者地址
 *
 * @returns 签名所对应的地址（与 expectedCaller 比对即知是否合法）
 */
export async function recoverPaymentAuthSigner(
  domain: TypedDataDomain,
  message: PaymentAuthMessage,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: PAYMENT_AUTH_TYPES,
    primaryType: "PaymentAuth",
    message,
    signature,
  });
}

/**
 * Server 端便捷验签 —— 一步出结果
 *
 * @returns { valid, recovered, reason }
 *   valid     是否通过（recovered === expectedCaller 且 deadline 未过期）
 *   recovered 实际恢复出的签名地址
 *   reason    失败原因（仅 valid=false 时有值）
 */
export async function verifyPaymentAuth(params: {
  domain: TypedDataDomain;
  message: PaymentAuthMessage;
  signature: Hex;
  expectedCaller: Address;
  /** 当前时间（Unix 秒，默认 Date.now()/1000）—— 测试可注入固定时间 */
  now?: number;
}): Promise<{ valid: boolean; recovered?: Address; reason?: string }> {
  const now = params.now ?? Math.floor(Date.now() / 1000);

  // 签名过期检查
  if (BigInt(now) > params.message.deadline) {
    return {
      valid: false,
      reason: `deadline expired: now=${now}, deadline=${params.message.deadline.toString()}`,
    };
  }

  let recovered: Address;
  try {
    recovered = await recoverPaymentAuthSigner(
      params.domain,
      params.message,
      params.signature,
    );
  } catch (err) {
    return {
      valid: false,
      reason: `recover failed: ${(err as Error).message}`,
    };
  }

  if (recovered.toLowerCase() !== params.expectedCaller.toLowerCase()) {
    return {
      valid: false,
      recovered,
      reason: `signer mismatch: expected ${params.expectedCaller}, got ${recovered}`,
    };
  }

  return { valid: true, recovered };
}
