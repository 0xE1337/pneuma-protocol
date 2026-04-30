import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "viem";
import { arcTestnet } from "./chain";

export const wagmiConfig = getDefaultConfig({
  appName: "AgentVault Viewer",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "agentvault-viewer-demo",
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http(arcTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});
