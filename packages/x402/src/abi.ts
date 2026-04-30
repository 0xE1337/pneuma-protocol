/**
 * Pneuma 协议合约 ABI 摘要 — 仅 x402 中间件需要的部分
 */

export const SkillRegistryAbi = [
  {
    type: "function",
    name: "getSkill",
    stateMutability: "view",
    inputs: [{ name: "skillId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        // 必须与 contracts/src/SkillRegistry.sol 的 Skill struct 严格同序、同长度
        // 否则 viem 抛 decode error，整个 readSkill 调用挂掉
        components: [
          { name: "skillId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "endpoint", type: "string" },
          { name: "category", type: "string" },
          { name: "pricePerCall", type: "uint256" },
          { name: "totalCalls", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "createdAt", type: "uint256" },
          { name: "providerStake", type: "uint256" },
          { name: "slaTimeoutSec", type: "uint256" },
          { name: "slashBps", type: "uint256" },
          { name: "lockedStake", type: "uint256" },
          { name: "maxInputBytes", type: "uint32" },
          { name: "maxOutputBytes", type: "uint32" },
          // v5 per-byte 计费 + 上游披露
          { name: "baseFee", type: "uint256" },
          { name: "inputPricePerKB", type: "uint256" },
          { name: "outputPricePerKB", type: "uint256" },
          { name: "upstreamModel", type: "string" },
          { name: "markupBps", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getCall",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        // 必须与 contracts/src/SkillRegistry.sol 的 CallRecord struct 严格同序、同长度
        components: [
          { name: "callId", type: "uint256" },
          { name: "skillId", type: "uint256" },
          { name: "caller", type: "address" },
          { name: "callerTBA", type: "address" },
          { name: "amountEscrowed", type: "uint256" },
          { name: "paymentHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "startedAt", type: "uint256" },
          { name: "slashed", type: "bool" }, // v2 — 防 timeout-slash 与 revoke-slash 双花
          // v5 per-byte 多退少补
          { name: "inputBytes", type: "uint32" },
          { name: "maxOutputBytes", type: "uint32" },
          { name: "actualOutputBytes", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "escrowForCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "uint256" },
      { name: "callerTBA", type: "address" },
      { name: "paymentHash", type: "bytes32" },
      { name: "inputBytes", type: "uint32" },
      { name: "maxOutputBytes", type: "uint32" },
    ],
    outputs: [{ name: "callId", type: "uint256" }],
  },
  {
    type: "function",
    name: "settleCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "callId", type: "uint256" },
      { name: "actualOutputBytes", type: "uint32" },
      { name: "rating", type: "uint8" },
      { name: "comment", type: "string" },
    ],
    outputs: [{ name: "attestationUid", type: "bytes32" }],
  },
  {
    type: "event",
    name: "CallEscrowed",
    inputs: [
      { name: "callId", type: "uint256", indexed: true },
      { name: "skillId", type: "uint256", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "callerTBA", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "paymentHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

/**
 * 通用 ERC-20 ABI 摘要 —— 切换到 Arc Testnet 原生 USDC（6 decimals）后，
 * 这里不再绑定特定代币，但保留 paymentToken 这个语义。
 */
export const Erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/**
 * Call status enum (镜像 SkillRegistry.CallStatus)
 */
export enum CallStatus {
  Pending = 0,
  Settled = 1,
  Refunded = 2,
}
