/**
 * Skills barrel —— 集中注册所有 skill 的 definition + handler
 *
 * server.ts 通过环境变量 SKILL_ID 在这个 map 里查找当前进程要 host 的 skill；
 * register-all.ts 遍历这个 map 把 5 个 skill 一次性注册到 SkillRegistry；
 * seed-traffic.ts 遍历这个 map 跑测试调用。
 *
 * 加新 skill 时：
 *   1. 在 ./skills/<your-skill>.ts 里 export `definition` + `handler`
 *   2. 在下面 import 进来 + 加到 ALL_SKILLS map
 *   3. .env.example 加一对 SKILL_ID_<UPPER> + PORT_<UPPER>
 *
 * 不需要改 server.ts。
 */

import * as paperSummary from "./paper-summary.js";
import * as codeReview from "./code-review.js";
import * as blockExplainer from "./block-explainer.js";
import * as creativeWrite from "./creative-write.js";
import * as quickReasoning from "./quick-reasoning.js";

import type { SkillDefinition, SkillHandler, SkillId } from "./types.js";

interface SkillModule {
  definition: SkillDefinition;
  handler: SkillHandler;
}

export const ALL_SKILLS: Record<SkillId, SkillModule> = {
  "paper-summary": paperSummary,
  "code-review": codeReview,
  "block-explainer": blockExplainer,
  "creative-write": creativeWrite,
  "quick-reasoning": quickReasoning,
};
