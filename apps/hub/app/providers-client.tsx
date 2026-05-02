"use client";

/**
 * Client-only providers tree —— 隔离 wagmi/RainbowKit/WalletConnect
 *
 * 单独抽出来给 providers.tsx 通过 next/dynamic({ ssr: false }) 加载。
 *
 * 为什么必须 client-only：
 *   RainbowKit 默认 wallet 集合包含 WalletConnect connector，
 *   WalletConnect 内部用 indexedDB 缓存 session，Node SSR 没有 indexedDB →
 *   每次 SSR 抛 ReferenceError unhandledRejection → wagmi config 进 broken state
 *   → 客户端 hydration 后 useReadContract / useWatchContractEvent 永远 pending
 *   （dashboard 转圈不出数据）。
 *
 *   修法：跳过 SSR 阶段，纯 client mount Providers tree。代价是首屏少 SSR
 *   出来的占位 React tree（非 SEO 关键页面，可接受）。
 */

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";

export default function ProvidersClient({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider>
      <I18nProvider>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: "oklch(75% 0.18 280)",
                accentColorForeground: "oklch(95% 0.005 270)",
                borderRadius: "small",
                fontStack: "system",
              })}
              modalSize="compact"
            >
              {children}
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
