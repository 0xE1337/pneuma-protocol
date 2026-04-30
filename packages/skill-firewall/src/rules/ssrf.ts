/**
 * ssrf rule
 *
 * 拦截"试图让 provider 当跳板访问内网 / 元数据 endpoint"的 URL。
 *
 * 适用场景：
 *   - Provider 把用户 input 当 URL 调 fetch / image-load / webhook
 *   - 用户传 https://169.254.169.254/latest/meta-data/ 让 provider 暴露 AWS / GCP / Azure 凭据
 *   - 用户传 file:///etc/passwd 让 provider 读本地文件
 *
 * 检测策略：
 *   - 提取 input 里所有 URL-like 字符串
 *   - 对每个 URL：
 *     - 协议必须是 http/https（拦 file/gopher/dict/ldap/jar）
 *     - hostname 必须不是 私网 IP / 元数据 endpoint / localhost
 *     - 不允许 0.0.0.0 / [::] / unicode-tricks
 *
 * **重要约束**：
 *   - 不能挡 DNS rebinding（hostname 解析时刻变 IP）
 *   - 真正安全要在 fetch 时 resolve hostname → 拒绝私网 IP
 *   - 这个 rule 是"廉价的第一层"
 */

import type { FirewallInput, FirewallRule, FirewallVerdict } from "../types.js";

/** 私网 / 链路本地 / 元数据 endpoint 的 IP 段（IPv4） */
const BLOCKED_IPV4_PREFIXES = [
  "10.",            // RFC1918 私网 A
  "127.",           // loopback
  "169.254.",       // 链路本地（含 AWS/GCP metadata 169.254.169.254）
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.", // RFC1918 私网 B
  "192.168.",       // RFC1918 私网 C
  "0.",             // 0.0.0.0/8
  "100.64.",        // CGNAT
];

/** 危险 hostname 关键字（不解析 DNS，只看字面） */
const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",   // GCP metadata
  "metadata",                    // 通配 metadata*
  "kubernetes.default",          // k8s API
  "host.docker.internal",        // Docker host
];

/** 允许的协议白名单 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** 提取 string 里所有 URL-like token */
function extractUrls(text: string): string[] {
  // 简单 regex —— 抓 schema://... 或 //... 形式
  const matches = text.match(/\b(?:[a-z][a-z0-9+\-.]{1,30}:\/\/|\/\/)[^\s"'`<>]{3,}/gi);
  return matches ?? [];
}

/** 检查 URL 是否危险，返回 reason 或 null */
function checkUrl(raw: string): string | null {
  let url: URL;
  try {
    // 处理 // 开头的 protocol-relative URL
    url = new URL(raw.startsWith("//") ? `http:${raw}` : raw);
  } catch {
    return null; // 不是合法 URL，跳过（不当 URL 处理）
  }

  // 1. 协议白名单
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return `disallowed protocol: ${url.protocol}`;
  }

  const hostname = url.hostname.toLowerCase();

  // 2. hostname 黑名单（精确 + 前缀）
  for (const blocked of BLOCKED_HOSTNAMES) {
    if (hostname === blocked || hostname.startsWith(`${blocked}.`)) {
      return `blocked hostname: ${hostname}`;
    }
  }

  // 3. IPv4 私网检查
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    for (const prefix of BLOCKED_IPV4_PREFIXES) {
      if (hostname.startsWith(prefix)) {
        return `private/loopback IPv4: ${hostname}`;
      }
    }
  }

  // 4. IPv6 loopback / link-local / 未指定
  if (hostname.startsWith("[")) {
    const v6 = hostname.slice(1, -1).toLowerCase();
    if (v6 === "::1" || v6 === "::" || v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd")) {
      return `private/loopback IPv6: ${v6}`;
    }
  }

  // 5. 0.0.0.0 / 未指定地址（可能被 DNS rebinding 利用）
  if (hostname === "0.0.0.0" || hostname === "[::]") {
    return `unspecified address: ${hostname}`;
  }

  return null;
}

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

export const ssrfRule: FirewallRule = {
  id: "ssrf",
  description: "拦截 SSRF：私网 IP / 云元数据 endpoint / localhost / 非 HTTP(S) 协议",
  inspect(input: FirewallInput): FirewallVerdict {
    const strings: string[] = [];
    collectStrings(input.body, strings);

    for (const s of strings) {
      for (const url of extractUrls(s)) {
        const reason = checkUrl(url);
        if (reason !== null) {
          return {
            action: "block",
            rule: "ssrf",
            evidence: url.slice(0, 100),
            reason: `SSRF risk: ${reason}`,
          };
        }
      }
    }
    return { action: "allow" };
  },
};
