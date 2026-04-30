/**
 * attestationFormatters — pure helpers that turn raw `PneumaAttestation`
 * struct rows (as returned by `getAttestationsByRecipient`) into receipt-grade
 * display strings and aggregations.
 *
 * Mirrors the "Spending Trail" idea: each attestation = one paid AI action,
 * shown as a receipt. These helpers are deliberately pure (no React, no I/O)
 * so any other dApp can copy/paste them — that's the open-protocol contract.
 *
 * NOTE: These functions consume the **shape** declared in
 * `contracts.ts::PneumaAttestationAbi.getAttestationsByRecipient`. The on-chain
 * `callId` field (Track A: revoke→slash 反查 key) is now exposed in the ABI and
 * surfaced via `AttestationLike.callId`. Receipts may use either `callId` or
 * `paymentHash` as the explorer reference — `callId` is denser and indexed
 * by `SkillRegistry.CallEscrowed/CallSettled` events.
 *
 * 支付资产：Arc Testnet 原生 USDC（6 decimals），合约层字段名为 paidAmount。
 */
import { formatUnits } from "viem";
import { RATER_ROLE, BOUNDARY_CATEGORY, USDC_DECIMALS } from "./contracts";

/**
 * Minimal shape required by the formatters. Matches what
 * `useReadContract({ functionName: "getAttestationsByRecipient" })` returns
 * (each element of the tuple array).
 */
export interface AttestationLike {
  uid: string;
  recipient: string;
  attester: string;
  skillId: bigint;
  callId: bigint; // v2 (Track A) — 0 for boundary / pre-callId attestations
  paymentHash: string;
  rating: number;
  /** USDC 计价（6 decimals），合约字段名 paidAmount */
  paidAmount: bigint;
  skillName: string;
  skillCategory: string;
  timestamp: bigint;
  revoked: boolean;
  raterRole: number; // 0=PROVIDER, 1=CALLER, 2=JUROR, 3=SYSTEM
  /** v3: 真用户文字评论（≤280 字符）；boundary / 旧 attestation 为空字符串 */
  comment?: string;
}

/**
 * Sum `paidAmount` (USDC, 6 decimals) across non-revoked attestations.
 * Excludes SYSTEM/boundary entries (those carry no economic spend).
 *
 * Returns `bigint` to keep wei precision; format with `formatUsdc` for display.
 */
export function totalSpent(attestations: readonly AttestationLike[]): bigint {
  return attestations.reduce<bigint>((sum, a) => {
    if (a.revoked) return sum;
    if (a.raterRole === RATER_ROLE.SYSTEM) return sum;
    return sum + a.paidAmount;
  }, 0n);
}

/**
 * Group attestations by local-day (YYYY-MM-DD), newest day first; entries
 * inside each day are sorted newest-first too.
 *
 * Useful if a future revision wants a date-stamped receipt feed (Stripe-style
 * "Today / Yesterday / Apr 26"). Pure — no Date side effects beyond local TZ.
 */
export function groupByDay(
  attestations: readonly AttestationLike[],
): Array<{ day: string; entries: AttestationLike[] }> {
  const buckets = new Map<string, AttestationLike[]>();

  for (const a of attestations) {
    const day = dayKey(a.timestamp);
    const arr = buckets.get(day);
    if (arr) arr.push(a);
    else buckets.set(day, [a]);
  }

  return Array.from(buckets.entries())
    .map(([day, entries]) => ({
      day,
      entries: [...entries].sort((x, y) => Number(y.timestamp - x.timestamp)),
    }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/**
 * "0.5 USDC" / "12 USDC" — 4 decimals max, trailing zeros trimmed.
 *
 * @param raw 原始 USDC 金额（6 decimals 的最小单位，bigint）
 */
export function formatUsdc(raw: bigint): string {
  const human = formatUnits(raw, USDC_DECIMALS);
  return `${trimDecimals(human, 4)} USDC`;
}

/**
 * Human label for `RaterRole` enum.
 *
 *   0 → "Provider"
 *   1 → "Caller"
 *   2 → "Juror"
 *   3 → "System"
 *   _ → "Unknown"
 */
export function raterRoleLabel(role: number): string {
  switch (role) {
    case RATER_ROLE.PROVIDER:
      return "Provider";
    case RATER_ROLE.CALLER:
      return "Caller";
    case RATER_ROLE.JUROR:
      return "Juror";
    case RATER_ROLE.SYSTEM:
      return "System";
    default:
      return "Unknown";
  }
}

/**
 * Loose "x ago" string. Stable, no `Intl.RelativeTimeFormat` (avoids locale
 * surprises in SSR vs client) — keeps strings ASCII-deterministic.
 *
 * @param timestamp unix seconds (bigint, as the contract returns)
 * @param now milliseconds epoch; defaults to `Date.now()`
 */
export function relativeTime(timestamp: bigint, now: number = Date.now()): string {
  const seconds = Math.floor(now / 1000) - Number(timestamp);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 0) return "in the future";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * True for SYSTEM-rater boundary attestations written by SoulNFT on transfer.
 * Receipts UI uses this to optionally render boundaries as separators.
 */
export function isBoundary(a: AttestationLike): boolean {
  return a.raterRole === RATER_ROLE.SYSTEM && a.skillCategory === BOUNDARY_CATEGORY;
}

// ──────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in local TZ — stable sort key for `groupByDay`. */
function dayKey(timestamp: bigint): string {
  const d = new Date(Number(timestamp) * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Trim trailing zeros after decimal point, capped at `maxDecimals`.
 *
 *   "0.500000…" → "0.5"
 *   "12.000…"   → "12"
 *   "1.234567"  → "1.2346" (when maxDecimals=4)
 */
function trimDecimals(raw: string, maxDecimals: number): string {
  const [intPart, fracPart = ""] = raw.split(".");
  if (fracPart.length === 0) return intPart;
  const truncated = fracPart.slice(0, maxDecimals).replace(/0+$/, "");
  return truncated.length === 0 ? intPart : `${intPart}.${truncated}`;
}
