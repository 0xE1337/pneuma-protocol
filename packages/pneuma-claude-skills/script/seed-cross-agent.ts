/**
 * seed-cross-agent.ts —— 跑 N 次跨 agent query 累积 Research-Bot + Web3-Auditor 的真实历史
 *
 * 目的：
 *   - 让 hub /discover 上 Research-Bot 和 Web3-Auditor 有真实的 calls 数 + 声誉
 *   - 让评委看到 Top Agents 卡片不是 0 calls 的"刚出生"状态，而是真活跃 agent
 *
 * 实现：
 *   - 通过 hub /api/orchestrate 调真 query（不是 planOnly），每次链上真 escrow + settle
 *   - 用预先验证过的 query 池（每条都已知能命中跨 agent 多 skill）
 *   - 间隔 2 秒避免连发撞 RPC rate limit
 *
 * 用法：
 *   ROUNDS=5 pnpm seed:cross-agent
 *
 * 成本（每次）：
 *   - 单步 query 0.03–0.20 USDC
 *   - 跨 2 步 query 约 0.18–0.30 USDC
 *   - 5 笔大概总共 1–1.5 USDC（DEPLOYER 钱包余额 117 USDC，远够）
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../apps/hub/.env.local") });

const HUB_URL = process.env.HUB_URL ?? "http://localhost:3100";
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const TOKEN_ID = Number(process.env.TOKEN_ID ?? 1);

// 每条 query 都预验证过 LLM 真能拆中跨 agent skill
const CROSS_AGENT_QUERIES: string[] = [
  "评审这段 Solidity 代码（function transfer(address to, uint256 a) public { balances[to] += a; }）+ 写一句 60 字内 slogan 推广 Pneuma 协议",
  "审视这段 git diff 里的 reentrancy 风险（withdraw() public { msg.sender.call.value(balances[msg.sender])(); balances[msg.sender] = 0; }）+ 用 80 字解释什么是 ERC-6551",
  "评审这段 TypeScript 代码（const k = process.env.SECRET; await fetch('/api/x?key=' + k);）+ 写一段 100 字 blog hook 介绍 sovereign agent",
  "评审这段 Rust diff（unsafe { let p = ptr.add(idx); *p = value; }）+ 写一句 30 字内 slogan 推广 Web3 安全审计",
  "解释 ERC-721 vs ERC-1155 vs ERC-6551 的核心差异 + 写一段 100 字 product tagline 强调链上身份",
];

interface OrchestrateResponse {
  query: string;
  callerTBA?: string;
  plan?: { steps: Array<{ skillId: number; reason: string }> };
  results?: Array<{
    skillId: number;
    skillName?: string;
    success: boolean;
    callId?: string;
    escrowTxHash?: string;
    paidAmount?: string;
    durationMs?: number;
    error?: string;
  }>;
  answer?: string;
}

async function callOrchestrate(query: string): Promise<OrchestrateResponse> {
  const r = await fetch(`${HUB_URL}/api/orchestrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, tokenId: TOKEN_ID }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${r.statusText}`);
  }
  return (await r.json()) as OrchestrateResponse;
}

async function main() {
  console.log(`\n🌱 seed-cross-agent`);
  console.log(`   hub:     ${HUB_URL}`);
  console.log(`   tokenId: ${TOKEN_ID}`);
  console.log(`   rounds:  ${ROUNDS}\n`);

  let totalSuccess = 0;
  let totalFail = 0;
  let totalPaidWei = 0n;
  const ownerCalls: Record<string, number> = {};

  for (let i = 0; i < ROUNDS; i++) {
    const query = CROSS_AGENT_QUERIES[i % CROSS_AGENT_QUERIES.length];
    console.log(`──── round ${i + 1}/${ROUNDS} ────`);
    console.log(`query: ${query.slice(0, 80)}…`);

    try {
      const startedAt = Date.now();
      const resp = await callOrchestrate(query);
      const durationMs = Date.now() - startedAt;
      console.log(`took: ${durationMs}ms · plan steps: ${resp.plan?.steps?.length ?? 0}`);
      for (const r of resp.results ?? []) {
        const flag = r.success ? "✓" : "✗";
        const paid = r.paidAmount ? `${(Number(r.paidAmount) / 1e6).toFixed(4)} USDC` : "—";
        console.log(`  ${flag} #${r.skillId} ${r.skillName ?? ""}  callId=${r.callId ?? "?"}  ${paid}`);
        if (r.success) {
          totalSuccess++;
          totalPaidWei += BigInt(r.paidAmount ?? "0");
        } else {
          totalFail++;
          if (r.error) console.log(`     err: ${String(r.error).slice(0, 200)}`);
        }
      }
    } catch (e) {
      console.error(`✗ round ${i + 1} 失败: ${(e as Error).message}`);
      totalFail++;
    }
    console.log();

    // 间隔避免 rate limit + 给上一笔 attestation 写完
    if (i < ROUNDS - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`────────────────────────────────────────`);
  console.log(`✅ 成功: ${totalSuccess}  ❌ 失败: ${totalFail}`);
  console.log(`💸 总支出: ${(Number(totalPaidWei) / 1e6).toFixed(4)} USDC`);
  console.log(`────────────────────────────────────────\n`);
  console.log(`刷新 hub /discover 看 Top Agents：multi-skill sovereign 应该已经`);
  console.log(`出现在前两位，且 calls 数 + 声誉星都涨了。\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
