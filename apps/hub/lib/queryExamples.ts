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
 *   - 关键字尽量贴近真实使用场景，但**别用 LLM 不识别的术语**
 *     例：「审计合约」→ LLM 不识别（Code Review desc 是 git diff）
 *         「评审这段 Solidity diff」→ LLM 命中 Code Review ✓
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
    label: "🔍 合约 + 交易 + 风险",
    query:
      "评审这段 Solidity diff + 解释这笔交易在干什么 + 用一句话总结风险",
    hint: "3 步并行 → Code Review + Block Explainer + Quick Reasoning",
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
