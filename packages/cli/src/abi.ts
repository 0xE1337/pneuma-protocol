/**
 * v2 合约 ABI 子集 —— CLI 只用到的部分
 *
 * 与 apps/hub/lib/contracts.ts 保持一致；后续应抽到 packages/abi 共享。
 */

export const Erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

export const SoulNFTAbi = [
  {
    type: "function", name: "publicMint", stateMutability: "nonpayable",
    inputs: [{ name: "agentName", type: "string" }, { name: "metadataURI", type: "string" }],
    outputs: [{ name: "tokenId", type: "uint256" }, { name: "tba", type: "address" }],
  },
  {
    type: "function", name: "tbaOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "totalMinted", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "souls", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "agentName", type: "string" },
      { name: "agentEndpoint", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "tba", type: "address" },
      { name: "createdAt", type: "uint256" },
    ],
  },
] as const;

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
  { name: "providerStake", type: "uint256" },
  { name: "slaTimeoutSec", type: "uint256" },
  { name: "slashBps", type: "uint256" },
  { name: "lockedStake", type: "uint256" },
  { name: "maxInputBytes", type: "uint32" },
  { name: "maxOutputBytes", type: "uint32" },
] as const;

export const SkillRegistryAbi = [
  {
    type: "function", name: "listActiveSkills", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "tuple[]", components: SKILL_TUPLE_COMPONENTS }],
  },
  {
    type: "function", name: "getSkill", stateMutability: "view",
    inputs: [{ name: "skillId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: SKILL_TUPLE_COMPONENTS }],
  },
  {
    type: "function", name: "skillCount", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "callCount", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "getCall", stateMutability: "view",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [
      {
        name: "", type: "tuple",
        components: [
          { name: "callId", type: "uint256" },
          { name: "skillId", type: "uint256" },
          { name: "caller", type: "address" },
          { name: "callerTBA", type: "address" },
          { name: "amountEscrowed", type: "uint256" },
          { name: "paymentHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "startedAt", type: "uint256" },
          { name: "slashed", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function", name: "claimTimeoutAndSlash", stateMutability: "nonpayable",
    inputs: [{ name: "callId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "callerRateSkill", stateMutability: "nonpayable",
    inputs: [{ name: "callId", type: "uint256" }, { name: "rating", type: "uint8" }, { name: "comment", type: "string" }],
    outputs: [{ name: "attestationUid", type: "bytes32" }],
  },
] as const;

export const PneumaAttestationAbi = [
  {
    type: "function", name: "getAttestationsByRecipient", stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [
      {
        name: "", type: "tuple[]",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "skillId", type: "uint256" },
          { name: "callId", type: "uint256" },
          { name: "paymentHash", type: "bytes32" },
          { name: "rating", type: "uint8" },
          { name: "paidAmount", type: "uint256" },
          { name: "skillName", type: "string" },
          { name: "skillCategory", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "revoked", type: "bool" },
          { name: "raterRole", type: "uint8" },
        ],
      },
    ],
  },
] as const;
