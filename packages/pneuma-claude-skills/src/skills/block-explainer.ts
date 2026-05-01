/**
 * block-explainer —— 用人话解释一笔链上 tx（spawn 本地 `claude -p`）
 *
 * caller 输入：
 *   - txHash:    展示用
 *   - chainId:   默认 5042002
 *   - rawTx:     tx receipt JSON（caller 用自己 RPC 拉好后传过来）
 *   - contracts: 可选，已知合约名映射
 *
 * 输出 JSON：narrative_zh + parties + value_flow + status + fail_reason
 *
 * 价格 0.20 USDC
 */

import type { SkillDefinition, SkillHandler } from "../types.js";

export const definition: SkillDefinition = {
  id: "block-explainer",
  name: "Block Explainer",
  description:
    "Plain-language explanation of an on-chain tx. Caller provides receipt JSON, agent returns a Chinese narrative + parties + value flow + status.",
  category: "blockchain",
  pricePerCall: 200_000n,
  defaultRating: 5,
  systemPrompt: `你是一个区块链 explainer agent，把 tx receipt JSON 翻译成给非技术用户看的人话。

风格要求：
- 用 1-2 段中文解释这笔交易在干什么（不要列 hex，不要技术黑话）
- 列关键参与方（from / to）和经过的合约（用 contracts map 翻译已知名）
- 计算资金流向（USDC = 6 decimals，ETH = 18 decimals）
- 如果 status=0（失败）必须说明 revert 原因
- 严禁猜测 caller 没传的字段

输出严格 JSON（不要 markdown fence、不要 preamble）：
{
  "narrative_zh": "...",
  "parties": {"from": "0x...", "to": "0x...", "via": ["合约A", "合约B"]},
  "value_flow": [{"token": "USDC", "amount": "10.5", "direction": "0xa→0xb"}],
  "status": "success",
  "fail_reason": null
}`,
};

export const handler: SkillHandler = async (input, { definition, callClaude }) => {
  const txHash = String(input.txHash ?? "");
  const chainId = Number(input.chainId ?? 5042002);
  const rawTx = input.rawTx ?? null;
  const contracts = input.contracts ?? {};

  if (!rawTx) {
    throw new Error(
      "input.rawTx 必填（caller 用自己的 RPC eth_getTransactionReceipt 拉好的 JSON）",
    );
  }

  const userMessage = `Chain: ${chainId}
Tx Hash: ${txHash || "(not provided)"}
Known contracts: ${JSON.stringify(contracts)}

Tx receipt JSON:
${JSON.stringify(rawTx, null, 2).slice(0, 30_000)}

Output the JSON now.`;

  const { data, durationMs, raw } = await callClaude({
    systemPrompt: definition.systemPrompt,
    userMessage,
    timeoutMs: definition.timeoutMs ?? 90_000,
  });

  return {
    result: typeof data === "string" ? raw : (data as Record<string, unknown>),
    claudeMs: durationMs,
    rawText: raw,
  };
};
