/**
 * Pneuma 合约地址 + ABI 摘要 —— 前端用
 *
 * 地址从 .env.local 注入（NEXT_PUBLIC_* 自动暴露给浏览器）
 *
 * 支付资产：Arc Testnet 原生 USDC（6 decimals），合约地址同时是 native gas + ERC-20。
 * 所有金额格式化必须用 6 decimals（formatUnits/parseUnits 第二参数 = 6）。
 */

import type { Address } from "viem";

export const SOUL_NFT = process.env.NEXT_PUBLIC_SOUL_NFT_ADDRESS as Address;
export const SOUL_ACCOUNT_IMPL = process.env.NEXT_PUBLIC_SOUL_ACCOUNT_IMPL as Address;
export const USDC_TOKEN = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address;
export const SKILL_REGISTRY = process.env.NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS as Address;
export const PNEUMA_ATTESTATION = process.env.NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS as Address;
/** V6.0.1 — 知识公地（Publication + Citation 引用图） */
export const PNEUMA_COMMONS = process.env.NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS as Address;
/** V6.0.2 — 声誉担保图（Endorsement + 连带 slash） */
export const REPUTATION_GRAPH = process.env.NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS as Address;
/** PneumaCourt — multi-juror dispute resolution (file → vote → finalize) */
export const PNEUMA_COURT = process.env.NEXT_PUBLIC_PNEUMA_COURT_ADDRESS as Address;
export const ERC6551_REGISTRY = (process.env.NEXT_PUBLIC_ERC6551_REGISTRY ??
  "0x000000006551c19487814612e58FE06813775758") as Address;

export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? "https://testnet.arcscan.app";

/** USDC 在 Arc Testnet 是 6 decimals（与 Circle 主网保持一致），不是 18！ */
export const USDC_DECIMALS = 6;

/** Circle 官方 testnet faucet —— 用户领测试 USDC 的入口 */
export const USDC_FAUCET_URL = "https://faucet.circle.com";

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER_URL}/address/${addr}`;

/**
 * raterRole 枚举值（与 PneumaAttestation.RaterRole Solidity enum 一一对应）
 * 反信用洗白攻击的核心抓手：SYSTEM-rater 由 SoulNFT 在转主时自动写入，
 * 与 PROVIDER/CALLER 评分隔离权限（BOUNDARY_ATTESTER_ROLE）
 */
export const RATER_ROLE = {
  PROVIDER: 0,
  CALLER: 1,
  JUROR: 2,
  SYSTEM: 3, // ownership boundary by SoulNFT
} as const;

/** SYSTEM-rater attestation 的 skillCategory 常量 —— 前端按此切分 timeline */
export const BOUNDARY_CATEGORY = "system:ownership";

// ──────────────────────────────────────────────────────────────────────
//  ABIs（前端只用到的子集）
// ──────────────────────────────────────────────────────────────────────

export const SoulNFTAbi = [
  {
    type: "function",
    name: "publicMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentName", type: "string" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "tba", type: "address" },
    ],
  },
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SoulMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "tba", type: "address", indexed: false },
      { name: "agentName", type: "string", indexed: false },
    ],
  },
] as const;

/**
 * UsdcAbi —— 标准 IERC20 子集（外部 USDC 合约，非自家代币）
 * 不绑定自家代币 ABI；用户去 Circle faucet（USDC_FAUCET_URL）领测试 USDC。
 */
export const UsdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
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

// Skill 元组的全部字段（v2 起 stake / SLA / slashBps / lockedStake；v4 size cap；v5 per-byte + 上游披露）
const SKILL_TUPLE_COMPONENTS = [
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
  { name: "providerStake", type: "uint256" }, // v2 — provider 注册时锁的 USDC 押金
  { name: "slaTimeoutSec", type: "uint256" }, // v2 — SLA 上限
  { name: "slashBps", type: "uint256" }, // v2 — slash 比例 (bp, 1e4 = 100%)
  { name: "lockedStake", type: "uint256" }, // v2 — 当前 active call 占用的 stake
  { name: "maxInputBytes", type: "uint32" }, // v4 — input 字节上限（DDoS 防御 + tier 拆分）
  { name: "maxOutputBytes", type: "uint32" }, // v4 — Provider 承诺的 output 上限（V5 模式下硬约束）
  { name: "baseFee", type: "uint256" }, // v5 — 固定开销
  { name: "inputPricePerKB", type: "uint256" }, // v5 — input 每 KB 价（USDC 6 dec）
  { name: "outputPricePerKB", type: "uint256" }, // v5 — output 每 KB 价
  { name: "upstreamModel", type: "string" }, // v5 — 上游模型自声明（"claude-sonnet-4.5" / ""）
  { name: "markupBps", type: "uint16" }, // v5 — 自声明 markup 基点（10000 = 100%）
] as const;

export const SkillRegistryAbi = [
  {
    type: "function",
    name: "registerSkill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "category", type: "string" },
      { name: "pricePerCall", type: "uint256" },
      { name: "providerStake", type: "uint256" }, // v2 — 注册时锁的 USDC 押金（可为 0）
      { name: "slaTimeoutSec", type: "uint256" }, // v2 — 必须 > 0
      { name: "slashBps", type: "uint256" }, // v2 — 0 - 10000
      { name: "maxInputBytes", type: "uint32" }, // v4 — 0 = DEFAULT 4 KB
      { name: "maxOutputBytes", type: "uint32" }, // v4 — Provider 承诺的 output 上限（可为 0）
    ],
    outputs: [{ name: "skillId", type: "uint256" }],
  },
  {
    type: "function",
    name: "listActiveSkills",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "tuple[]", components: SKILL_TUPLE_COMPONENTS }],
  },
  {
    type: "function",
    name: "callCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "skillCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSkill",
    stateMutability: "view",
    inputs: [{ name: "skillId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: SKILL_TUPLE_COMPONENTS }],
  },
  // v2 — provider 提取剩余可用 stake
  {
    type: "function",
    name: "withdrawStake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  // v2 — 任何人可在 SLA 超时后触发 slash + 退款
  {
    type: "function",
    name: "claimTimeoutAndSlash",
    stateMutability: "nonpayable",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [],
  },
  // v2 — 由 PneumaAttestation.revoke 联动调用（用户前端通常不直接调）
  {
    type: "function",
    name: "slashOnRevoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [],
  },
  // v2 — BudgetController 钩子地址（前端可读判断是否启用预算）
  {
    type: "function",
    name: "budgetController",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // 当前 paymentToken 地址（部署时绑定到 Arc 原生 USDC）
  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "escrowForCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "uint256" },
      { name: "callerTBA", type: "address" },
      { name: "paymentHash", type: "bytes32" },
      { name: "inputBytes", type: "uint32" }, // v4 — caller 声明请求 body 字节数（协议层 size cap 守门）
      { name: "maxOutputBytes", type: "uint32" }, // v5 — caller 声明输出上限（V5 模式必填，V4 模式被忽略）
    ],
    outputs: [{ name: "callId", type: "uint256" }],
  },
  {
    type: "function",
    name: "settleCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "callId", type: "uint256" },
      { name: "actualOutputBytes", type: "uint32" }, // v5 — Provider 自报实际输出字节（V4 传 0）
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
  {
    type: "event",
    name: "CallSettled",
    inputs: [
      { name: "callId", type: "uint256", indexed: true },
      { name: "rating", type: "uint8", indexed: false },
      { name: "attestationUid", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SkillRegistered",
    inputs: [
      { name: "skillId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "pricePerCall", type: "uint256", indexed: false },
    ],
  },
  // Caller 反向评分（multi-rater attestation）
  {
    type: "function",
    name: "callerRateSkill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "callId", type: "uint256" },
      { name: "rating", type: "uint8" },
      { name: "comment", type: "string" },
    ],
    outputs: [{ name: "attestationUid", type: "bytes32" }],
  },
  {
    type: "function",
    name: "callerHasRated",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "CallerRatedSkill",
    inputs: [
      { name: "callId", type: "uint256", indexed: true },
      { name: "skillId", type: "uint256", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "rating", type: "uint8", indexed: false },
      { name: "attestationUid", type: "bytes32", indexed: false },
    ],
  },
  // v2 — Track A 经济安全事件：链下 indexer / 前端可订阅
  {
    type: "event",
    name: "SkillRegisteredWithStake",
    inputs: [
      { name: "skillId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "providerStake", type: "uint256", indexed: false },
      { name: "slaTimeoutSec", type: "uint256", indexed: false },
      { name: "slashBps", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StakeWithdrawn",
    inputs: [
      { name: "skillId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    // reason: 0=Timeout (claimTimeoutAndSlash), 1=Revoke (slashOnRevoke)
    type: "event",
    name: "CallSlashed",
    inputs: [
      { name: "callId", type: "uint256", indexed: true },
      { name: "skillId", type: "uint256", indexed: true },
      { name: "slashAmount", type: "uint256", indexed: false },
      { name: "slashedTo", type: "address", indexed: false },
      { name: "reason", type: "uint8", indexed: false },
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
          { name: "raterRole", type: "uint8" }, // 0=PROVIDER, 1=CALLER, 2=JUROR, 3=SYSTEM
          { name: "comment", type: "string" }, // 自由文本评论（最长 280 字符；boundary/无评论时空字符串）
        ],
      },
    ],
  },
  {
    type: "function",
    name: "countByRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "SCHEMA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  // Events for live-events subscription on /demo-dashboard
  {
    // 必须严格匹配链上 PneumaAttestation.sol 的 Attested 事件签名
    // 字段顺序错位会让 viem decode 失败、整类事件订阅返回空
    type: "event",
    name: "Attested",
    inputs: [
      { name: "uid", type: "bytes32", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "skillId", type: "uint256", indexed: false },
      { name: "paymentHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OwnershipBoundary",
    inputs: [
      { name: "uid", type: "bytes32", indexed: true },
      { name: "tba", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: false },
      { name: "to", type: "address", indexed: false },
    ],
  },
  // v2 — 治理：配置 SkillRegistry 钩子地址（revoke→slash 联动入口；admin 专用）
  {
    type: "function",
    name: "setSkillRegistry",
    stateMutability: "nonpayable",
    inputs: [{ name: "newRegistry", type: "address" }],
    outputs: [],
  },
] as const;

// ──────────────────────────────────────────────────────────────────────
//  PneumaCommons (V6.0.1) —— 知识公地 ABI
// ──────────────────────────────────────────────────────────────────────

const PUBLICATION_TUPLE = [
  { name: "pubId", type: "uint256" },
  { name: "author", type: "address" },
  { name: "contentType", type: "string" },
  { name: "contentHash", type: "bytes32" },
  { name: "title", type: "string" },
  { name: "summary", type: "string" },
  { name: "publishedAt", type: "uint256" },
  { name: "citationCount", type: "uint256" },
  { name: "retracted", type: "bool" },
] as const;

const CITATION_TUPLE = [
  { name: "citationId", type: "uint256" },
  { name: "fromPubId", type: "uint256" },
  { name: "toPubId", type: "uint256" },
  { name: "citer", type: "address" },
  { name: "context", type: "string" },
  { name: "timestamp", type: "uint256" },
] as const;

export const PneumaCommonsAbi = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contentType", type: "string" },
      { name: "contentHash", type: "bytes32" },
      { name: "title", type: "string" },
      { name: "summary", type: "string" },
    ],
    outputs: [{ name: "pubId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cite",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fromPubId", type: "uint256" },
      { name: "toPubId", type: "uint256" },
      { name: "context", type: "string" },
    ],
    outputs: [{ name: "citationId", type: "uint256" }],
  },
  {
    type: "function",
    name: "retract",
    stateMutability: "nonpayable",
    inputs: [{ name: "pubId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getPublication",
    stateMutability: "view",
    inputs: [{ name: "pubId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: PUBLICATION_TUPLE }],
  },
  {
    type: "function",
    name: "getCitation",
    stateMutability: "view",
    inputs: [{ name: "citationId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: CITATION_TUPLE }],
  },
  {
    type: "function",
    name: "getPublicationsByAuthor",
    stateMutability: "view",
    inputs: [{ name: "author", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getCitationsTo",
    stateMutability: "view",
    inputs: [{ name: "pubId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getCitationsFrom",
    stateMutability: "view",
    inputs: [{ name: "pubId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "hasCited",
    stateMutability: "view",
    inputs: [
      { name: "fromPubId", type: "uint256" },
      { name: "toPubId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "listAllPublications",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "", type: "tuple[]", components: PUBLICATION_TUPLE }],
  },
  {
    type: "function",
    name: "publicationCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalCitations",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Published",
    inputs: [
      { name: "pubId", type: "uint256", indexed: true },
      { name: "author", type: "address", indexed: true },
      { name: "contentType", type: "string", indexed: false },
      { name: "contentHash", type: "bytes32", indexed: true },
      { name: "title", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Cited",
    inputs: [
      { name: "citationId", type: "uint256", indexed: true },
      { name: "fromPubId", type: "uint256", indexed: true },
      { name: "toPubId", type: "uint256", indexed: true },
      { name: "citer", type: "address", indexed: false },
      { name: "context", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Retracted",
    inputs: [
      { name: "pubId", type: "uint256", indexed: true },
      { name: "author", type: "address", indexed: true },
    ],
  },
] as const;

// ──────────────────────────────────────────────────────────────────────
//  ReputationGraph (V6.0.2) —— 声誉担保图 ABI
// ──────────────────────────────────────────────────────────────────────

const ENDORSEMENT_TUPLE = [
  { name: "endorsementId", type: "uint256" },
  { name: "endorser", type: "address" },
  { name: "endorsee", type: "address" },
  { name: "stakedAmount", type: "uint256" },
  { name: "startedAt", type: "uint256" },
  { name: "unlockRequestedAt", type: "uint256" },
  { name: "active", type: "bool" },
  { name: "context", type: "string" },
] as const;

export const ReputationGraphAbi = [
  {
    type: "function",
    name: "endorse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "endorsee", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "context", type: "string" },
    ],
    outputs: [{ name: "endorsementId", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestUnlock",
    stateMutability: "nonpayable",
    inputs: [{ name: "endorsementId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "endorsementId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getEndorsement",
    stateMutability: "view",
    inputs: [{ name: "endorsementId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: ENDORSEMENT_TUPLE }],
  },
  {
    type: "function",
    name: "getEndorsementsByEndorser",
    stateMutability: "view",
    inputs: [{ name: "endorser", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getEndorsementsByEndorsee",
    stateMutability: "view",
    inputs: [{ name: "endorsee", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getActiveEndorsementsTo",
    stateMutability: "view",
    inputs: [{ name: "endorsee", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getActiveEndorsementId",
    stateMutability: "view",
    inputs: [
      { name: "endorser", type: "address" },
      { name: "endorsee", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalActiveStakeTo",
    stateMutability: "view",
    inputs: [{ name: "endorsee", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "endorsementCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Endorsed",
    inputs: [
      { name: "endorsementId", type: "uint256", indexed: true },
      { name: "endorser", type: "address", indexed: true },
      { name: "endorsee", type: "address", indexed: true },
      { name: "stakedAmount", type: "uint256", indexed: false },
      { name: "context", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EndorserSlashed",
    inputs: [
      { name: "endorsementId", type: "uint256", indexed: true },
      { name: "endorser", type: "address", indexed: true },
      { name: "endorsee", type: "address", indexed: true },
      { name: "slashAmount", type: "uint256", indexed: false },
      { name: "harmedParty", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "endorsementId", type: "uint256", indexed: true },
      { name: "endorser", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;


// ──────────────────────────────────────────────────────────────────────
//  PneumaCourt ABI —— multi-juror dispute (file/vote/finalize)
// ──────────────────────────────────────────────────────────────────────

/** Verdict 枚举 ↔ 跟 Solidity Verdict { Pending, GuiltyForPlaintiff, InnocentForDefendant } 一一对应 */
export const VERDICT = {
  PENDING: 0,
  GUILTY: 1,
  INNOCENT: 2,
} as const;

/** DisputeStatus 枚举 ↔ 跟 Solidity { None, Voting, Resolved } */
export const DISPUTE_STATUS = {
  NONE: 0,
  VOTING: 1,
  RESOLVED: 2,
} as const;

const DISPUTE_VIEW_COMPONENTS = [
  { name: "disputeId", type: "uint256" },
  { name: "callId", type: "uint256" },
  { name: "plaintiff", type: "address" },
  { name: "defendant", type: "address" },
  { name: "evidenceHash", type: "bytes32" },
  { name: "description", type: "string" },
  { name: "jurors", type: "address[]" },
  { name: "guiltyVotes", type: "uint256" },
  { name: "innocentVotes", type: "uint256" },
  { name: "votingDeadline", type: "uint256" },
  { name: "status", type: "uint8" },
  { name: "verdict", type: "uint8" },
] as const;

export const PneumaCourtAbi = [
  {
    type: "function",
    name: "fileDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "callId", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "description", type: "string" },
      { name: "jurors", type: "address[]" },
    ],
    outputs: [{ name: "disputeId", type: "uint256" }],
  },
  {
    type: "function",
    name: "vote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "disputeId", type: "uint256" },
      { name: "guilty", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "nonpayable",
    inputs: [{ name: "disputeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getDispute",
    stateMutability: "view",
    inputs: [{ name: "disputeId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: DISPUTE_VIEW_COMPONENTS }],
  },
  {
    type: "function",
    name: "hasVoted",
    stateMutability: "view",
    inputs: [
      { name: "disputeId", type: "uint256" },
      { name: "juror", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "jurorVerdict",
    stateMutability: "view",
    inputs: [
      { name: "disputeId", type: "uint256" },
      { name: "juror", type: "address" },
    ],
    outputs: [{ name: "guilty", type: "bool" }],
  },
  {
    type: "function",
    name: "isCallDisputed",
    stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "disputeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "DisputeFiled",
    inputs: [
      { name: "disputeId", type: "uint256", indexed: true },
      { name: "callId", type: "uint256", indexed: true },
      { name: "plaintiff", type: "address", indexed: true },
      { name: "defendant", type: "address", indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "jurors", type: "address[]", indexed: false },
      { name: "votingDeadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Voted",
    inputs: [
      { name: "disputeId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
      { name: "guilty", type: "bool", indexed: false },
      { name: "guiltyVotes", type: "uint256", indexed: false },
      { name: "innocentVotes", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DisputeResolved",
    inputs: [
      { name: "disputeId", type: "uint256", indexed: true },
      { name: "verdict", type: "uint8", indexed: false },
      { name: "callId", type: "uint256", indexed: false },
    ],
  },
] as const;
