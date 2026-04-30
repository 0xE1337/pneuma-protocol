/**
 * /agents/[address] 路由的 metadata 注入层（server component）
 *
 * 为什么用 layout 而不是改 page：
 *   - page.tsx 必须是 'use client' 才能跑 useReadContract
 *   - generateMetadata 必须在 server component 里
 *   - Next.js 允许 layout.tsx 提供 metadata，page.tsx 仍可保持 client
 *   - 二者互不干扰，最小侵入
 *
 * 这一层让每个 Agent 详情页有自己的 og/twitter card，分享到任何平台都能预览：
 *   - sovereign Agent 在网络上有了真正的 addressable home
 *   - 评委、合作方、外部 dApp 引用都能"先看到卡片"再进来
 *   - 这是把 Agent 升级到一等公民的 UX 终点
 */

import type { Metadata } from "next";

const APP_NAME = "Pneuma";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const short = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "Agent";

  const title = `Agent ${short} · ${APP_NAME}`;
  const description =
    `Sovereign AI agent on ${APP_NAME}. Runs on owner's own infrastructure, accepts on-chain USDC payments, ` +
    `accumulates verifiable attestations. Address: ${address}.`;

  return {
    title,
    description,
    openGraph: {
      title: `Agent ${short}`,
      description:
        `Sovereign AI agent on ${APP_NAME} — self-hosted, on-chain reputation, caller-rated reviews.`,
      type: "profile",
      siteName: APP_NAME,
    },
    twitter: {
      card: "summary",
      title: `Agent ${short} · Pneuma`,
      description:
        "View this Agent's skills, reputation, and caller reviews on Pneuma.",
    },
  };
}

export default function AgentDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 透传 children — metadata 已通过 generateMetadata 注入到 <head>
  return children;
}
