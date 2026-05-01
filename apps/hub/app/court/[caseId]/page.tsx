"use client";

/**
 * /court/[caseId] — 单案详情 + 投票 + finalize
 *
 * 三种行为入口（按 connected wallet 角色显示）：
 *   - 是 juror 之一 + 投票期内 + 没投过 → vote(guilty=true|false)
 *   - 投票期已过 + status=Voting → finalize（任何人可触发）
 *   - 其他人：只读
 */

import { use, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { type Address, type Hex } from "viem";
import Link from "next/link";
import {
  PNEUMA_COURT,
  PneumaCourtAbi,
  addressUrl,
  txUrl,
} from "@/lib/contracts";

interface DisputeView {
  disputeId: bigint;
  callId: bigint;
  plaintiff: Address;
  defendant: Address;
  evidenceHash: `0x${string}`;
  description: string;
  jurors: readonly Address[];
  guiltyVotes: bigint;
  innocentVotes: bigint;
  votingDeadline: bigint;
  status: number;
  verdict: number;
}

const STATUS = { NONE: 0, VOTING: 1, RESOLVED: 2 } as const;
const VERDICT_LABEL: Record<number, { text: string; color: string }> = {
  0: { text: "Pending verdict", color: "text-ink-faint" },
  1: { text: "Guilty (for plaintiff)", color: "text-magenta" },
  2: { text: "Innocent (for defendant)", color: "text-cyan" },
};

export default function DisputeDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = use(params);
  const disputeId = BigInt(caseId);
  const { address, isConnected } = useAccount();

  const { data, refetch } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "getDispute",
    args: [disputeId],
    query: { refetchInterval: 8000 },
  });
  const d = data as DisputeView | undefined;

  // 当前 wallet 是不是 juror + 是否投过
  const isJuror =
    !!address &&
    !!d &&
    d.jurors.some((j) => j.toLowerCase() === address.toLowerCase());

  const { data: voted } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "hasVoted",
    args: address ? [disputeId, address] : undefined,
    query: { enabled: isJuror, refetchInterval: 8000 },
  });

  const now = Math.floor(Date.now() / 1000);
  const deadlineSec = d ? Number(d.votingDeadline) : 0;
  const inVoting = !!d && d.status === STATUS.VOTING && now < deadlineSec;
  const canFinalize = !!d && d.status === STATUS.VOTING && now >= deadlineSec;
  const remainingSec = Math.max(0, deadlineSec - now);

  if (!d || d.disputeId === 0n) {
    return (
      <div className="max-w-3xl mx-auto px-8 pt-12 pb-24 space-y-6">
        <h1 className="display text-3xl">Dispute #{caseId} not found</h1>
        <Link href="/court" className="text-cyan font-mono text-sm">
          ← Back to court list
        </Link>
      </div>
    );
  }

  const verdict = VERDICT_LABEL[d.verdict] ?? VERDICT_LABEL[0];

  return (
    <div className="relative overflow-hidden">
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "180px",
          left: "10%",
          width: "80%",
          height: "5px",
          transform: "rotate(-6deg)",
          opacity: 0.3,
        }}
      />

      <div className="relative max-w-4xl mx-auto px-8 pt-12 pb-24 space-y-8 animate-fade-in">
        <Link
          href="/court"
          className="text-[12px] font-mono text-ink-faint hover:text-cyan inline-block"
        >
          ← Back to court list
        </Link>

        <header className="space-y-3">
          <span className="pill-live">Dispute · #{d.disputeId.toString()}</span>
          <h1 className="display text-3xl md:text-4xl">
            Against call <span className="text-magenta">#{d.callId.toString()}</span>
          </h1>
          <div className={`text-lg font-mono ${verdict.color}`}>
            {verdict.text}
          </div>
        </header>

        {/* Description block */}
        <section className="surface p-5 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
            Plaintiff's claim
          </div>
          <p className="text-ink leading-relaxed">{d.description}</p>
          <div className="text-[10px] font-mono text-ink-faint break-all border-t border-border/60 pt-2">
            evidence hash: {d.evidenceHash}
          </div>
        </section>

        {/* Parties */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="surface p-4">
            <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono mb-1">
              Plaintiff
            </div>
            <a
              href={addressUrl(d.plaintiff)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[13px] text-ink hover:text-cyan break-all"
            >
              {d.plaintiff}
            </a>
          </div>
          <div className="surface p-4">
            <div className="text-[10px] uppercase tracking-[0.13em] text-soul-soft font-mono mb-1">
              Defendant
            </div>
            <a
              href={addressUrl(d.defendant)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[13px] text-ink hover:text-cyan break-all"
            >
              {d.defendant}
            </a>
          </div>
        </section>

        {/* Voting status */}
        <section className="surface p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
              Vote tally · {Number(d.guiltyVotes + d.innocentVotes)} / {d.jurors.length} cast
            </div>
            {inVoting && (
              <div className="text-[11px] text-magenta font-mono">
                {formatRemaining(remainingSec)} left
              </div>
            )}
            {canFinalize && (
              <div className="text-[11px] text-amber-400 font-mono">
                Voting ended · ready to finalize
              </div>
            )}
            {d.status === STATUS.RESOLVED && (
              <div className="text-[11px] text-cyan font-mono">Resolved</div>
            )}
          </div>

          <VoteBar
            guilty={Number(d.guiltyVotes)}
            innocent={Number(d.innocentVotes)}
            total={d.jurors.length}
          />

          <div className="text-[11px] font-mono text-ink-dim">
            Majority needed: {Math.floor(d.jurors.length / 2) + 1} · ties → innocent
          </div>
        </section>

        {/* Jurors list */}
        <section className="surface p-5 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono mb-2">
            Jurors ({d.jurors.length})
          </div>
          {d.jurors.map((j) => (
            <JurorRow
              key={j}
              juror={j}
              disputeId={disputeId}
              isMe={
                !!address && j.toLowerCase() === address.toLowerCase()
              }
            />
          ))}
        </section>

        {/* Voting CTA (only for jurors who haven't voted, in voting period) */}
        {isConnected && isJuror && inVoting && voted === false && (
          <VoteCTA disputeId={disputeId} onVoted={refetch} />
        )}

        {/* Finalize CTA (anyone, after voting period) */}
        {isConnected && canFinalize && (
          <FinalizeCTA disputeId={disputeId} onFinalized={refetch} />
        )}

        {/* SkillRegistry wire status note */}
        {d.verdict === 1 && (
          <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-5 py-4 text-[12px] font-mono text-ink-dim leading-relaxed">
            ⚖ Guilty 已链上落锤，但当前 SkillRegistry (v6.0) 还没接入
            slashOnCourtRuling hook —— 这条 ruling 链上可读，等 v6.1 上线时回填触发
            slash + endorser cascade。
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function formatRemaining(sec: number): string {
  if (sec <= 0) return "0s";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function VoteBar({
  guilty,
  innocent,
  total,
}: {
  guilty: number;
  innocent: number;
  total: number;
}) {
  const cast = guilty + innocent;
  const pendingPct = total > 0 ? ((total - cast) / total) * 100 : 100;
  const guiltyPct = total > 0 ? (guilty / total) * 100 : 0;
  const innocentPct = total > 0 ? (innocent / total) * 100 : 0;

  return (
    <div className="flex h-3 rounded overflow-hidden border border-border bg-bg/50">
      <div
        className="bg-magenta/70"
        style={{ width: `${guiltyPct}%` }}
        title={`Guilty: ${guilty}`}
      />
      <div
        className="bg-cyan/70"
        style={{ width: `${innocentPct}%` }}
        title={`Innocent: ${innocent}`}
      />
      <div
        className="bg-ink-faint/30"
        style={{ width: `${pendingPct}%` }}
        title={`Pending: ${total - cast}`}
      />
    </div>
  );
}

function JurorRow({
  juror,
  disputeId,
  isMe,
}: {
  juror: Address;
  disputeId: bigint;
  isMe: boolean;
}) {
  const { data: hasVotedData } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "hasVoted",
    args: [disputeId, juror],
    query: { refetchInterval: 8000 },
  });

  const { data: verdictData } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "jurorVerdict",
    args: [disputeId, juror],
    query: { enabled: hasVotedData === true, refetchInterval: 8000 },
  });

  const voted = hasVotedData === true;
  const guilty = verdictData === true;

  return (
    <div className="flex items-center justify-between text-[12px] font-mono py-1.5 border-b border-border/40 last:border-b-0">
      <a
        href={addressUrl(juror)}
        target="_blank"
        rel="noreferrer"
        className={`hover:text-cyan ${isMe ? "text-cyan font-bold" : "text-ink"}`}
      >
        {juror.slice(0, 10)}…{juror.slice(-8)}
        {isMe && <span className="ml-2 text-[9px]">(you)</span>}
      </a>
      <span className="text-[10px]">
        {!voted ? (
          <span className="text-ink-faint">— pending</span>
        ) : guilty ? (
          <span className="text-magenta">✓ guilty</span>
        ) : (
          <span className="text-cyan">✓ innocent</span>
        )}
      </span>
    </div>
  );
}

function VoteCTA({
  disputeId,
  onVoted,
}: {
  disputeId: bigint;
  onVoted: () => void;
}) {
  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  if (isSuccess) {
    onVoted();
  }

  async function vote(guilty: boolean) {
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: PNEUMA_COURT,
        abi: PneumaCourtAbi,
        functionName: "vote",
        args: [disputeId, guilty],
      });
      setTxHash(hash);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="surface-gradient p-6 space-y-4">
      <div className="text-[11px] uppercase tracking-[0.13em] text-cyan font-mono">
        ⚖ You are a juror · 投票期内未投票
      </div>
      <p className="text-ink-dim text-sm">
        Read the plaintiff's claim and the evidence hash. Your verdict is
        recorded on-chain and counts toward the majority decision.
      </p>
      <div className="flex gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => vote(true)}
          disabled={isPending || confirming}
          className="btn-primary px-5 py-2.5 bg-magenta hover:bg-magenta/90"
        >
          Vote guilty
        </button>
        <button
          type="button"
          onClick={() => vote(false)}
          disabled={isPending || confirming}
          className="btn-primary px-5 py-2.5 bg-cyan hover:bg-cyan/90"
        >
          Vote innocent
        </button>
      </div>
      {(isPending || confirming) && (
        <div className="text-[12px] text-ink-faint font-mono">
          {isPending ? "等钱包签名…" : "上链中…"}
        </div>
      )}
      {error && (
        <div className="text-[12px] text-magenta border border-magenta/40 bg-magenta/10 rounded p-2 break-words font-mono">
          {error}
        </div>
      )}
      {txHash && (
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-soul-soft hover:text-magenta font-mono"
        >
          tx {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
        </a>
      )}
    </section>
  );
}

function FinalizeCTA({
  disputeId,
  onFinalized,
}: {
  disputeId: bigint;
  onFinalized: () => void;
}) {
  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  if (isSuccess) {
    onFinalized();
  }

  async function finalize() {
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: PNEUMA_COURT,
        abi: PneumaCourtAbi,
        functionName: "finalize",
        args: [disputeId],
      });
      setTxHash(hash);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="surface-gradient p-6 space-y-4 border border-amber-400/40">
      <div className="text-[11px] uppercase tracking-[0.13em] text-amber-400 font-mono">
        ⚖ 投票期已过 · 任何人可触发 finalize
      </div>
      <p className="text-ink-dim text-sm">
        Finalize 计票 → 多数决判定 ruling → 链上写 verdict 不可撤。
      </p>
      <button
        type="button"
        onClick={finalize}
        disabled={isPending || confirming}
        className="btn-primary px-5 py-2.5 text-sm"
      >
        {isPending
          ? "等钱包签名…"
          : confirming
          ? "上链中…"
          : "Finalize ruling"}
      </button>
      {error && (
        <div className="text-[12px] text-magenta border border-magenta/40 bg-magenta/10 rounded p-2 break-words font-mono">
          {error}
        </div>
      )}
      {txHash && (
        <a
          href={txUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-soul-soft hover:text-magenta font-mono"
        >
          tx {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
        </a>
      )}
    </section>
  );
}
