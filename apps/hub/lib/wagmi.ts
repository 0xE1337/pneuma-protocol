/**
 * wagmi v2 + RainbowKit 配置 —— 主链 Arc Testnet
 */

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
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
});
