/**
 * 服务端的链上交互辅助 — 验证 callId、settle、读 skill
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SkillRegistryAbi, CallStatus } from "../abi.js";
import type { MiddlewareConfig } from "../types.js";

/**
 * 用配置初始化 viem 的 public + wallet client
 */
export function createServerClients(config: MiddlewareConfig): {
  publicClient: PublicClient;
  walletClient: WalletClient;
  serverAddress: Address;
} {
  const account = privateKeyToAccount(config.serverPrivateKey);

  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    transport: http(config.rpcUrl),
  });

  return {
    publicClient,
    walletClient,
    serverAddress: account.address,
  };
}

/**
 * 链上读 skill 信息（用于构造 PaymentChallenge）
 */
export async function readSkill(
  publicClient: PublicClient,
  skillRegistry: Address,
  skillId: number,
): Promise<{
  active: boolean;
  pricePerCall: bigint;
  name: string;
  category: string;
  owner: Address;
}> {
  const skill = await publicClient.readContract({
    address: skillRegistry,
    abi: SkillRegistryAbi,
    functionName: "getSkill",
    args: [BigInt(skillId)],
  });
  return {
    active: skill.active,
    pricePerCall: skill.pricePerCall,
    name: skill.name,
    category: skill.category,
    owner: skill.owner,
  };
}

/**
 * 链上验证 callId 是否合法、状态是否 Pending、paymentHash 是否匹配
 */
export async function verifyCall(
  publicClient: PublicClient,
  skillRegistry: Address,
  callId: bigint,
  expectedSkillId: number,
  expectedPaymentHash: Hex,
): Promise<{
  valid: boolean;
  reason?: string;
  caller?: Address;
  callerTBA?: Address;
}> {
  try {
    const call = await publicClient.readContract({
      address: skillRegistry,
      abi: SkillRegistryAbi,
      functionName: "getCall",
      args: [callId],
    });

    if (Number(call.skillId) !== expectedSkillId) {
      return { valid: false, reason: "skillId mismatch" };
    }
    if (call.paymentHash.toLowerCase() !== expectedPaymentHash.toLowerCase()) {
      return { valid: false, reason: "paymentHash mismatch" };
    }
    if (call.status !== CallStatus.Pending) {
      return { valid: false, reason: `call status is ${call.status}, not Pending` };
    }
    return {
      valid: true,
      caller: call.caller,
      callerTBA: call.callerTBA,
    };
  } catch (err) {
    return { valid: false, reason: `getCall reverted: ${(err as Error).message}` };
  }
}

/**
 * 服务端 settle —— handler 跑完之后自动调用
 *
 * 注意：调用方必须是 skill owner（即 server 的钱包地址）
 */
export async function settleCall(
  walletClient: WalletClient,
  publicClient: PublicClient,
  skillRegistry: Address,
  callId: bigint,
  rating: number,
  comment: string = "",
  /**
   * V5 多退少补：Provider 自报实际输出字节数（V4 模式传 0 即可）
   * - V5 模式：必须 ≤ caller escrow 时声明的 maxOutputBytes，否则合约 revert
   * - V4 模式：被合约忽略，全额结算给 Provider
   */
  actualOutputBytes: number = 0,
): Promise<{ txHash: Hex; attestationUid?: Hex }> {
  if (!walletClient.account) throw new Error("wallet client missing account");

  const { request } = await publicClient.simulateContract({
    address: skillRegistry,
    abi: SkillRegistryAbi,
    functionName: "settleCall",
    args: [callId, actualOutputBytes, rating, comment],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);

  // 等 receipt 拿 attestation uid
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // 从 logs 提取 CallSettled / Attested 事件（简化版：返回 tx hash 即可）
  return {
    txHash,
    // hackathon 阶段：attestationUid 留给 client 自己 query 链上
  };
}
