"use client";

/**
 * ReceiptCard — a single attestation rendered as a "Proof-of-Spend" receipt.
 *
 * Visual borrows from a perforated paper-receipt: dotted top/bottom edges,
 * subtle paper-grain (using project surface tokens), no gradient walls.
 * Hover lifts the card; the perforations match the violet-void palette.
 */
import {
  type AttestationLike,
  formatUsdc,
  raterRoleLabel,
  relativeTime,
  isBoundary,
} from "@/lib/attestationFormatters";
import { addressUrl, txUrl } from "@/lib/contracts";

type RoleAccent = "soul" | "cyan" | "magenta" | "ink";

const ROLE_BADGE: Record<number, { className: string; icon: string }> = {
  0: {
    icon: "↗",
    className: "border-soul/40 text-soul-soft bg-soul/5",
  },
  1: {
    icon: "↘",
    className: "border-cyan/60 text-cyan bg-cyan/5",
  },
  2: {
    icon: "⚖",
    className: "border-magenta/60 text-magenta bg-magenta/5",
  },
  3: {
    icon: "◇",
    className: "border-ink-faint/40 text-ink-dim bg-ink/5",
  },
};

const CATEGORY_ACCENT: Record<string, RoleAccent> = {
  finance: "cyan",
  text: "magenta",
};

export function ReceiptCard({ entry }: { entry: AttestationLike }) {
  const boundary = isBoundary(entry);
  // Boundary attestations are protocol metadata (ownership transfers) — they
  // shouldn't be rendered as paid receipts. Caller filters them out, but we
  // guard here too so the component is self-defensible.
  if (boundary) return <BoundaryDivider entry={entry} />;

  const roleBadge = ROLE_BADGE[entry.raterRole] ?? ROLE_BADGE[0];
  const accent: RoleAccent =
    CATEGORY_ACCENT[entry.skillCategory] ?? "soul";
  const stars = Math.max(0, Math.min(5, entry.rating));
  const filled = "★".repeat(stars);
  const empty = "★".repeat(5 - stars);

  // Derive an explorer reference: the on-chain `paymentHash` is x402's EIP-712
  // hash — not a tx hash, but it's the most stable on-chain anchor we expose
  // in this ABI subset. Profile page already treats `paymentHash` similarly.
  const refShort = `${entry.paymentHash.slice(0, 10)}…${entry.paymentHash.slice(-6)}`;
  const uidShort = `${entry.uid.slice(0, 12)}…${entry.uid.slice(-6)}`;
  const absolute = new Date(Number(entry.timestamp) * 1000).toLocaleString();

  return (
    <article
      className={`receipt-card ${entry.revoked ? "opacity-60" : ""}`}
      data-accent={accent}
    >
      {/* Perforated top edge */}
      <span className="receipt-edge" aria-hidden="true" />

      <div className="px-6 pt-5 pb-4 space-y-4">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-2 min-w-0">
            <h3 className="font-mono text-lg font-semibold text-ink truncate">
              {entry.skillName || "(unnamed skill)"}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryTag accent={accent}>
                #{entry.skillId.toString()} · {entry.skillCategory || "uncategorized"}
              </CategoryTag>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.13em] font-mono border ${roleBadge.className}`}
                title={`raterRole = ${entry.raterRole}`}
              >
                <span aria-hidden="true">{roleBadge.icon}</span>
                {raterRoleLabel(entry.raterRole)}
              </span>
              {entry.revoked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.13em] font-mono border border-magenta/50 text-magenta bg-magenta/10">
                  revoked
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-magenta text-base font-mono leading-none">
              {filled}
              <span className="text-ink-faint">{empty}</span>
            </div>
            <div className="mt-1 text-[11px] text-ink-dim font-mono">
              {raterRoleLabel(entry.raterRole)}-rated
            </div>
          </div>
        </header>

        {/* v3 真用户文字评论 — 比抽象星数信息密度高得多，跟 Amazon 评论同一逻辑 */}
        {entry.comment && entry.comment.length > 0 && (
          <blockquote className="border-l-2 border-soul-soft pl-3 py-1 text-[12px] text-ink leading-relaxed italic">
            "{entry.comment}"
            <span className="block mt-1 not-italic text-[10px] text-ink-faint font-mono">
              — written by {raterRoleLabel(entry.raterRole).toLowerCase()} (on-chain)
            </span>
          </blockquote>
        )}

        {/* Amount + time row — receipt-style, monospace right-aligned */}
        <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-border pt-3">
          <div className="space-y-0.5">
            <div className="stat-label">Paid</div>
            <div className="text-soul-soft text-xl font-mono tabular-nums">
              {formatUsdc(entry.paidAmount)}
            </div>
          </div>
          <div className="text-right space-y-0.5">
            <div className="stat-label">Settled</div>
            <div
              className="text-ink text-[13px] font-mono"
              title={absolute}
            >
              {relativeTime(entry.timestamp)}
            </div>
            <div className="text-[10px] text-ink-faint font-mono">{absolute}</div>
          </div>
        </div>

        {/* Refs — uid + payment hash + attester (= SkillRegistry) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 border-t border-dashed border-border pt-3 text-[10px] font-mono">
          <Ref label="uid" value={uidShort} />
          <Ref
            label="payment"
            value={refShort}
            // paymentHash is an EIP-712 digest, not a tx — but the explorer
            // accepts arbitrary 0x… search; treating it as a search param
            // helps in the few cases where it equals the actual tx hash.
            link={txUrl(entry.paymentHash)}
          />
          <Ref
            label="attester"
            value={`${entry.attester.slice(0, 8)}…${entry.attester.slice(-6)}`}
            link={addressUrl(entry.attester)}
            hint="SkillRegistry"
          />
          <Ref
            label="recipient"
            value={`${entry.recipient.slice(0, 8)}…${entry.recipient.slice(-6)}`}
            link={addressUrl(entry.recipient)}
            hint="TBA"
          />
        </div>
      </div>

      <span className="receipt-edge" aria-hidden="true" />
    </article>
  );
}

function CategoryTag({
  accent,
  children,
}: {
  accent: RoleAccent;
  children: React.ReactNode;
}) {
  if (accent === "cyan") return <span className="tag-cyan">{children}</span>;
  if (accent === "magenta") return <span className="tag-soul">{children}</span>;
  return <span className="tag">{children}</span>;
}

function Ref({
  label,
  value,
  link,
  hint,
}: {
  label: string;
  value: string;
  link?: string;
  hint?: string;
}) {
  const valueNode = link ? (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      className="text-ink hover:text-magenta underline underline-offset-2 break-all"
    >
      {value}
    </a>
  ) : (
    <span className="text-ink-dim break-all">{value}</span>
  );
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[9px] uppercase tracking-[0.13em] text-ink-faint shrink-0">
        {label}
      </span>
      <span className="truncate min-w-0">{valueNode}</span>
      {hint && (
        <span className="text-[9px] text-ink-faint italic shrink-0">({hint})</span>
      )}
    </div>
  );
}

/**
 * BoundaryDivider — boundary attestations are NOT receipts; render them as a
 * thin separator chip inside the timeline so context isn't lost.
 */
function BoundaryDivider({ entry }: { entry: AttestationLike }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex-1 h-px bg-border/60" />
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan/30 bg-cyan/5 text-cyan text-[10px] font-mono uppercase tracking-[0.13em]">
        <span aria-hidden="true">◇</span>
        ownership boundary · {relativeTime(entry.timestamp)}
      </span>
      <span className="flex-1 h-px bg-border/60" />
    </div>
  );
}
