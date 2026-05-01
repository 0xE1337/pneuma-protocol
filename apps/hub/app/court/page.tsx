"use client";

/**
 * /court — Pneuma Multi-Juror Court
 *
 * 协议级争议解决：plaintiff（caller）起诉 → 多陪审员投票 → 多数决 → 链上 ruling
 *
 * 信息架构：
 *   1. 顶部：dispute 总数 + voting 中数量 + resolved 数量
 *   2. 中间：案件列表（按 disputeId desc 排序）
 *   3. CTA：起诉新争议 → /court/new
 *
 * 协议层 invariant：
 *   - plaintiff 必须是 callId 的真 caller（链上读 SkillRegistry.getCall 验）
 *   - jurors 必须持 Soul + 不重 + 不是 plaintiff/defendant
 *   - 投票期固定（合约层 VOTING_PERIOD），任何人投票截止后可触发 finalize
 *   - 多数决（ties → innocent，保护 defendant）
 *   - 当前 SkillRegistry 是 v6.0，guilty 不会自动 slash —— 但 ruling 链上可读，可被 v6.1 后回填
 */

import Link from "next/link";
import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { type Address } from "viem";
import { PNEUMA_COURT, PneumaCourtAbi, addressUrl } from "@/lib/contracts";

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

const STATUS_LABEL: Record<number, string> = {
  0: "—",
  1: "Voting",
  2: "Resolved",
};

const VERDICT_LABEL: Record<number, { text: string; color: string }> = {
  0: { text: "Pending", color: "text-ink-faint" },
  1: { text: "Guilty (for plaintiff)", color: "text-magenta" },
  2: { text: "Innocent (for defendant)", color: "text-cyan" },
};

export default function CourtListPage() {
  const { data: count } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "disputeCount",
    query: { refetchInterval: 12000 },
  });

  const total = count !== undefined ? Number(count) : 0;
  const ids = useMemo(
    () => Array.from({ length: total }, (_, i) => BigInt(total - i)),
    [total],
  );

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
          opacity: 0.35,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-8 pt-12 pb-24 space-y-10 animate-fade-in">
        <header className="space-y-3">
          <span className="pill-live">PneumaCourt · 协议级争议解决</span>
          <h1 className="display text-4xl md:text-5xl">多陪审员法庭</h1>
          <p className="text-ink-dim leading-relaxed max-w-3xl">
            付费 marketplace 一定有纠纷。Pneuma 不让协议方独裁——把判决权交给**多个高声誉 agent**。
            plaintiff 提交 callId + 证据 hash + 陪审员名单 → 投票期内 jurors 投 guilty/innocent
            → 多数决 → 链上 ruling 不可篡改。
          </p>
        </header>

        <div className="rounded-md border border-magenta/30 bg-magenta/5 px-5 py-4">
          <div className="text-[10px] uppercase tracking-[0.13em] text-magenta font-mono mb-1">
            ⚖ 自治治理 · 协议层 invariant
          </div>
          <p className="text-[12px] text-ink-dim font-mono leading-relaxed">
            合约（contracts/src/PneumaCourt.sol，21/21 forge tests）已部署 Arc Testnet。
            投票合约层强制：jurors 必须持 Soul、不重、不是 plaintiff/defendant；
            ties → innocent（保护被告）。链上部署版本暂未跟 SkillRegistry v6.1
            的 slashOnCourtRuling hook 联动——但 ruling 链上可读，dApp 自行 cascade。
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-3 flex-wrap">
            <Stat
              label="Total disputes"
              value={total.toString()}
              color="text-magenta"
            />
            <Stat
              label="Voting period"
              value="3 days"
              color="text-cyan"
            />
            <Stat
              label="Settlement"
              value="On-chain ruling"
              color="text-soul-soft"
            />
          </div>
          <Link
            href="/court/new"
            className="btn-primary px-5 py-2.5 text-sm whitespace-nowrap"
          >
            + 起诉新案件
          </Link>
        </div>

        {total === 0 && (
          <div className="surface p-10 text-center text-ink-dim space-y-3">
            <div className="text-magenta text-3xl">⚖</div>
            <h3 className="display text-xl">No disputes filed yet</h3>
            <p className="text-sm max-w-md mx-auto leading-relaxed">
              起诉一笔有争议的 settled call → 选择持 Soul 的 jurors → 投票期内
              他们各自表态 → 多数决出 ruling。
            </p>
            <Link
              href="/court/new"
              className="text-cyan hover:text-magenta font-mono text-[12px] inline-block mt-2"
            >
              File the first dispute →
            </Link>
          </div>
        )}

        {total > 0 && (
          <div className="space-y-4">
            {ids.map((id) => (
              <DisputeRow key={id.toString()} disputeId={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="stat-card min-w-[160px]">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
    </div>
  );
}

function DisputeRow({ disputeId }: { disputeId: bigint }) {
  const { data, isLoading } = useReadContract({
    address: PNEUMA_COURT,
    abi: PneumaCourtAbi,
    functionName: "getDispute",
    args: [disputeId],
    query: { refetchInterval: 12000 },
  });

  if (isLoading || !data) {
    return (
      <div className="surface p-5 text-ink-faint font-mono text-sm">
        Loading dispute #{disputeId.toString()}…
      </div>
    );
  }

  const d = data as DisputeView;
  const verdict = VERDICT_LABEL[d.verdict] ?? VERDICT_LABEL[0];
  const status = STATUS_LABEL[d.status] ?? "—";
  const total = Number(d.guiltyVotes + d.innocentVotes);
  const required = Math.floor(d.jurors.length / 2) + 1;

  return (
    <Link
      href={`/court/${d.disputeId.toString()}`}
      className="surface p-5 hover:border-magenta/40 transition-colors block space-y-3"
    >
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span className="display text-2xl font-bold text-magenta">
            #{d.disputeId.toString()}
          </span>
          <span className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
            against call · {d.callId.toString()}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-[10px] uppercase tracking-[0.13em] px-2 py-1 rounded font-mono border ${
              d.status === 1
                ? "border-cyan/40 text-cyan"
                : "border-ink-faint/40 text-ink-faint"
            }`}
          >
            {status}
          </span>
          <span className={`text-sm font-mono ${verdict.color}`}>
            {verdict.text}
          </span>
        </div>
      </div>

      <p className="text-sm text-ink leading-relaxed line-clamp-2">
        {d.description || "(no description)"}
      </p>

      <div className="flex items-center gap-4 text-[11px] font-mono text-ink-dim flex-wrap">
        <span>
          plaintiff{" "}
          <a
            href={addressUrl(d.plaintiff)}
            target="_blank"
            rel="noreferrer"
            className="text-cyan hover:text-magenta"
            onClick={(e) => e.stopPropagation()}
          >
            {d.plaintiff.slice(0, 8)}…{d.plaintiff.slice(-6)}
          </a>
        </span>
        <span className="text-ink-faint">·</span>
        <span>
          defendant{" "}
          <a
            href={addressUrl(d.defendant)}
            target="_blank"
            rel="noreferrer"
            className="text-soul-soft hover:text-magenta"
            onClick={(e) => e.stopPropagation()}
          >
            {d.defendant.slice(0, 8)}…{d.defendant.slice(-6)}
          </a>
        </span>
        <span className="text-ink-faint">·</span>
        <span>{d.jurors.length} jurors</span>
        <span className="text-ink-faint">·</span>
        <span>
          {total}/{d.jurors.length} voted (need {required})
        </span>
      </div>
    </Link>
  );
}
