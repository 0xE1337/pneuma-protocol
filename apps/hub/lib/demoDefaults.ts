/**
 * 演示默认文案 — 集中管理 demo 路径上每个输入框的初始值
 *
 * 顶层设计：把"演示输入"当一类基础设施抓手 —— 每次重录视频 / 现场跑流程都
 * 自动有可执行内容，避免现场打字 + 思考"该填什么"。
 *
 * 维护规则：
 *   - 不写敏感字段（私钥 / 真实地址 / 真实金额）
 *   - text 类型默认值要跟 lib/queryExamples.ts 的预验证池语义一致
 *   - 字段命名跟实际页面 useState 一一对应，方便 grep 跳转
 */

interface DemoDefaults {
  mint: { agentName: string; metadataURI: string };
  runManualByCategory: Record<string, string>;
  runSmartInitial: string;
  rateComment: string;
  court: { callId: string; reason: string };
  endorse: { stake: string; context: string };
}

export const DEMO_DEFAULTS: DemoDefaults = {
  // /mint —— Soul NFT 创建
  mint: {
    agentName: "小陈 · 翻译大师",
    metadataURI: "ipfs://demo",
  },

  // /run manual 模式 —— 按 selectedSkill.category 切换默认 query
  runManualByCategory: {
    finance: "ETH",
    text: "AI agents need verifiable on-chain reputation. Please translate this to professional Chinese for a fintech audience.",
    default:
      "Write a 100-word product blurb for an AI translation agent that earns USDC while its operator sleeps.",
  },

  // /run smart 模式 —— 无 ?query= 参数时的兜底（命中 Code Review + Quick Reasoning）
  runSmartInitial: `评审这段 Solidity diff，并用一句话总结主要风险：

language=solidity
\`\`\`diff
@@ -42,7 +42,7 @@ contract FeeVault {
-        uint256 fee = amount / 10000 * feeBps;
+        uint256 fee = amount * feeBps / 10000;
         require(token.transfer(treasury, fee), "fee transfer failed");
-        balances[msg.sender] -= amount;
+        balances[msg.sender] = balances[msg.sender] - amount;
         token.transfer(msg.sender, amount - fee);
\`\`\``,

  // /run 反向评分（CallerRatePanel）
  rateComment:
    "Excellent translation — terminology spot-on, fast turnaround. Will reuse this skill.",

  // /court/new —— 起诉表单
  court: {
    callId: "112",
    reason:
      "Translation output deviated from claimed bilingual quality. Requesting partial slash + refund.",
  },

  // /profile 担保（Endorse）面板
  endorse: {
    stake: "5",
    context:
      "Verified this Soul's translation history on /profile — staking 5 USDC on continued quality.",
  },
};

/**
 * 按 skill category 获取 /run manual 模式的默认 query。
 * Fallback 链：specific category → default。
 */
export function getDemoQueryForSkill(category: string): string {
  return (
    DEMO_DEFAULTS.runManualByCategory[category] ??
    DEMO_DEFAULTS.runManualByCategory.default
  );
}
