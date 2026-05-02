/**
 * 共享 query 示例 —— /discover SearchBox 和 /run Smart 模式都用
 *
 * 这些 query 是**预先验证过 LLM planner 真能命中**的（命中链上注册的 5 个
 * Claude skill #8-12 + 旧 7 skill）。点了直接填入文本框，让评委不必猜
 * skill 关键字 LLM 能不能识别。
 *
 * 维护规则：
 *   - 每个 query 必须真跑过 /api/orchestrate planOnly，确认 plan.steps.length > 0
 *   - 多 skill 拆解 query 优先（demo 价值高）
 *   - **必须 inline skill 需要的输入**（否则 planner LLM 会编造 fake input，
 *     handler 严校验会 throw 或者烧钱跑垃圾 diff/tx）：
 *       · Code Review 要 `diff: string` —— 把 ```diff ... ``` 块直接写进 query
 *       · Block Explainer 要 `rawTx: object` —— 太重，避免在首页 example 用
 *       · Paper Summary 要 `title + abstract` —— 学 「📄 论文摘要」用 `title=...`
 *   - 关键字尽量贴近真实使用场景，但**别用 LLM 不识别的术语**
 *     例：「审计合约」→ LLM 不识别（Code Review desc 是 git diff）
 *         「评审这段 Solidity diff」→ LLM 命中 Code Review ✓
 *
 * Phase 2（待补）：planner 加 URL/txHash 嗅探层（GitHub raw fetch +
 * `eth_getTransactionReceipt`），example 就能用「评审 PR #42」这种链接形态。
 */

export interface QueryExample {
  /** 按钮上显示的短标签 */
  label: string;
  /** 真填进 textarea 的完整 query */
  query: string;
  /** 鼠标 hover 显示，告诉用户会拆几步 + 命中哪些 skill */
  hint: string;
}

export const QUERY_EXAMPLES: QueryExample[] = [
  {
    label: "🔍 合约 diff + 风险",
    query: `评审这段 Solidity diff，并用一句话总结主要风险：

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
    hint: "2 步并行 → Code Review（inline diff） + Quick Reasoning（一句话风险）",
  },
  {
    label: "📄 论文摘要",
    query:
      "总结这篇论文 abstract：title=Attention Is All You Need, abstract=The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
    hint: "1 步 → Paper Summary（中英双语 TL;DR + 3 contributions）",
  },
  {
    label: "🤔 概念解释",
    query: "什么是 ERC-6551，跟 ERC-721 的关系是什么？用 100 字以内回答",
    hint: "1 步 → Quick Reasoning（Claude 直接答 + 自评 confidence）",
  },
  {
    label: "✍ 推广文案",
    query:
      "给我写一条 280 字的 Twitter thread，推广「Pneuma 协议」—— AI Agent 的钱包+声誉+法庭基础设施",
    hint: "1 步 → Creative Write（primary + 2 alternative 备选）",
  },
];
