import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // 让 Pneuma workspace 的 packages 在 dev/build 时被 transpile（避免 ESM 边界问题）
  transpilePackages: ["@pneuma/x402", "@pneuma/orchestrator", "@pneuma/reputation-formula"],
  // env 变量从根 .env.local 注入，前缀 NEXT_PUBLIC_* 自动暴露给浏览器
  // 服务器端读取的私钥等不会泄露
  webpack: (webpackConfig) => {
    // orchestrator/x402 用 NodeNext，import 写 ".js" 后缀（即使源文件是 .ts）
    // webpack 默认不会把 .js 解析到 .ts，extensionAlias 让它能 fallback
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    webpackConfig.resolve.extensionAlias = {
      ...(webpackConfig.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
  /**
   * Agent onboarding manifests —— 让 AI agents 用规范路径直接读
   *
   *   /skill.md             → Anthropic Agent Skills 格式
   *   /.well-known/agent.json → A2A 协议发现端点（RFC 8615）
   *
   * 实际 handler 在 /api 下，避免 App Router 对带点的目录名 / .well-known 的 edge cases
   */
  async rewrites() {
    return [
      { source: "/skill.md", destination: "/api/skill-md" },
      {
        source: "/.well-known/agent.json",
        destination: "/api/well-known/agent-json",
      },
    ];
  },
};

export default config;
