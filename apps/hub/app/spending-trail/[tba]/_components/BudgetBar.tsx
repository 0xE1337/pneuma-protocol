"use client";

/**
 * BudgetBar — daily USDC budget gauge for a TBA.
 *
 * Optional surface: only rendered when `NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS`
 * is configured. If the contract isn't deployed for this network or the call
 * reverts, the component renders nothing — Spending Trail must work without
 * BudgetController per the task spec.
 *
 * Reads `BudgetController.getStatus(tba)` which returns
 *   (dailyBudget, spentToday, remaining, budgetSet)
 * — so a single call gives us everything UI needs.
 */
import { useReadContract } from "wagmi";
import { type Address } from "viem";
import { formatUsdc } from "@/lib/attestationFormatters";

const BUDGET_CONTROLLER = process.env
  .NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS as Address | undefined;

const BudgetControllerAbi = [
  {
    type: "function",
    name: "getStatus",
    stateMutability: "view",
    inputs: [{ name: "tba", type: "address" }],
    outputs: [
      { name: "dailyBudget", type: "uint256" },
      { name: "spentToday", type: "uint256" },
      { name: "remaining", type: "uint256" },
      { name: "budgetSet", type: "bool" },
    ],
  },
] as const;

export function BudgetBar({ tba }: { tba: Address }) {
  // Hooks must run unconditionally — guard via `enabled` instead of early
  // returning before the hook call (prevents React's hook-order errors when
  // the env flips between renders).
  const enabled = !!BUDGET_CONTROLLER;
  const { data, isLoading, error } = useReadContract({
    address: BUDGET_CONTROLLER,
    abi: BudgetControllerAbi,
    functionName: "getStatus",
    args: [tba],
    query: { enabled, refetchInterval: 12000 },
  });

  if (!enabled) return null;
  if (error) return null; // Graceful: BudgetController may not be on this chain.
  if (isLoading || !data) return null;

  const [dailyBudget, spentToday, , budgetSet] = data;

  if (!budgetSet) {
    return (
      <section className="surface px-5 py-4 flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="space-y-0.5">
          <div className="stat-label">Daily budget</div>
          <div className="text-ink-dim text-sm font-mono">
            Not set for this TBA
          </div>
        </div>
        <p className="text-[11px] text-ink-faint font-mono leading-relaxed max-w-md text-right">
          Owner wallet can set a daily USDC ceiling via{" "}
          <code className="text-ink-dim">BudgetController.setDailyBudget</code>{" "}
          — caps autonomous agent spend.
        </p>
      </section>
    );
  }

  // Pre-clamp percent in number-space; budgets are within JS-safe range here
  // (USDC is 6d, daily caps are user-set and small relative to 2^53).
  const total = Number(dailyBudget) / 1e18;
  const spent = Number(spentToday) / 1e18;
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const accent = pct >= 90 ? "magenta" : pct >= 60 ? "soul" : "cyan";

  return (
    <section className="surface px-5 py-4 mb-6 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="stat-label">Today&apos;s budget</div>
          <div className="text-ink text-sm font-mono">
            <span className="text-soul-soft">{formatUsdc(spentToday)}</span>{" "}
            <span className="text-ink-dim">/ {formatUsdc(dailyBudget)}</span>
          </div>
        </div>
        <div
          className={`text-[11px] font-mono uppercase tracking-[0.13em] ${
            accent === "magenta"
              ? "text-magenta"
              : accent === "soul"
              ? "text-soul-soft"
              : "text-cyan"
          }`}
        >
          {pct.toFixed(0)}% used
        </div>
      </div>

      {/* Progress bar — uses transform: scaleX for compositor-friendly motion */}
      <div className="relative h-1.5 rounded-full bg-bg overflow-hidden border border-border">
        <span
          className={`block h-full origin-left transition-transform duration-500 ${
            accent === "magenta"
              ? "bg-magenta"
              : accent === "soul"
              ? "bg-soul"
              : "bg-cyan"
          }`}
          style={{ transform: `scaleX(${pct / 100})`, width: "100%" }}
        />
      </div>
    </section>
  );
}
