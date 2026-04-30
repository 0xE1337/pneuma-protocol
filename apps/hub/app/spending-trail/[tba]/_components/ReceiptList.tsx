"use client";

/**
 * ReceiptList — filtered, time-sorted receipt feed.
 *
 * Filter chips correspond to RaterRole values plus an "include revoked"
 * toggle. Sorting is descending by timestamp so the latest action sits on top.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type AttestationLike,
  isBoundary,
  raterRoleLabel,
} from "@/lib/attestationFormatters";
import { RATER_ROLE } from "@/lib/contracts";
import { ReceiptCard } from "./ReceiptCard";

type RoleFilter = "all" | "provider" | "caller" | "system";

const ROLE_FILTERS: Array<{ key: RoleFilter; label: string; hint: string }> = [
  { key: "all", label: "All", hint: "every attestation" },
  { key: "provider", label: "Provider receipts", hint: "skill auto-rated" },
  { key: "caller", label: "Caller-rated", hint: "buyer feedback" },
  { key: "system", label: "Boundaries", hint: "ownership transfers" },
];

const ROLE_KEY: Record<RoleFilter, number | null> = {
  all: null,
  provider: RATER_ROLE.PROVIDER,
  caller: RATER_ROLE.CALLER,
  system: RATER_ROLE.SYSTEM,
};

export interface ReceiptListProps {
  attestations: readonly AttestationLike[];
  isLoading?: boolean;
}

export function ReceiptList({ attestations, isLoading }: ReceiptListProps) {
  const [role, setRole] = useState<RoleFilter>("all");
  const [showRevoked, setShowRevoked] = useState(false);

  const filtered = useMemo(() => {
    const roleFilter = ROLE_KEY[role];
    return attestations
      .filter((a) => {
        if (!showRevoked && a.revoked) return false;
        if (roleFilter === null) return true;
        // Boundaries are SYSTEM + boundary category. The "system" chip
        // explicitly opts into them; the others suppress them so they don't
        // pollute the receipt feed.
        if (roleFilter === RATER_ROLE.SYSTEM) return isBoundary(a);
        return a.raterRole === roleFilter;
      })
      .slice()
      .sort((a, b) => Number(b.timestamp - a.timestamp));
  }, [attestations, role, showRevoked]);

  // Per-chip count for active labels (computed pre-revoke-filter so chips
  // are stable when the toggle flips).
  const counts = useMemo(() => {
    const visible = showRevoked
      ? attestations
      : attestations.filter((a) => !a.revoked);
    return {
      all: visible.filter((a) => !isBoundary(a)).length + visible.filter(isBoundary).length,
      provider: visible.filter((a) => a.raterRole === RATER_ROLE.PROVIDER && !isBoundary(a)).length,
      caller: visible.filter((a) => a.raterRole === RATER_ROLE.CALLER).length,
      system: visible.filter(isBoundary).length,
    } as const;
  }, [attestations, showRevoked]);

  const totalRevoked = attestations.filter((a) => a.revoked).length;

  return (
    <section className="space-y-5">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Receipt filters">
          {ROLE_FILTERS.map((f) => {
            const active = role === f.key;
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRole(f.key)}
                title={f.hint}
                className={`px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-[0.13em] border transition-all ${
                  active
                    ? "border-soul/60 bg-soul/15 text-magenta"
                    : "border-border bg-bg text-ink-dim hover:text-ink hover:border-soul/40"
                }`}
              >
                {f.label}
                <span className="ml-2 text-[10px] text-ink-faint tabular-nums">
                  {counts[f.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        <label className="ml-auto inline-flex items-center gap-2 text-[11px] font-mono text-ink-dim cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRevoked}
            onChange={(e) => setShowRevoked(e.target.checked)}
            className="accent-magenta"
          />
          <span>
            Show revoked
            {totalRevoked > 0 && (
              <span className="text-ink-faint"> ({totalRevoked})</span>
            )}
          </span>
        </label>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse-dot" />
        Live · 8s sync from PneumaAttestation
        <span className="ml-auto text-ink-dim">
          showing {filtered.length} {filtered.length === 1 ? "receipt" : "receipts"}
        </span>
      </div>

      {/* List body */}
      {isLoading && <ReceiptSkeleton />}

      {!isLoading && filtered.length === 0 && (
        <EmptyState role={role} hasAny={attestations.length > 0} />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((a) => (
            <ReceiptCard key={a.uid} entry={a} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * EmptyState — friendly empty card with a route into /run.
 *
 * Differentiates "no receipts at all" vs "filter excluded everything" so the
 * user knows whether to widen the filter or actually go run a skill.
 */
function EmptyState({
  role,
  hasAny,
}: {
  role: RoleFilter;
  hasAny: boolean;
}) {
  if (hasAny && role !== "all") {
    return (
      <div className="surface p-10 text-center space-y-3">
        <div className="text-ink-dim text-sm">
          No {raterRoleLabel(ROLE_KEY[role] ?? 0)} receipts in this filter.
        </div>
        <p className="text-ink-faint text-[12px] leading-relaxed">
          Try the <span className="text-ink-dim">All</span> chip above to see
          every attestation written to this TBA.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-glow p-10 text-center space-y-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-cyan font-mono">
        No spend yet
      </div>
      <p className="text-ink-dim text-sm leading-relaxed max-w-md mx-auto">
        This Soul has never paid for an x402 skill. The first receipt will land
        here within seconds of the first <code className="text-ink">settleCall</code>.
      </p>
      <Link
        href="/run"
        className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-[13px]"
      >
        Run a skill →
      </Link>
    </div>
  );
}

/**
 * ReceiptSkeleton — three placeholder cards. Width/height match a real card
 * to avoid layout shift on data arrival.
 */
function ReceiptSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading receipts">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="receipt-card animate-pulse"
          data-accent="soul"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <span className="receipt-edge" aria-hidden="true" />
          <div className="px-6 pt-5 pb-4 space-y-4">
            <div className="h-5 w-2/3 rounded bg-border/60" />
            <div className="flex gap-2">
              <div className="h-4 w-24 rounded bg-border/60" />
              <div className="h-4 w-20 rounded bg-border/60" />
            </div>
            <div className="border-t border-dashed border-border pt-3 flex justify-between">
              <div className="h-7 w-24 rounded bg-border/60" />
              <div className="h-7 w-32 rounded bg-border/60" />
            </div>
          </div>
          <span className="receipt-edge" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
