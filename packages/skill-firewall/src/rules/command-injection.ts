/**
 * command-injection rule
 *
 * 拦截"试图让 provider 端 shell / eval / 文件系统执行用户输入"的 payload。
 *
 * 适用场景：
 *   - Provider 用 LLM 生成代码或命令，再扔给 shell 执行
 *   - Provider 把用户字符串拼进 SQL / 文件路径 / shell command
 *   - Provider 把 LLM output 喂给 eval()
 *
 * **重要约束**：这只挡明显恶意 pattern，不能替代 provider 自己的输入消毒。
 *   - 真正安全要靠：参数化 SQL / shell quoting / path normalize / 沙箱 exec
 *   - 这个 rule 是"廉价的第一层"：能挡掉脚本娃娃，挡不住高级攻击
 */

import type { FirewallInput, FirewallRule, FirewallVerdict } from "../types.js";

const PATTERNS: { id: string; pattern: RegExp; description: string }[] = [
  {
    id: "destructive-shell",
    pattern: /\b(?:rm|del|rmdir)\s+(?:-[rfRF]+\s+)?(?:\/|~|\.|\*|--no-preserve-root)/i,
    description: "破坏性 shell 命令（rm -rf / / del *）",
  },
  {
    id: "shell-exec",
    pattern: /\b(?:bash|sh|zsh|fish|cmd|powershell|pwsh)\s+(?:-c|-Command)\s+/i,
    description: "shell -c 命令执行",
  },
  {
    id: "process-substitution",
    pattern: /\$\((?:curl|wget|fetch|nc|netcat|bash|sh)\b/i,
    description: "shell process substitution（$(curl ...) 等）",
  },
  {
    id: "backtick-exec",
    pattern: /`(?:curl|wget|fetch|nc|netcat|bash|sh|cat\s+\/etc)/i,
    description: "backtick command substitution",
  },
  {
    id: "code-eval",
    pattern: /\b(?:eval|exec|Function|setTimeout|setInterval)\s*\(\s*["'`]/i,
    description: "JS/TS eval / exec / Function constructor 调用",
  },
  {
    id: "py-dangerous",
    pattern: /\b(?:os\.system|subprocess\.(?:call|run|Popen)|__import__\s*\(\s*["']os|exec\s*\(|eval\s*\()/i,
    description: "Python 危险调用（os.system / subprocess / exec / eval）",
  },
  {
    id: "path-traversal",
    pattern: /(?:\.\.[\\/]){3,}|(?:\.\.[\\/])(?:etc|root|var|usr|sys|proc|home)\b/i,
    description: "path traversal（../../../etc 等）",
  },
  {
    id: "sensitive-file-read",
    pattern: /(?:cat|less|more|head|tail|type)\s+\/(?:etc\/passwd|etc\/shadow|root\/\.ssh|var\/log)/i,
    description: "试图读取系统敏感文件",
  },
  {
    id: "sql-meta",
    pattern: /(?:'|")\s*(?:OR|AND)\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?\s*(?:--|#|;)/i,
    description: "经典 SQL 注入 pattern（' OR 1=1--）",
  },
  {
    id: "fork-bomb",
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    description: "Bash fork bomb",
  },
];

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return;
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

export const commandInjectionRule: FirewallRule = {
  id: "command-injection",
  description: "拦截 shell / eval / 文件系统 命令注入 pattern",
  inspect(input: FirewallInput): FirewallVerdict {
    const strings: string[] = [];
    collectStrings(input.body, strings);

    for (const s of strings) {
      for (const { id, pattern, description } of PATTERNS) {
        const m = s.match(pattern);
        if (m) {
          return {
            action: "block",
            rule: `command-injection:${id}`,
            evidence: m[0].slice(0, 80),
            reason: `Detected ${description}`,
          };
        }
      }
    }
    return { action: "allow" };
  },
};
