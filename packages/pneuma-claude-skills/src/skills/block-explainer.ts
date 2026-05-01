/**
 * block-explainer —— 用人话解释一笔链上 tx
 *
 * caller 输入：
 *   - txHash:    tx hash（可选，仅作展示）
 *   - chainId:   链 ID（默认 5042002 Arc Testnet；影响合约名查询）
 *   - rawTx:     tx receipt JSON（caller 用自己的 RPC 拉好后传过来）
 *   - contracts: 可选，已知合约名映射 { "0xabc": "USDC" }
 *
 * 输出：
 *   - 中文一段话解释这笔交易在干什么
 *   - 关键参与方（from / to / 经过的合约）
 *   - 资金流向（多少 USDC / ETH 转给谁）
 *   - 是否成功 / 如果失败，revert 原因
 *
 * 价格 0.20 USDC
 *
 * 设计：caller 端用自己的 RPC tool 拉 tx + receipt，把 JSON 喂过来；
 * provider 不依赖 RPC（保持 sovereign agent 的"我只 reasoning"职责）。
 */

import type { SkillDefinition, SkillHandler } from "../types.js";

export const definition: SkillDefinition = {
  id: "block-explainer",
  name: "Block Explainer",
  description:
    "Plain-language explanation of an on-chain tx. Caller provides receipt JSON, agent returns a Chinese narrative + parties + value flow + status.",
  category: "blockchain",
  pricePerCall: 200_000n, // 0.20 USDC
  defaultRating: 5,
  needsWebFetch: false,
  systemPrompt: `你是一个区块链 explainer agent，把 tx receipt JSON 翻译成给非技术用户看的人话。

风格要求：
- 用 1-2 段中文解释这笔交易在干什么（不要列 hex，不要技术黑话）
- 列关键参与方（from / to）和经过的合约（用 contracts map 翻译已知名）
- 计算资金流向（USDC = 6 decimals，ETH = 18 decimals）
- 如果 status=0（失败）必须说明 revert 原因（从 revertReason 字段或 logs 推断）
- 严禁猜测 caller 没传的字段；看不到就标 "未在 receipt 中"

输出严格 JSON：
{
  "narrative_zh": "...",
  "parties": {"from": "0x...", "to": "0x...", "via": ["合约A", "合约B"]},
  "value_flow": [{"token": "USDC", "amount": "10.5", "direction": "0xa→0xb"}],
  "status": "success" | "failed",
  "fail_reason": "..." | null
}`,
};

export const handler: SkillHandler = async (input, { client, definition }) => {
  const txHash = String(input.txHash ?? "");
  const chainId = Number(input.chainId ?? 5042002);
  const rawTx = input.rawTx ?? null;
  const contracts = input.contracts ?? {};

  if (!rawTx) {
    throw new Error(
      "input.rawTx 必填（caller 用自己的 RPC eth_getTransactionReceipt 拉好的 JSON）",
    );
  }

  const startedAt = Date.now();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: definition.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Chain: ${chainId}
Tx Hash: ${txHash || "(not provided)"}
Known contracts: ${JSON.stringify(contracts)}

Tx receipt JSON:
${JSON.stringify(rawTx, null, 2).slice(0, 30_000)}

请解释，返回 JSON。`,
      },
    ],
  });
  const claudeMs = Date.now() - startedAt;

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  let result: string | Record<string, unknown> = text;
  try {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      result = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    /* keep raw */
  }

  return {
    result,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    claudeMs,
  };
};
