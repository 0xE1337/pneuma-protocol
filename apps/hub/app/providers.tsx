"use client";

/**
 * Providers shim —— dynamic({ ssr: false }) 加载真正的 ProvidersClient
 *
 * 见 providers-client.tsx 顶部注释解释为什么 wagmi/RainbowKit 必须 client-only。
 */

import dynamic from "next/dynamic";

const ProvidersClient = dynamic(() => import("./providers-client"), {
  ssr: false,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return <ProvidersClient>{children}</ProvidersClient>;
}
