/**
 * prompt-injection rule
 *
 * 用 regex 集捕获**已知公开**的 prompt-injection 话术。
 * 不是 ML 检测器，所以会有遗漏 —— 这是 demo / hackathon 级别的第一道防线。
 * 生产环境建议叠加 Llama-Guard / Prompt-Guard 之类的分类器。
 *
 * 命中策略：
 *   - 任意一条 pattern 匹配 → block
 *   - 拼接所有可能的字符串 input（递归 walk body 找 string field）做匹配
 */

import type { FirewallInput, FirewallRule, FirewallVerdict } from "../types.js";

const PATTERNS: { id: string; pattern: RegExp; description: string }[] = [
  {
    id: "ignore-previous",
    pattern: /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|preceding)\s+(?:instructions?|prompts?|rules?|messages?)\b/i,
    description: "经典越狱：'ignore previous instructions'",
  },
  {
    id: "system-override",
    pattern: /(?:^|\n)\s*(?:###?|---)?\s*system\s*[:>]\s*(?:you\s+are|act\s+as|new\s+instructions)/i,
    description: "伪造 system 角色注入",
  },
  {
    id: "role-manipulation",
    pattern: /\b(?:from\s+now\s+on|starting\s+now|new\s+role)[\s,:]+you\s+(?:are|will\s+be|must\s+act\s+as)\b/i,
    description: "强制角色切换",
  },
  {
    id: "developer-mode",
    pattern: /\b(?:developer|admin|debug|jailbreak|DAN|do\s+anything\s+now)\s+mode\b/i,
    description: "开发者/越狱模式诱导",
  },
  {
    id: "leak-system-prompt",
    pattern: /\b(?:reveal|show|print|repeat|output)\s+(?:your\s+)?(?:system\s+prompt|initial\s+instructions|hidden\s+rules)/i,
    description: "诱导泄露 system prompt",
  },
  {
    id: "eval-via-llm",
    pattern: /\b(?:execute|eval(?:uate)?|run)\s+(?:this\s+)?(?:code|command|shell|bash|python)[\s:]+/i,
    description: "诱导 LLM 触发代码执行",
  },
  {
    id: "delimiter-escape",
    pattern: /(?:```\s*system|<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|\[INST\]|\[\/INST\])/i,
    description: "模型控制 token 注入（常见于 OpenAI / Llama / Mistral 模板）",
  },
];

/** Walk body 递归收集所有 string —— 防止 attacker 把 payload 藏在嵌套字段 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return; // 防爆栈 / 防超大 nested attack
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out, depth + 1);
    }
  }
}

export const promptInjectionRule: FirewallRule = {
  id: "prompt-injection",
  description: "检测常见 prompt injection / jailbreak 话术（regex 集，非 ML 检测）",
  inspect(input: FirewallInput): FirewallVerdict {
    const strings: string[] = [];
    collectStrings(input.body, strings);

    for (const s of strings) {
      for (const { id, pattern, description } of PATTERNS) {
        const m = s.match(pattern);
        if (m) {
          return {
            action: "block",
            rule: `prompt-injection:${id}`,
            evidence: m[0].slice(0, 80),
            reason: `Detected ${description}`,
          };
        }
      }
    }
    return { action: "allow" };
  },
};
