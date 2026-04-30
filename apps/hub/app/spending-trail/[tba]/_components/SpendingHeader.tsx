"use client";

/**
 * SpendingHeader — top summary for the Spending Trail.
 *
 * Aggregates economic facts (total spend, receipt count, latest activity)
 * across the supplied attestation set. Keeps render purely derived — no fetch
 * here, the page owns the wagmi read so loading is centralized.
 */
import type { Address } from "viem";
import {
  type AttestationLike,
  formatUsdc,
  relativeTime,
  totalSpent,
} from "@/lib/attestationFormatters";
import { addressUrl, RATER_ROLE } from "@/lib/contracts";

export interface SpendingHeaderProps {
  tba: Address;
  attestations: readonly AttestationLike[];
}

export function SpendingHeader({ tba, attestations }: SpendingHeaderProps) {
  // Receipts == non-revoked, non-SYSTEM. SYSTEM is protocol metadata.
  const receipts = attestations.filter(
    (a) => !a.revoked && a.raterRole !== RATER_ROLE.SYSTEM,
  );
  const total = totalSpent(attestations);
  const latest = receipts.reduce<bigint>(
    (max, a) => (a.timestamp > max ? a.timestamp : max),
    0n,
  );

  // Average rating across all receipts, regardless of role. Display as one
  // decimal — same convention as profile page's "Avg ★" pill.
  const avgRating =
    receipts.length > 0
      ? receipts.reduce((sum, a) => sum + a.rating, 0) / receipts.length
      : 0;

  return (
    <header className="space-y-5 mb-10 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <span className="pill-live">Spending Trail · Proof of Spend</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-ink-faint font-mono">
          per-TBA receipt feed
        </span>
      </div>

      <h1 className="display text-4xl md:text-5xl">
        Every paid action,
        <span className="block text-magenta">written to chain.</span>
      </h1>

      <p className="text-ink-dim text-sm md:text-[15px] leading-relaxed max-w-2xl">
        Each row below is a single x402-settled skill call attached to this Soul's
        Token-Bound Account. USDC amount, rating, and on-chain reference are read
        directly from{" "}
        <code className="text-cyan font-mono">PneumaAttestation</code> — no
        backend, no log aggregator, no API key.
      </p>

      {/* TBA address row */}
      <div className="surface px-5 py-3 flex items-center gap-4 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.13em] text-ink-dim font-mono">
          TBA
        </span>
        <a
          href={addressUrl(tba)}
          target="_blank"
          rel="noreferrer"
          className="text-cyan hover:text-magenta underline underline-offset-2 font-mono text-sm break-all"
        >
          {tba}
        </a>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Total spent"
          value={formatUsdc(total)}
          accent="text-soul-soft"
        />
        <Stat
          label="Receipts"
          value={receipts.length.toString()}
          accent="text-cyan"
        />
        <Stat
          label="Avg rating"
          value={receipts.length > 0 ? `${avgRating.toFixed(1)} ★` : "—"}
          accent="text-magenta"
        />
        <Stat
          label="Latest"
          value={latest > 0n ? relativeTime(latest) : "never"}
          accent="text-ink"
        />
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="surface px-5 py-4">
      <div className={`stat-value text-2xl ${accent} truncate`} title={value}>
        {value}
      </div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}
