/**
 * wagmi v2 + RainbowKit 配置 —— 主链 Arc Testnet
 *
 * SSR storage 用 cookieStorage 绕开 indexedDB：Node SSR 没有 indexedDB，
 * RainbowKit/WalletConnect 默认 storage 在 SSR 阶段抛 ReferenceError，
 * 导致 unhandledRejection → wagmi config 进入 broken state →
 * 客户端 useReadContract / useWatchContractEvent 永远 pending（dashboard 显示
 * "Loading on-chain agents..." 转圈不出数据）。
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { cookieStorage, createStorage } from "wagmi";
import { http } from "viem";
import { arcTestnet } from "./chain";

export const wagmiConfig = getDefaultConfig({
  appName: "Pneuma",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "pneuma-hackathon-demo",
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(arcTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
