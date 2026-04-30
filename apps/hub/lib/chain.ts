/**
 * Arc Testnet 自定义 chain 配置（wagmi v2 / viem 兼容）
 * 同时声明 Base Sepolia 作为可选副链
 */

import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_CHAIN_RPC ?? "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

/** 主链 chain id 常量（前端 useChainId 守卫 + 错链 UI 引导用） */
export const CHAIN_ID = arcTestnet.id;
