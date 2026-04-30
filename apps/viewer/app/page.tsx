"use client";

/**
 * Viewer (AgentVault) — 独立 dApp，第三方视角读链
 *
 * 两种 lookup 模式：
 *   1. By tokenId：直接输入 Soul ID 查（适合"我朋友给了我 #5"场景）
 *   2. By wallet：输入任意钱包地址，反查它持有的所有 Souls
 *      （兑现"transfer NFT 后第三方任意时刻能查"的故事）
 *
 * 关键：Viewer 完全独立——不依赖 Hub 后端、不调 Hub 的任何 API。
 * 仅用 viem 的 PublicClient 直接 getLogs / readContract，因此可以拿
 * 这份代码 fork 一份就能在任何地方跑。
 */

import { useState } from "react";
import { useReadContract, usePublicClient } from "wagmi";
import { formatUnits, isAddress, type Address } from "viem";
import {
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  SOUL_NFT,
  SoulNFTAbi,
  addressUrl,
  RATER_ROLE,
} from "@/lib/contracts";
import {
  lookupSoulsByOwner,
  type SoulCandidate,
} from "@/lib/lookupSoulsByOwner";

type Mode = "byTokenId" | "byWallet";

export default function ViewerHome() {
  const [mode, setMode] = useState<Mode>("byTokenId");

  // by tokenId
  const [tokenIdInput, setTokenIdInput] = useState("1");
  const [activeTokenId, setActiveTokenId] = useState<bigint | null>(1n);

  // by wallet
  const [walletInput, setWalletInput] = useState("");
  const [walletSouls, setWalletSouls] = useState<SoulCandidate[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletScanned, setWalletScanned] = useState<Address | null>(null);

  const publicClient = usePublicClient();

  const { data: totalMinted } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "totalMinted",
    query: { refetchInterval: 8000 },
  });

  async function runWalletLookup() {
    if (!publicClient) {
      setWalletError("RPC client not ready");
      return;
    }
    if (!isAddress(walletInput)) {
      setWalletError("Not a valid address");
      return;
    }
    setWalletError(null);
    setWalletLoading(true);
    setWalletSouls([]);
    setActiveTokenId(null);
    try {
      const owner = walletInput as Address;
      const items = await lookupSoulsByOwner(publicClient, owner);
      setWalletSouls(items);
      setWalletScanned(owner);
      // 如果只有一个 Soul，自动选中
      if (items.length === 1) {
        setActiveTokenId(items[0].tokenId);
      }
    } catch (err) {
      setWalletError((err as Error).message);
    } finally {
      setWalletLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-8 pt-16 pb-20 space-y-12 animate-fade-in">
      <Hero />

      <ModeToggle mode={mode} setMode={setMode} />

      {mode === "byTokenId" && (
        <Lookup
          tokenIdInput={tokenIdInput}
          setTokenIdInput={setTokenIdInput}
          onRead={() => {
            const n = parseInt(tokenIdInput, 10);
            if (n > 0) setActiveTokenId(BigInt(n));
          }}
          totalMinted={totalMinted}
        />
      )}

      {mode === "byWallet" && (
        <WalletLookup
          input={walletInput}
          setInput={setWalletInput}
          loading={walletLoading}
          error={walletError}
          souls={walletSouls}
          scanned={walletScanned}
          onLookup={runWalletLookup}
          onPick={(id) => setActiveTokenId(id)}
          activeTokenId={activeTokenId}
        />
      )}

      {activeTokenId !== null && <SoulPanel tokenId={activeTokenId} />}

      <OpenProtocolBox />
    </div>
  );
}

function Hero() {
  return (
    <section className="text-center max-w-3xl mx-auto space-y-6">
      <span className="pill">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-deep" />
        Independent dApp · agentvault.example
      </span>
      <h1 className="font-mono font-semibold tracking-tight text-4xl md:text-5xl lg:text-6xl leading-[1.05]">
        Read any Soul's history.
        <span className="block text-amber-deep">No backend. No permission.</span>
      </h1>
      <p className="text-ink-dim text-base md:text-lg leading-relaxed">
        AgentVault is operated by a different team than Pneuma Hub. We read attestations directly
        from PneumaAttestation on Arc Testnet. Anyone can build a dApp like this — that's the
        point of an open protocol.
      </p>
    </section>
  );
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex border border-amber/30 rounded-md overflow-hidden font-mono text-[12px]">
        <button
          type="button"
          onClick={() => setMode("byTokenId")}
          className={`px-5 py-2.5 transition-colors ${
            mode === "byTokenId"
              ? "bg-amber-deep text-paper"
              : "bg-paper text-ink-dim hover:text-amber-deep"
          }`}
        >
          By token ID
        </button>
        <button
          type="button"
          onClick={() => setMode("byWallet")}
          className={`px-5 py-2.5 transition-colors ${
            mode === "byWallet"
              ? "bg-amber-deep text-paper"
              : "bg-paper text-ink-dim hover:text-amber-deep"
          }`}
        >
          By wallet
        </button>
      </div>
    </div>
  );
}

function Lookup({
  tokenIdInput,
  setTokenIdInput,
  onRead,
  totalMinted,
}: {
  tokenIdInput: string;
  setTokenIdInput: (v: string) => void;
  onRead: () => void;
  totalMinted?: bigint;
}) {
  return (
    <div className="surface-paper p-7 max-w-2xl mx-auto">
      <label className="label">Look up Soul by token ID</label>
      <div className="flex gap-3 items-center">
        <input
          className="input flex-1 text-2xl font-mono font-semibold"
          type="number"
          min="1"
          max={totalMinted ? Number(totalMinted) : 1}
          value={tokenIdInput}
          onChange={(e) => setTokenIdInput(e.target.value)}
          placeholder="1"
          onKeyDown={(e) => e.key === "Enter" && onRead()}
        />
        <button type="button" className="btn-primary" onClick={onRead}>
          🔍 Read
        </button>
      </div>
      {totalMinted !== undefined && (
        <p className="text-[11px] text-ink-faint mt-3 font-mono">
          {totalMinted.toString()} Soul{totalMinted === 1n ? "" : "s"} minted on Arc Testnet
          · live count via <code>SoulNFT.totalMinted()</code>
        </p>
      )}
    </div>
  );
}

function WalletLookup({
  input,
  setInput,
  loading,
  error,
  souls,
  scanned,
  onLookup,
  onPick,
  activeTokenId,
}: {
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  error: string | null;
  souls: SoulCandidate[];
  scanned: Address | null;
  onLookup: () => void;
  onPick: (id: bigint) => void;
  activeTokenId: bigint | null;
}) {
  const valid = isAddress(input);

  return (
    <div className="space-y-5">
      <div className="surface-paper p-7 max-w-2xl mx-auto">
        <label className="label">Look up Souls by wallet address</label>
        <p className="text-[12px] text-ink-dim mb-3 leading-relaxed">
          Paste any Ethereum address. We scan SoulNFT Transfer events on Arc Testnet
          (filter <code className="text-amber-deep">to == address</code>) and verify the
          current owner.
        </p>
        <div className="flex gap-3 items-center">
          <input
            className="input flex-1 font-mono text-sm"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            onKeyDown={(e) => e.key === "Enter" && valid && !loading && onLookup()}
            disabled={loading}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={onLookup}
            disabled={!valid || loading}
          >
            {loading ? "Scanning…" : "🔍 Scan"}
          </button>
        </div>
        {error && (
          <div className="text-[11px] text-amber-deep font-mono mt-3 break-all">
            {error}
          </div>
        )}
      </div>

      {scanned && !loading && souls.length === 0 && (
        <div className="surface-warm p-6 text-center text-ink-dim max-w-2xl mx-auto">
          No Soul currently held by{" "}
          <code className="text-amber-deep font-mono">
            {scanned.slice(0, 8)}…{scanned.slice(-6)}
          </code>
          .
        </div>
      )}

      {souls.length > 0 && (
        <div className="space-y-3 max-w-4xl mx-auto">
          <div className="text-[11px] uppercase tracking-[0.18em] text-amber-deep font-mono text-center">
            {souls.length} Soul{souls.length === 1 ? "" : "s"} held by this wallet
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {souls.map((s) => (
              <button
                key={s.tokenId.toString()}
                type="button"
                onClick={() => onPick(s.tokenId)}
                className={`text-left surface-warm p-4 transition-all ${
                  activeTokenId === s.tokenId
                    ? "border-amber-deep ring-2 ring-amber-deep/30"
                    : "hover:border-amber-deep"
                }`}
              >
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-amber-deep font-mono text-[12px]">
                    #{s.tokenId.toString()}
                  </span>
                  <span className="text-ink font-medium truncate">
                    {s.agentName || "Unnamed Agent"}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-ink-faint break-all">
                  TBA {s.tba.slice(0, 8)}…{s.tba.slice(-6)}
                </div>
                <div className="text-[10px] font-mono text-ink-faint mt-1">
                  {new Date(Number(s.createdAt) * 1000).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SoulPanel({ tokenId }: { tokenId: bigint }) {
  const { data: soulData } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "souls",
    args: [tokenId],
  });

  const { data: currentOwner } = useReadContract({
    address: SOUL_NFT,
    abi: SoulNFTAbi,
    functionName: "ownerOf",
    args: [tokenId],
  });

  const tba = soulData?.[3] as Address | undefined;

  const { data: attestations, isLoading } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "getAttestationsByRecipient",
    args: tba ? [tba] : undefined,
    query: { enabled: !!tba, refetchInterval: 8000 },
  });

  if (!soulData || !tba || tba === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="surface p-10 text-center text-ink-dim">
        Soul #{tokenId.toString()} not found.
      </div>
    );
  }

  const valid = (attestations ?? []).filter((a) => !a.revoked);
  const segments = segmentByBoundary(valid);
  const evalRecords = valid.filter((a) => a.raterRole !== RATER_ROLE.SYSTEM);
  const currentSegment = segments.find((s) => s.isCurrent);
  const currentEvalCount = currentSegment?.items.length ?? evalRecords.length;
  const totalUsd = evalRecords.reduce((s, a) => s + a.paidAmount, 0n);
  const ownerChanges = segments.filter((s) => s.boundary !== null).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="surface-paper p-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-3">
            <span className="pill">Soul #{tokenId.toString()}</span>
            <h2 className="font-mono font-semibold text-3xl text-ink">
              {soulData[0] || "Unnamed Agent"}
            </h2>
            <div className="space-y-1.5 font-mono text-[12px]">
              <div>
                <span className="text-ink-dim">TBA   </span>
                <a
                  href={addressUrl(tba)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-deep hover:underline underline-offset-2 break-all"
                >
                  {tba}
                </a>
              </div>
              {currentOwner && (
                <div>
                  <span className="text-ink-dim">Owner  </span>
                  <a
                    href={addressUrl(currentOwner)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink hover:text-amber-deep underline underline-offset-2 break-all"
                  >
                    {currentOwner}
                  </a>
                </div>
              )}
              <div>
                <span className="text-ink-dim">Created  </span>
                <span className="text-ink">
                  {new Date(Number(soulData[4]) * 1000).toLocaleString()} · Arc Testnet
                </span>
              </div>
              {soulData[2] && (
                <div>
                  <span className="text-ink-dim">Metadata  </span>
                  <span className="text-ink">{soulData[2]}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <Stat value={currentEvalCount.toString()} label="Current era" />
            <Stat value={evalRecords.length.toString()} label="All-time" />
            <Stat
              value={Number(formatUnits(totalUsd, 6)).toString()}
              label="USDC paid"
            />
          </div>
        </div>

        {ownerChanges > 0 && (
          <div className="mt-6 surface-warm p-4 border-l-4 border-amber-deep">
            <div className="text-[11px] uppercase tracking-[0.18em] text-amber-deep font-mono mb-1">
              ⚠ Anti-Whitewash Notice
            </div>
            <p className="text-[13px] text-ink leading-relaxed">
              This Soul changed owners <strong>{ownerChanges} time{ownerChanges === 1 ? "" : "s"}</strong>.
              Reputation accumulated under previous owners is shown separately below — judge the{" "}
              <strong>current era</strong> on its own merits, not just lifetime totals.
            </p>
          </div>
        )}

        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.18em] text-amber-deep font-mono">
              Reputation Timeline ({segments.length} era{segments.length === 1 ? "" : "s"})
            </span>
            <span className="text-[11px] text-ink-faint font-mono">
              segmented by SoulNFT Transfer · live read via viem
            </span>
          </div>

          {isLoading && (
            <div className="text-ink-faint font-mono">Loading from chain…</div>
          )}

          {valid.length === 0 && !isLoading && (
            <div className="surface-warm p-6 text-center text-ink-dim">
              No attestations on this Soul yet.
            </div>
          )}

          {/* Render segments newest era first; within each segment, newest item first */}
          <div className="space-y-5">
            {segments
              .slice()
              .reverse()
              .map((segment, segIdx) => (
                <SegmentBlock
                  key={segment.boundary?.uid ?? "original"}
                  segment={segment}
                  eraLabel={
                    segment.isCurrent
                      ? "Current owner era"
                      : segIdx === segments.length - 1 && !segment.boundary
                        ? "Original era (since mint)"
                        : `Previous era #${segments.length - 1 - segIdx}`
                  }
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Ownership-segmented timeline rendering
// ─────────────────────────────────────────────────────────────────────

interface AttestationLike {
  readonly uid: `0x${string}`;
  readonly recipient: Address;
  readonly attester: Address;
  readonly skillId: bigint;
  readonly paymentHash: `0x${string}`;
  readonly rating: number;
  readonly paidAmount: bigint;
  readonly skillName: string;
  readonly skillCategory: string;
  readonly timestamp: bigint;
  readonly revoked: boolean;
  readonly raterRole: number;
  /** v3: 真用户写的文字评论（≤280 字符）；boundary / 旧 attestation 为空字符串 */
  readonly comment?: string;
}

interface OwnershipSegment {
  /** SYSTEM-rater attestation that started this era; null = original era from mint */
  boundary: AttestationLike | null;
  /** Real evaluations (not boundary) within this era */
  items: AttestationLike[];
  isCurrent: boolean;
}

/**
 * Walks attestations in chronological order, splits into eras separated by
 * SYSTEM-rater (ownership boundary) entries. The final era is marked current.
 *
 * 反信用洗白核心 UI 逻辑：让历史段一目了然，避免买家被"皮囊评分"骗到。
 */
function segmentByBoundary(attestations: readonly AttestationLike[]): OwnershipSegment[] {
  const sorted = [...attestations].sort((a, b) => Number(a.timestamp - b.timestamp));

  const segments: OwnershipSegment[] = [
    { boundary: null, items: [], isCurrent: false },
  ];

  for (const att of sorted) {
    if (att.raterRole === RATER_ROLE.SYSTEM) {
      segments.push({ boundary: att, items: [], isCurrent: false });
    } else {
      segments[segments.length - 1].items.push(att);
    }
  }

  // Drop the empty leading "original era" if no real activity happened before the first transfer
  if (segments.length > 1 && segments[0].items.length === 0 && segments[0].boundary === null) {
    segments.shift();
  }

  segments[segments.length - 1].isCurrent = true;
  return segments;
}

function SegmentBlock({ segment, eraLabel }: { segment: OwnershipSegment; eraLabel: string }) {
  const { boundary, items, isCurrent } = segment;
  const avgRating =
    items.length === 0
      ? 0
      : items.reduce((s, a) => s + a.rating, 0) / items.length;
  const totalUsd = items.reduce((s, a) => s + a.paidAmount, 0n);

  // Decode boundary from / to from paymentHash field (see PneumaAttestation.attestOwnershipChange)
  // paymentHash = keccak256(abi.encode(from, to, blocknumber)) — opaque on-chain, but we can
  // surface a placeholder; precise from/to comes from SoulNFT Transfer events (P2 enhancement).
  const boundaryDate = boundary
    ? new Date(Number(boundary.timestamp) * 1000)
    : null;

  const containerCls = isCurrent
    ? "surface-warm p-5 border-2 border-amber-deep"
    : "surface-warm p-5 opacity-70";
  const labelCls = isCurrent ? "text-amber-deep" : "text-ink-dim";

  return (
    <div className={containerCls}>
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span className={`text-[11px] uppercase tracking-[0.18em] font-mono font-semibold ${labelCls}`}>
            {eraLabel}
          </span>
          {boundaryDate && (
            <span className="text-[10px] text-ink-faint font-mono">
              boundary written {boundaryDate.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-4 text-[11px] font-mono text-ink-dim">
          <span>{items.length} call{items.length === 1 ? "" : "s"}</span>
          <span>
            {avgRating.toFixed(2)} ★ avg
          </span>
          <span>{formatUnits(totalUsd, 6)} USDC</span>
        </div>
      </div>

      {items.length === 0 && (
        <div className="text-[12px] text-ink-faint font-mono italic">
          No skill calls during this era yet.
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items
            .slice()
            .reverse()
            .map((a) => (
              <div
                key={a.uid}
                className="py-2 border-t border-amber/20 first:border-t-0 first:pt-0 space-y-2"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-0.5">
                    <h4 className="font-mono text-sm font-semibold text-ink">
                      {a.skillName}
                    </h4>
                    <div className="text-[10px] text-amber-deep font-mono">
                      skill #{a.skillId.toString()} · {a.skillCategory} ·{" "}
                      {a.raterRole === RATER_ROLE.PROVIDER
                        ? "rated by provider"
                        : a.raterRole === RATER_ROLE.CALLER
                          ? "rated by caller"
                          : "juror"}
                    </div>
                    <div className="text-[10px] text-ink-faint font-mono break-all">
                      uid {a.uid.slice(0, 22)}…
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <div className="text-amber-deep font-mono text-sm">
                      {"★".repeat(a.rating)}
                      <span className="text-ink-faint">
                        {"★".repeat(5 - a.rating)}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-dim font-mono">
                      {formatUnits(a.paidAmount, 6)} USDC
                    </div>
                    <div className="text-[10px] text-ink-faint font-mono">
                      {new Date(Number(a.timestamp) * 1000).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* v3: 真实用户文字评论 — 协议层"用户点评"原语，比抽象星数信息密度高得多 */}
                {a.comment && a.comment.length > 0 && (
                  <blockquote className="border-l-2 border-amber-deep/50 pl-3 py-1 text-[12px] text-ink leading-relaxed italic">
                    "{a.comment}"
                    <span className="block mt-0.5 not-italic text-[10px] text-ink-faint font-mono">
                      — {a.raterRole === RATER_ROLE.CALLER ? "real paying caller" : "provider note"}
                    </span>
                  </blockquote>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-card min-w-[110px]">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function OpenProtocolBox() {
  return (
    <div className="surface-warm p-8 max-w-4xl mx-auto space-y-3">
      <span className="pill">Open Protocol Moment</span>
      <p className="text-ink leading-relaxed text-base">
        Notice we never asked Pneuma Hub for permission. We never installed an SDK from
        them. We never paid for an API key. We just called
      </p>
      <code className="block px-4 py-3 rounded-md bg-paper border border-amber/30 font-mono text-[12px] text-amber-deep overflow-x-auto">
        PneumaAttestation.getAttestationsByRecipient(tba)
      </code>
      <p className="text-ink-dim text-[15px] leading-relaxed">
        directly with viem. Any developer can do the same in 30 seconds.{" "}
        <strong className="text-ink">That's what an open protocol means.</strong>
      </p>
    </div>
  );
}
