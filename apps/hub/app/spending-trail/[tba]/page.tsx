"use client";

/**
 * /spending-trail/[tba] — Pneuma on-chain receipt feed
 *
 * Renders every PneumaAttestation written to the supplied TBA as a time-
 * ordered receipt list: each row is a real x402-settled call with
 * payment hash, rating, and USDC amount — all read directly on-chain.
 *
 * The page does *not* require a wallet connection: anyone can audit any
 * Soul's spending trail because PneumaAttestation is open-readable.
 */
import { use } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { isAddress, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
} from "@/lib/contracts";
import type { AttestationLike } from "@/lib/attestationFormatters";
import { SpendingHeader } from "./_components/SpendingHeader";
import { BudgetBar } from "./_components/BudgetBar";
import { ReceiptList } from "./_components/ReceiptList";

export default function SpendingTrailPage({
  params,
}: {
  params: Promise<{ tba: string }>;
}) {
  const { tba: tbaParam } = use(params);

  if (!isAddress(tbaParam)) {
    return <MalformedAddress raw={tbaParam} />;
  }

  // viem's `isAddress` narrows on string but doesn't yield the `Address`
  // brand; cast once here so downstream components can stay strict.
  const tba = tbaParam as Address;

  return <SpendingTrailContent tba={tba} />;
}

function SpendingTrailContent({ tba }: { tba: Address }) {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: [tba],
    query: { refetchInterval: 8000 },
  });

  // wagmi returns the typed tuple array; we mirror to the formatter's struct
  // shape (same fields, just mutable for downstream sorting).
  const attestations: AttestationLike[] = (data ?? []).map((a) => ({
    uid: a.uid,
    recipient: a.recipient,
    attester: a.attester,
    skillId: a.skillId,
    callId: a.callId, // v2 — Track A revoke→slash 反查 key
    paymentHash: a.paymentHash,
    rating: a.rating,
    paidAmount: a.paidAmount,
    skillName: a.skillName,
    skillCategory: a.skillCategory,
    timestamp: a.timestamp,
    revoked: a.revoked,
    raterRole: a.raterRole,
    comment: a.comment, // v3 — 真用户文字评论（ABI tuple 最后字段）
  }));

  return (
    <div className="relative overflow-hidden">
      {/* Decorative streaks — match landing/profile aesthetic */}
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "260px",
          left: "8%",
          width: "82%",
          height: "6px",
          transform: "rotate(-7deg)",
          opacity: 0.4,
        }}
      />
      <div
        className="neon-streak"
        data-color="cyan"
        style={{
          top: "900px",
          left: "12%",
          width: "70%",
          height: "4px",
          transform: "rotate(6deg)",
          opacity: 0.28,
        }}
      />

      <div className="relative max-w-4xl mx-auto px-8 pt-12 pb-24">
        <SpendingHeader tba={tba} attestations={attestations} />
        <BudgetBar tba={tba} />

        {isError ? (
          <RpcError
            message={
              (error as { shortMessage?: string } | null)?.shortMessage ??
              (error as Error | null)?.message ??
              "Unknown RPC error"
            }
            onRetry={() => refetch()}
            retrying={isRefetching}
          />
        ) : (
          <ReceiptList
            attestations={attestations}
            isLoading={isLoading && attestations.length === 0}
          />
        )}

        {/* Open-protocol footer — same beat as profile page so callers
            understand this view is reproducible by any other dApp. */}
        <section className="mt-16 surface-gradient p-8 space-y-3">
          <span className="pill-live">Open Protocol · Replicate in 30s</span>
          <p className="text-ink leading-relaxed">
            This trail is just one rendering. Any dApp can call
          </p>
          <code className="block px-4 py-3 rounded bg-bg border border-border font-mono text-[12px] text-magenta overflow-x-auto">
            PneumaAttestation.getAttestationsByRecipient({tba.slice(0, 10)}…)
          </code>
          <p className="text-ink-dim text-sm leading-relaxed">
            with viem and rebuild the same receipt feed — no API key, no rate
            limit, no platform lock-in. That's the difference between a
            metering SaaS and an open protocol.
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * MalformedAddress — friendly error for invalid `[tba]` route param.
 *
 * Renders inline (no redirect) so the URL stays inspectable for the user
 * — easier to copy-paste and fix than a forced redirect.
 */
function MalformedAddress({ raw }: { raw: string }) {
  return (
    <div className="relative max-w-2xl mx-auto px-8 pt-16 pb-24 space-y-6 animate-fade-in">
      <span className="pill-live">Invalid TBA address</span>
      <h1 className="display text-3xl md:text-4xl">
        That doesn&apos;t look like an address.
      </h1>
      <div className="surface p-5 space-y-2">
        <div className="text-[10px] uppercase tracking-[0.13em] text-ink-dim font-mono">
          Got
        </div>
        <code className="block text-magenta font-mono text-sm break-all">
          {raw || "(empty)"}
        </code>
        <p className="text-ink-dim text-[12px] leading-relaxed pt-2">
          A Token-Bound Account address is a 0x-prefixed 20-byte hex string.
          Open a Soul on the profile index, copy its TBA, then come back.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/profile" className="btn-primary px-5 py-2.5 text-[13px]">
          Browse Souls →
        </Link>
        <Link href="/" className="btn-ghost px-5 py-2.5 text-[13px]">
          Home
        </Link>
      </div>
    </div>
  );
}

/**
 * RpcError — chain RPC failed; offer a retry without dumping the error to UI.
 *
 * Underlying message is shown for debuggability but escaped to stay inside
 * a styled card. Retry uses wagmi's `refetch` rather than reloading the page
 * so filter/scroll state is preserved.
 */
function RpcError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <section className="surface p-8 space-y-4 border-magenta/40">
      <div className="flex items-center gap-2">
        <span className="text-magenta text-lg">⚠</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-magenta font-mono">
          Couldn&apos;t reach PneumaAttestation
        </span>
      </div>
      <p className="text-ink-dim text-sm leading-relaxed">
        The RPC node didn&apos;t respond, or the contract address may be
        misconfigured for this network.
      </p>
      <code className="block px-4 py-3 rounded bg-bg border border-border font-mono text-[11px] text-ink-dim break-all">
        {message}
      </code>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="btn-primary px-5 py-2 text-[13px]"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </section>
  );
}
