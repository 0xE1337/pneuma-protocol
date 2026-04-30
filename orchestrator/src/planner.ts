/**
 * Planner —— 用 LLM 把用户的一句话查询拆解为 skill 调用计划
 */

import { chat } from "./llm.js";
import type { DiscoveredSkill, RankedSkill } from "./discovery.js";

export interface PlanStep {
  skillId: number;
  reason: string;
  body: Record<string, unknown>;
}

export interface Plan {
  steps: PlanStep[];
  reasoning: string;
}

const SYSTEM_PROMPT = `你是 Pneuma 的任务编排器（Orchestrator）。
你的任务：把用户的请求拆解为对一组 AI 技能（skill）的调用计划。

输入：
- 用户请求（一句话）
- 可用 skill 列表（每个 skill 有 id / name / description / endpoint / category / 价格 / 声誉 / 最近真实用户评论）

输出：严格 JSON 格式：
{
  "reasoning": "为什么这样拆解的简短说明（1-2 句中文）",
  "steps": [
    { "skillId": <number>, "reason": "<为什么调这个>", "body": { ...skill 的输入参数... } }
  ]
}

规则：
- 只调用必要的 skill，不要为了花钱乱调
- body 必须符合 skill 的预期输入，不要乱填字段
- 同类 skill 选一个就够，不要重复
- 同类 skill 多个候选时按以下优先级综合判断：
  · 优先看 recentComments — 真付费用户的文字反馈是最高信息密度信号（caller 角色 > provider 角色）
    · 若评论描述了"经常超时 / 输出格式不对 / 漏字段"等具体问题，且这些问题影响当前任务 → 跳过该 skill
    · 若评论一致夸"输出准确 / 响应快 / 字段齐全" → 加分
    · 评论里描述的问题如果跟当前任务无关（如评论说"中文支持差"但当前用英文）→ 不影响选择
  · 评论缺失或信息量低时，回退看 reputation.score（链上历史评价好的优先）
  · 同分时选 avgRatingByCaller（付费方评分）更高的
  · isColdStart=true 的新 skill 仅在没有成熟候选时才用
- 在 reason 字段里**简短引用** comment 决策依据（如"caller 反馈说响应快"），让用户能审计你的判断
- 如果用户请求不需要任何 skill，steps 返回空数组`;

/**
 * Plan 入口
 *
 * @param skills  可以是 DiscoveredSkill[]（旧路径，无声誉信息）
 *                或 RankedSkill[]（新路径，带声誉数据）
 *                两种都接，运行时检测
 */
export async function plan(
  userQuery: string,
  skills: DiscoveredSkill[] | RankedSkill[],
): Promise<Plan> {
  const skillCatalog = skills.map((s) => {
    const rep = "reputation" in s ? s.reputation : null;
    return {
      id: s.skillId,
      name: s.name,
      description: s.description,
      category: s.category,
      pricePerCallUsdc: (Number(s.pricePerCallUsdc) / 1e6).toString(),
      endpoint: s.endpoint,
      inputHint: hintForSkill(s),
      // 声誉摘要（无数据时整段省略，LLM 不会被空字段误导）
      ...(rep
        ? {
            reputation: {
              score: Number(rep.score.toFixed(2)),
              validCount: rep.validCount,
              avgRatingByCaller: Number(rep.avgRatingByCaller.toFixed(2)),
              isColdStart: rep.isColdStart,
            },
            // v3: 真用户最近评论 — 决策的高信息密度信号
            // 只在有非空评论时才喂给 LLM，避免污染 prompt
            ...(rep.recentComments.length > 0
              ? {
                  recentComments: rep.recentComments.map((c) => ({
                    rating: c.rating,
                    text: c.comment,
                    by: c.raterRole === 1 ? "caller" : c.raterRole === 0 ? "provider" : "juror",
                    daysAgo: Math.max(
                      0,
                      Math.floor((Date.now() / 1000 - Number(c.timestamp)) / 86400),
                    ),
                  })),
                }
              : {}),
          }
        : {}),
    };
  });

  const userMsg = `用户请求：${userQuery}

可用 skill 列表（JSON）：
${JSON.stringify(skillCatalog, null, 2)}

请返回拆解计划（严格 JSON）。`;

  const raw = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    { jsonMode: true, temperature: 0.1 },
  );

  try {
    const parsed = JSON.parse(raw) as Plan;
    if (!Array.isArray(parsed.steps)) {
      throw new Error("steps is not array");
    }
    return parsed;
  } catch (err) {
    throw new Error(`planner returned invalid JSON: ${(err as Error).message}\n--- raw ---\n${raw}`);
  }
}

/**
 * 给 LLM 提示每个 skill 的预期 body 字段（避免 LLM 乱填）
 */
function hintForSkill(s: DiscoveredSkill): string {
  if (s.category === "finance") {
    return '{ "symbol": "ETH" | "BTC" | "USDC" | "USDT" | "ARC" | "SOL" | "PNEUMA" }';
  }
  if (s.category === "text") {
    return '{ "text": string, "lang"?: "zh" | "en" }';
  }
  return "{}";
}
