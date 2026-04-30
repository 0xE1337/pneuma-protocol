/**
 * skill-firewall — core types
 *
 * 一个 Rule 接收 caller 的 input payload，决定是否放行。
 * 框架无关：Hono / Express adapter 只是把 req.body 包成 FirewallInput 喂给 rules。
 */

/** Provider 收到的请求载荷的标准化封装 */
export interface FirewallInput {
  /** 请求 body，已 JSON parse；非 JSON body 是 string 或 Buffer */
  readonly body: unknown;
  /** HTTP header（小写键），用于检测 SSRF / 异常 user-agent 等 */
  readonly headers: Readonly<Record<string, string>>;
  /** caller 链上 callId（来自 x402 middleware），用于把拦截事件归因到具体 call */
  readonly callId?: string;
  /** caller TBA 地址（来自 x402 middleware） */
  readonly callerTBA?: string;
  /** 字节长度（用于 size-limit 规则；adapter 在 stream 阶段算好传入） */
  readonly byteLength: number;
}

/** 规则裁定 */
export interface FirewallVerdict {
  /** allow / block；block 时 adapter 应直接返回错误响应不调 handler */
  readonly action: "allow" | "block";
  /** 命中的规则 id（block 时必填） */
  readonly rule?: string;
  /** 命中的具体片段（block 时建议填，方便 provider 调试） */
  readonly evidence?: string;
  /** 给 caller 的人类可读理由 */
  readonly reason?: string;
}

/** Rule 接口 —— provider 可自定义实现，注入 firewall config.rules */
export interface FirewallRule {
  /** 规则唯一 id，命中后写进 verdict.rule + 可选 attestation comment */
  readonly id: string;
  /** 规则人话描述（README / 错误消息用） */
  readonly description: string;
  /** 同步函数：返回 verdict。allow 必须返回 { action: "allow" }，block 必须 fill rule + reason */
  inspect(input: FirewallInput): FirewallVerdict;
}

/** 拦截后的可选 hook —— provider 用来记日志 / 写链上 attestation 警告 */
export interface OnBlockHook {
  (verdict: FirewallVerdict, input: FirewallInput): void | Promise<void>;
}

/** firewall 顶层配置 */
export interface FirewallConfig {
  /**
   * 启用的规则。可以是规则实例或规则 id（用 id 时从内置库加载）。
   * 内置 id：
   *   - "prompt-injection"   （regex 集，覆盖常见越狱话术）
   *   - "command-injection"  （shell metacharacters / eval keywords）
   *   - "ssrf"               （私网 IP / localhost / metadata endpoint 拦截）
   *   - "size-limit:N"       （byteLength > N 拒绝；N 单位字节，默认 8192）
   */
  rules: ReadonlyArray<FirewallRule | string>;
  /**
   * 拦截后调用，可在这里写链上 attestation 警告。
   * 注意：onBlock 失败不会改变拦截结果（adapter 已经 block 完了）。
   */
  onBlock?: OnBlockHook;
  /**
   * 拦截响应的 HTTP 状态码（默认 400）。
   * 部分 provider 可能想用 422 / 451 区分语义。
   */
  blockStatus?: number;
  /**
   * 拦截响应 body 的 shape；默认 { error, code, rule }。
   * 自定义函数可换 schema 或加 i18n 文案。
   */
  blockResponseFn?: (verdict: FirewallVerdict) => unknown;
}

/** 默认 block response —— 简单 + machine-readable，让 caller 端 LLM 也能 parse */
export function defaultBlockResponse(verdict: FirewallVerdict): unknown {
  return {
    error: "input rejected by skill-firewall",
    code: "FIREWALL_BLOCK",
    rule: verdict.rule ?? "unknown",
    reason: verdict.reason ?? "policy violation",
  };
}
