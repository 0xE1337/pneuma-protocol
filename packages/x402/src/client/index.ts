/**
 * PneumaClient — 客户端 SDK
 *
 * 自动处理 x402 协议的全流程：
 *   1. 首次 fetch 服务端点
 *   2. 收到 402 + PaymentChallenge → 链上 escrow
 *   3. 重试请求带 X-PAYMENT 头
 *   4. 返回业务结果
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Erc20Abi, SkillRegistryAbi } from "../abi.js";
import type { CallSkillInput, CallSkillResult, PaymentChallenge, X402PaymentHeader } from "../types.js";
import { X402_VERSION } from "../types.js";
import { buildPaymentDomain, signPaymentAuth } from "../eip712.js";

/** EIP-712 PaymentAuth 签名默认有效期（5 分钟）—— 跟 402 challenge 的 deadline 对齐 */
const DEFAULT_PAYMENT_AUTH_TTL_SECONDS = 5 * 60;

export interface PneumaClientConfig {
  /** RPC URL */
  rpcUrl: string;
  /** 链 ID（用于校验） */
  chainId: number;
  /** 支付代币合约地址（Arc Testnet 上的 USDC，6 decimals） */
  paymentToken: Address;
  /** SkillRegistry 合约地址 */
  skillRegistry: Address;
  /** 客户端钱包私钥（escrow 自付 gas） */
  privateKey: Hex;
}

export class PneumaClient {
  private config: PneumaClientConfig;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private clientAddress: Address;

  constructor(config: PneumaClientConfig) {
    this.config = config;
    const account = privateKeyToAccount(config.privateKey);
    this.clientAddress = account.address;

    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account,
      transport: http(config.rpcUrl),
    });
  }

  /**
   * 调用一个 skill 服务，自动处理 402 + 链上 escrow + 重试
   */
  async callSkill<T = unknown>(input: CallSkillInput): Promise<CallSkillResult<T>> {
    const { endpoint, body, callerTBA } = input;
    const paymentHash = input.paymentHash ?? this.randomPaymentHash();

    // 1. 首次请求（无 X-PAYMENT）
    const initialResp = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

    // 如果直接 200 就返回（白嫖路径，不应发生但兼容）
    if (initialResp.status === 200) {
      return {
        data: (await initialResp.json()) as T,
        callId: "0",
        paidAmount: 0n,
        escrowTxHash: "0x" as Hex,
      };
    }

    if (initialResp.status !== 402) {
      throw new Error(`unexpected status ${initialResp.status}`);
    }

    const challenge = (await initialResp.json()) as PaymentChallenge;
    if (challenge.x402Version !== X402_VERSION) {
      throw new Error(`unsupported x402 version ${challenge.x402Version}`);
    }
    const requirement = challenge.accepts.find((r) => r.scheme === "pneuma-ec-escrow");
    if (!requirement) {
      throw new Error("no pneuma-ec-escrow scheme accepted");
    }
    if (requirement.chainId !== this.config.chainId) {
      throw new Error(`chainId mismatch: expected ${this.config.chainId}, got ${requirement.chainId}`);
    }

    const amount = BigInt(requirement.maxAmountRequired);

    // 2. 检查 allowance，不够就 approve
    await this.ensureAllowance(amount);

    // 3. 链上 escrow
    // v4 inputBytes — 估算请求 body 字节数（off-chain middleware 应再次精确校验）
    const inputBytes = body
      ? new TextEncoder().encode(JSON.stringify(body)).length
      : 0;
    // v5 maxOutputBytes — 来自 402 challenge requirement.extra.maxOutputBytes（V5 模式下 service 必传）
    // V4 skill 不传该字段时用 0（合约层 V4 模式忽略）
    const extraField = (requirement.extra as unknown as Record<string, unknown>).maxOutputBytes;
    const maxOutputBytes = typeof extraField === "number" ? extraField : 0;
    const { callId, txHash } = await this.escrowForCall(
      requirement.extra.skillId,
      callerTBA,
      paymentHash,
      inputBytes,
      maxOutputBytes,
    );

    // 4. 签 EIP-712 PaymentAuth —— 防 callId 被监听者抢用消费 escrow
    //    要点：domain 绑死 SkillRegistry 地址 + chainId（防跨链 / 跨部署 replay）
    //          message 绑死 (callId, paymentHash, caller, callerTBA, maxAmount, deadline)
    const deadline = Math.floor(Date.now() / 1000) + DEFAULT_PAYMENT_AUTH_TTL_SECONDS;
    const domain = buildPaymentDomain({
      chainId: this.config.chainId,
      skillRegistry: this.config.skillRegistry,
    });
    const signature = await signPaymentAuth(this.walletClient, domain, {
      callId,
      paymentHash,
      caller: this.clientAddress,
      callerTBA,
      maxAmount: amount,
      deadline: BigInt(deadline),
    });

    // 5. 构造 X-PAYMENT 头并重试 —— v5 起带真签名
    const paymentHeader: X402PaymentHeader = {
      x402Version: X402_VERSION,
      scheme: "pneuma-ec-escrow",
      callId: callId.toString(),
      paymentHash,
      signature,
      caller: this.clientAddress,
      callerTBA,
      maxAmount: amount.toString(),
      deadline,
    };
    const headerValue = Buffer.from(JSON.stringify(paymentHeader), "utf-8").toString("base64");

    const retryResp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Payment": headerValue,
      },
      body: JSON.stringify(body ?? {}),
    });

    if (!retryResp.ok) {
      const errBody = await retryResp.text();
      throw new Error(`service returned ${retryResp.status}: ${errBody}`);
    }

    return {
      data: (await retryResp.json()) as T,
      callId: callId.toString(),
      paidAmount: amount,
      escrowTxHash: txHash,
    };
  }

  /**
   * 检查并按需 approve 给 SkillRegistry
   */
  private async ensureAllowance(needed: bigint): Promise<void> {
    const current = await this.publicClient.readContract({
      address: this.config.paymentToken,
      abi: Erc20Abi,
      functionName: "allowance",
      args: [this.clientAddress, this.config.skillRegistry],
    });

    if (current >= needed) return;

    // 一次性 approve 大额，避免反复签名
    const approveAmount = needed * 1000n;

    if (!this.walletClient.account) throw new Error("wallet missing account");

    const { request } = await this.publicClient.simulateContract({
      address: this.config.paymentToken,
      abi: Erc20Abi,
      functionName: "approve",
      args: [this.config.skillRegistry, approveAmount],
      account: this.walletClient.account,
    });
    const txHash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  /**
   * 链上 escrow，从 receipt 里提 callId
   */
  private async escrowForCall(
    skillId: number,
    callerTBA: Address,
    paymentHash: Hex,
    inputBytes: number,
    maxOutputBytes: number,
  ): Promise<{ callId: bigint; txHash: Hex }> {
    if (!this.walletClient.account) throw new Error("wallet missing account");

    const { request } = await this.publicClient.simulateContract({
      address: this.config.skillRegistry,
      abi: SkillRegistryAbi,
      functionName: "escrowForCall",
      args: [BigInt(skillId), callerTBA, paymentHash, inputBytes, maxOutputBytes],
      account: this.walletClient.account,
    });

    const txHash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    // 从 logs 里找 CallEscrowed 事件
    const escrowLog = receipt.logs.find(
      (log) => log.address.toLowerCase() === this.config.skillRegistry.toLowerCase(),
    );
    if (!escrowLog || escrowLog.topics.length < 2) {
      throw new Error("no CallEscrowed event in receipt");
    }
    // topic[1] is indexed callId
    const callId = BigInt(escrowLog.topics[1] as Hex);

    return { callId, txHash };
  }

  private randomPaymentHash(): Hex {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return keccak256(toBytes(`pneuma-${Date.now()}-${Buffer.from(bytes).toString("hex")}`));
  }

  /**
   * 取客户端钱包地址（外部 debug 用）
   */
  get address(): Address {
    return this.clientAddress;
  }
}
