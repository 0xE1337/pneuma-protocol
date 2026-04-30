import type { Address } from "viem";

export const SOUL_NFT = process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS as Address;
export const PNEUMA_ATTESTATION = process.env.NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS as Address;
export const EXPLORER_URL = process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? "https://testnet.arcscan.app";
export const addressUrl = (a: string) => `${EXPLORER_URL}/address/${a}`;

/** USDC 在 Arc Testnet 是 6 decimals（与 Circle 主网一致），所有金额 formatUnits 用 6 */
export const USDC_DECIMALS = 6;

export const SoulNFTAbi = [
  {
    type: "function",
    name: "tbaOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "souls",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "agentName", type: "string" },
      { name: "agentEndpoint", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "tba", type: "address" },
      { name: "createdAt", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  // Transfer event：viewer 用 getLogs 反查"任意钱包持有的 Soul"
  // 也是 P2-6 owner timeline 的数据来源
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

export const PneumaAttestationAbi = [
  {
    type: "function",
    name: "getAttestationsByRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "skillId", type: "uint256" },
          { name: "callId", type: "uint256" }, // v2 — revoke→slash 反查 key（boundary / 旧 attest 时为 0）
          { name: "paymentHash", type: "bytes32" },
          { name: "rating", type: "uint8" },
          // 以 USDC（6 decimals）计价的支付金额
          { name: "paidAmount", type: "uint256" },
          { name: "skillName", type: "string" },
          { name: "skillCategory", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "revoked", type: "bool" },
          { name: "raterRole", type: "uint8" }, // 0=PROVIDER 1=CALLER 2=JUROR 3=SYSTEM(boundary)
          { name: "comment", type: "string" }, // 自由文本评论（最长 280 字符；boundary/无评论时空字符串）
        ],
      },
    ],
  },
  {
    type: "function",
    name: "SCHEMA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/// raterRole 枚举值（与 PneumaAttestation.RaterRole Solidity enum 一一对应）
export const RATER_ROLE = {
  PROVIDER: 0,
  CALLER: 1,
  JUROR: 2,
  SYSTEM: 3, // ownership boundary by SoulNFT — 反信用洗白攻击的链上锚点
} as const;

/// SYSTEM-rater attestation 的 skillCategory 常量 —— 用于在前端识别 boundary 条目
export const BOUNDARY_CATEGORY = "system:ownership";
