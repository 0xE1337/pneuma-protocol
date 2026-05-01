"use client";

/**
 * /run — Wallet-driven x402 Skill Call
 *
 * 这是 Pneuma "钱包即身份" 叙事的核心兑现页：
 *   1. 用户连接 MetaMask → useMySouls 反查持有的 Souls（Transfer event + ownerOf 校验）
 *   2. 用户选 Soul + 选 Skill + 输入 query
 *   3. 全部交易由用户钱包签名（无 server 私钥代签）：
 *      a. USDC.approve(SkillRegistry, ...)        ← 用户签
 *      b. SkillRegistry.escrowForCall(...)        ← 用户签
 *      c. fetch service with X-Payment header     ← 用户已付，service settle
 *   4. settleCall 在 service 端 x402 middleware 自动跑
 *      （service provider 用自己的私钥结算自己的收入，与"用户身份"无矛盾）
 *
 * 与 /api/orchestrate（多 skill LLM 编排，server signer）相比，这条路径是
 * "demo 第一原则"：评委一眼看到所有 tx 都从 connected wallet 出，attestation
 * 真实落到选中 Soul 的 TBA 上。
 */

import { Suspense, memo, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { formatUnits, type Address, type Hex, type PublicClient } from "viem";
import {
  buildPaymentDomain,
  PAYMENT_AUTH_TYPES,
} from "@pneuma/x402";
import {
  USDC_TOKEN,
  UsdcAbi,
  USDC_DECIMALS,
  PNEUMA_ATTESTATION,
  PneumaAttestationAbi,
  SKILL_REGISTRY,
  SkillRegistryAbi,
  txUrl,
} from "@/lib/contracts";
import { useMySouls, type SoulSummary } from "@/lib/useMySouls";
import { CHAIN_ID } from "@/lib/chain";
import { WrongChainBanner } from "@/app/_components/ChainGuard";
import { useI18n } from "@/lib/i18n";
import Link from "next/link";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

interface SkillRow {
  skillId: bigint;
  owner: Address;
  name: string;
  description: string;
  endpoint: string;
  category: string;
  pricePerCall: bigint;
  totalCalls: bigint;
  active: boolean;
  createdAt: bigint;
  // V4 size cap
  maxInputBytes: number;
  maxOutputBytes: number;
  // V5 per-byte pricing + 上游披露（V4 skill 全为 0/""）
  baseFee: bigint;
  inputPricePerKB: bigint;
  outputPricePerKB: bigint;
  upstreamModel: string;
  markupBps: number;
}

interface RunSuccess {
  callId: string;
  paymentHash: Hex;
  approveTxHash: Hex | null;
  escrowTxHash: Hex;
  /** USDC 计价（6 decimals 最小单位） */
  paidAmount: bigint;
  durationMs: number;
  data: unknown;
  skillName: string;
  skillId: bigint;
  category: string;
  soulTokenId: bigint;
  callerTBA: Address;
}

type Step = "idle" | "approving" | "escrowing" | "calling" | "done" | "error";

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

/**
 * 顶层 wrapper —— Next.js 15 要求 useSearchParams 必须在 Suspense 内
 * （SSR 时该 hook 会触发 CSR bailout，必须有 fallback）
 */
export default function RunPage() {
  return (
    <Suspense fallback={<RunPageFallback />}>
      <RunPageInner />
    </Suspense>
  );
}

function RunPageFallback() {
  return (
    <div className="max-w-7xl mx-auto px-8 pt-12 pb-24">
      <div className="text-ink-faint font-mono text-sm">Loading…</div>
    </div>
  );
}

function RunPageInner() {
  const { t } = useI18n();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const { souls, loading: soulsLoading, error: soulsError, refetch: refetchSouls } = useMySouls(
    address,
  );

  // 模式切换：手动 vs 自然语言（接 /api/orchestrate planner LLM）
  // /discover 一键执行跳过来时会带 ?mode=smart，进页后由下面 useEffect 同步
  const [mode, setMode] = useState<"manual" | "smart">("manual");

  // 用户选择
  const [selectedTokenId, setSelectedTokenId] = useState<bigint | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<bigint | null>(null);
  const [query, setQuery] = useState("");

  // 状态机
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunSuccess | null>(null);

  // 默认选第一个 Soul
  useEffect(() => {
    if (selectedTokenId === null && souls.length > 0) {
      setSelectedTokenId(souls[0].tokenId);
    }
  }, [souls, selectedTokenId]);

  // 链上读 skills 列表 —— 30s 间隔（skill 注册不频繁，没必要 8s 轮询）
  // 8s 轮询在用户点击的瞬间常引发 wagmi 重新订阅 → 整页 re-render → 卡顿
  const { data: skillsData } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "listActiveSkills",
    query: { refetchInterval: 30000 },
  });
  const skills = (skillsData ?? []) as readonly SkillRow[];

  // /agents/[address] 详情页"调用此能力"按钮带 ?skillId=X 跳过来时自动锁定该 skill
  // /discover SearchBox 一键执行带 ?mode=smart&query=... 跳过来时切到 smart 模式 + 预填
  // 加 deeplink 支持后，从 Agent / Discover 视角到具体调用之间不再断链
  const searchParams = useSearchParams();
  const querySkillIdRaw = searchParams.get("skillId");
  const queryModeRaw = searchParams.get("mode");
  const queryPrefill = searchParams.get("query") ?? "";

  // 进页后只同步一次 mode（避免用户手动切回 manual 又被 url 拽回 smart）
  useEffect(() => {
    if (queryModeRaw === "smart") setMode("smart");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 默认选择 skill：优先 ?skillId（若 valid），其次 list[0]
  useEffect(() => {
    if (selectedSkillId !== null || skills.length === 0) return;

    if (querySkillIdRaw) {
      try {
        const queryId = BigInt(querySkillIdRaw);
        const exists = skills.some((s) => s.skillId === queryId);
        if (exists) {
          setSelectedSkillId(queryId);
          return;
        }
      } catch {
        // 非合法 bigint —— 忽略，落到 fallback
      }
    }

    setSelectedSkillId(skills[0].skillId);
  }, [skills, selectedSkillId, querySkillIdRaw]);

  const selectedSoul = useMemo(
    () => souls.find((s) => s.tokenId === selectedTokenId) ?? null,
    [souls, selectedTokenId],
  );
  const selectedSkill = useMemo(
    () => skills.find((s) => s.skillId === selectedSkillId) ?? null,
    [skills, selectedSkillId],
  );

  // 稳定的 click handler 引用 —— 跟 React.memo(SoulPick / SkillPick) 配合
  // 让"点 A 不会让 B/C/D 卡片也重渲染"成立，消除 7+ 卡片 fullscan re-render 卡顿
  const onPickSoul = useCallback(
    (id: bigint) => setSelectedTokenId(id),
    [],
  );
  const onPickSkill = useCallback(
    (id: bigint) => setSelectedSkillId(id),
    [],
  );

  // 当前 EOA 的 USDC 余额 + attestation count（直接显示，不挡演示路径）
  const { data: usdcBalance } = useReadContract({
    address: USDC_TOKEN,
    abi: UsdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 6000 },
  });
  const { data: attCount } = useReadContract({
    address: PNEUMA_ATTESTATION,
    abi: PneumaAttestationAbi,
    functionName: "countByRecipient",
    args: selectedSoul ? [selectedSoul.tba] : undefined,
    query: { enabled: !!selectedSoul, refetchInterval: 6000 },
  });

  const wrongChain = isConnected && chainId !== CHAIN_ID;

  // ──────────────────────────────────────────────────────────────────────
  // Run handler — wallet-signed approve + escrow + fetch
  // ──────────────────────────────────────────────────────────────────────

  async function run() {
    if (!address) {
      setError("Connect wallet first");
      setStep("error");
      return;
    }
    if (!publicClient) {
      setError("RPC not ready");
      setStep("error");
      return;
    }
    if (!selectedSoul || !selectedSkill) {
      setError("Pick a Soul and a Skill");
      setStep("error");
      return;
    }
    if (wrongChain) {
      setError(`Wrong chain ${chainId}. Switch to Arc Testnet (${CHAIN_ID}).`);
      setStep("error");
      return;
    }

    setError(null);
    setResult(null);
    const t0 = Date.now();

    try {
      const price = selectedSkill.pricePerCall;
      const callerTBA = selectedSoul.tba;

      // Step 1: ensure allowance
      const allowance = (await publicClient.readContract({
        address: USDC_TOKEN,
        abi: UsdcAbi,
        functionName: "allowance",
        args: [address, SKILL_REGISTRY],
      })) as bigint;

      let approveTxHash: Hex | null = null;
      if (allowance < price) {
        setStep("approving");
        // 一次签大额，避免反复签名（幂等于 PneumaClient SDK 行为）
        const approveAmount = price * 1000n;
        approveTxHash = await writeContractAsync({
          address: USDC_TOKEN,
          abi: UsdcAbi,
          functionName: "approve",
          args: [SKILL_REGISTRY, approveAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      }

      // Step 2: random paymentHash + escrow
      setStep("escrowing");
      const paymentHash = randomBytes32();
      // v4 inputBytes — 估算 request body 字节数；service middleware 会再次精确校验
      const bodyForEstimate = packBodyForCategory(selectedSkill.category, query);
      const inputBytes = new TextEncoder().encode(JSON.stringify(bodyForEstimate)).length;
      // v5 maxOutputBytes — V5 skill 必须声明（用 skill.maxOutputBytes 默认上限给最优 UX；未来可加 caller 滑块）；V4 skill 传 0 被合约忽略
      const isV5Skill =
        selectedSkill.inputPricePerKB > 0n || selectedSkill.outputPricePerKB > 0n;
      const maxOutputBytes = isV5Skill ? Number(selectedSkill.maxOutputBytes) : 0;
      const escrowTxHash = await writeContractAsync({
        address: SKILL_REGISTRY,
        abi: SkillRegistryAbi,
        functionName: "escrowForCall",
        args: [selectedSkill.skillId, callerTBA, paymentHash, inputBytes, maxOutputBytes],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: escrowTxHash,
      });

      // Step 3: parse callId from CallEscrowed event (topic[1] = indexed callId)
      const callId = parseCallIdFromReceipt(receipt.logs);
      if (callId === null) {
        throw new Error("CallEscrowed event not found in receipt");
      }

      // Step 4: 签 EIP-712 PaymentAuth + build X-Payment header
      // V5 安全升级：之前 stub `signature: "0x"` 让监听者拿 callId 就能消费 escrow，
      //              现在签名绑定 (callId, paymentHash, caller, callerTBA, maxAmount, deadline)，
      //              service 端 verifyPayment 比对链上 c.caller，攻击向量被堵死
      setStep("calling");
      if (!address) throw new Error("wallet address missing");
      const deadlineSec = Math.floor(Date.now() / 1000) + 5 * 60; // 5 分钟有效期
      const signature = await signTypedDataAsync({
        domain: buildPaymentDomain({ chainId, skillRegistry: SKILL_REGISTRY }),
        types: PAYMENT_AUTH_TYPES,
        primaryType: "PaymentAuth",
        message: {
          callId,
          paymentHash,
          caller: address,
          callerTBA,
          maxAmount: price,
          deadline: BigInt(deadlineSec),
        },
      });
      const headerValue = encodePaymentHeader({
        callId,
        paymentHash,
        signature,
        caller: address,
        callerTBA,
        maxAmount: price,
        deadline: deadlineSec,
      });
      const body = packBodyForCategory(selectedSkill.category, query);

      const resp = await fetch(selectedSkill.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Payment": headerValue,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await safeText(resp);
        throw new Error(`service ${resp.status}: ${errText}`);
      }
      const data = (await resp.json()) as unknown;

      setResult({
        callId: callId.toString(),
        paymentHash,
        approveTxHash,
        escrowTxHash,
        paidAmount: price,
        durationMs: Date.now() - t0,
        data,
        skillName: selectedSkill.name,
        skillId: selectedSkill.skillId,
        category: selectedSkill.category,
        soulTokenId: selectedSoul.tokenId,
        callerTBA: selectedSoul.tba,
      });
      setStep("done");
    } catch (err) {
      const msg =
        (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
      setError(msg);
      setStep("error");
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // UI
  // ──────────────────────────────────────────────────────────────────────

  return (
    <div className="relative overflow-hidden">
      <div
        className="neon-streak"
        data-color="cyan"
        style={{
          top: "240px",
          left: "10%",
          width: "80%",
          height: "5px",
          transform: "rotate(-6deg)",
          opacity: 0.35,
        }}
      />
      <div
        className="neon-streak"
        data-color="violet"
        style={{
          top: "780px",
          left: "8%",
          width: "84%",
          height: "5px",
          transform: "rotate(7deg)",
          opacity: 0.4,
        }}
      />

      <div className="relative max-w-7xl mx-auto px-8 pt-12 pb-24">
        <header className="mb-10 space-y-4 max-w-2xl animate-fade-in">
          <span className="pill-live">{t("run.pill")}</span>
          <h1 className="display text-4xl md:text-5xl">{t("run.title")}</h1>
          <p className="text-ink-dim leading-relaxed">{t("run.subtitle")}</p>
        </header>

        {/* 模式切换 —— Manual = 老的手动选 Soul + Skill；Smart = 自然语言 → planner LLM 拆解 → 并行调用 */}
        <div className="mb-8 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.13em] text-ink-faint font-mono">
            Mode:
          </span>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`px-3 py-1 rounded-full text-[11px] font-mono transition-colors border ${
              mode === "manual"
                ? "border-cyan/60 bg-cyan/10 text-cyan"
                : "border-border bg-bg/40 text-ink-dim hover:border-soul/40"
            }`}
          >
            {t("run.mode.manual")}
          </button>
          <button
            type="button"
            onClick={() => setMode("smart")}
            className={`px-3 py-1 rounded-full text-[11px] font-mono transition-colors border ${
              mode === "smart"
                ? "border-magenta/60 bg-magenta/10 text-magenta"
                : "border-border bg-bg/40 text-ink-dim hover:border-soul/40"
            }`}
          >
            {t("run.mode.smart")}
          </button>
        </div>

        {/* Connection / chain guard */}
        {!isConnected && <ConnectPrompt />}
        <WrongChainBanner />

        {/* Smart 模式 —— 接 /api/orchestrate（已有 plan + execute + aggregate）*/}
        {isConnected && !wrongChain && mode === "smart" && (
          <SmartRunPanel
            tokenId={selectedTokenId}
            souls={souls}
            onPickSoul={onPickSoul}
            initialQuery={queryPrefill}
          />
        )}

        {isConnected && !wrongChain && mode === "manual" && (
          <div className="grid lg:grid-cols-[480px_1fr] gap-6 items-start">
            {/* Left column */}
            <div className="space-y-5">
              {/* Soul picker */}
              <div className="surface p-5 space-y-4">
                <div className="flex items-baseline justify-between gap-3">
                  <label className="label">Pick your Soul</label>
                  <button
                    onClick={refetchSouls}
                    className="text-[10px] uppercase tracking-[0.13em] text-ink-faint hover:text-cyan font-mono"
                  >
                    refresh
                  </button>
                </div>

                {soulsLoading && (
                  <div className="text-sm text-ink-dim">Scanning Transfer logs…</div>
                )}
                {soulsError && (
                  <div className="text-xs text-magenta font-mono break-all">
                    {soulsError}
                  </div>
                )}
                {!soulsLoading && souls.length === 0 && (
                  <div className="rounded-md border border-soul/30 bg-soul/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-soul-soft text-lg">◈</span>
                      <span className="text-sm font-medium text-ink">
                        {t("run.no_soul.title")}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-dim leading-relaxed">
                      {t("run.no_soul.desc")}
                    </p>
                    <Link
                      href="/mint"
                      className="inline-block text-[12px] font-mono text-soul-soft hover:text-magenta underline underline-offset-2"
                    >
                      {t("run.no_soul.cta")}
                    </Link>
                  </div>
                )}
                {souls.length > 0 && (
                  <div className="space-y-2">
                    {souls.map((s) => (
                      <SoulPick
                        key={s.tokenId.toString()}
                        soul={s}
                        selected={selectedTokenId === s.tokenId}
                        onPick={onPickSoul}
                      />
                    ))}
                  </div>
                )}

                {selectedSoul && (
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border">
                    <Stat
                      value={
                        usdcBalance !== undefined
                          ? Number(
                              formatUnits(usdcBalance, USDC_DECIMALS),
                            ).toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })
                          : "—"
                      }
                      label="USDC Balance"
                      color="text-ink"
                    />
                    <Stat
                      value={attCount !== undefined ? attCount.toString() : "—"}
                      label="Attestations"
                      color="text-magenta"
                    />
                  </div>
                )}
              </div>

              {/* Skill picker */}
              <div className="surface p-5 space-y-4">
                <label className="label">Pick a Skill</label>
                {skills.length === 0 ? (
                  <div className="text-sm text-ink-dim space-y-2">
                    <div>No active skills on-chain yet. Two ways to register:</div>
                    <ul className="text-[12px] font-mono text-ink-faint space-y-1 list-disc list-inside">
                      <li>
                        <code className="text-cyan">pneuma serve --skill-id N</code>{" "}
                        — Pneuma-native skill registration
                      </li>
                      <li>
                        <code className="text-cyan">pneuma anet bootstrap</code> +{" "}
                        <code className="text-cyan">pneuma anet register-x402-skill</code>{" "}
                        — bring an existing Agent Network skill into Pneuma
                      </li>
                    </ul>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {skills.map((sk) => (
                      <SkillPick
                        key={sk.skillId.toString()}
                        skill={sk}
                        selected={selectedSkillId === sk.skillId}
                        onPick={onPickSkill}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Query + Run */}
              <div className="surface p-5 space-y-4">
                <label className="label">Your input</label>
                <textarea
                  className="input min-h-[120px] resize-y font-sans text-sm leading-relaxed"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    selectedSkill?.category === "finance"
                      ? "ETH | BTC | SOL | USDC | ARC"
                      : selectedSkill?.category === "text"
                      ? "Paste any text to summarize…"
                      : "Free-form input or JSON body"
                  }
                  disabled={isBusy(step)}
                />
                <button
                  type="button"
                  onClick={run}
                  disabled={
                    isBusy(step) ||
                    !selectedSoul ||
                    !selectedSkill ||
                    query.trim().length === 0
                  }
                  className="btn-primary w-full text-sm"
                >
                  {step === "approving"
                    ? "1/3 · Sign approve…"
                    : step === "escrowing"
                    ? "2/3 · Sign escrow…"
                    : step === "calling"
                    ? "3/3 · Calling service…"
                    : "▶ Run with my wallet"}
                </button>

                {error && (
                  <div className="text-xs text-magenta bg-magenta/10 border border-magenta/40 rounded-md p-3 break-words font-mono">
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-5 min-h-[400px]">
              {step === "idle" && !result && <PlaceholderPanel />}
              {isBusy(step) && (
                <LoadingPanel step={step} skill={selectedSkill?.name ?? "skill"} />
              )}
              {result && <ResultPanel result={result} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function ConnectPrompt() {
  return (
    <div className="surface-glow p-12 max-w-2xl mx-auto text-center space-y-4">
      <div className="text-4xl">⬡</div>
      <h2 className="display text-2xl">Connect a wallet to call a skill</h2>
      <p className="text-ink-dim text-sm">
        x402 escrow + service call are signed from your MetaMask. No session keys, no
        custodian.
      </p>
    </div>
  );
}

// React.memo + 稳定 onPick → 点击其它 Soul 不会让本卡重渲染
const SoulPick = memo(function SoulPick({
  soul,
  selected,
  onPick,
}: {
  soul: SoulSummary;
  selected: boolean;
  onPick: (id: bigint) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(soul.tokenId)}
      className={`w-full text-left p-3 rounded-md border transition-all ${
        selected
          ? "border-cyan bg-cyan/5"
          : "border-border bg-bg hover:border-soul/40 hover:bg-soul/5"
      }`}
    >
      <div className="flex items-baseline gap-3">
        <span
          className={`text-[11px] font-mono ${
            selected ? "text-cyan" : "text-ink-dim"
          }`}
        >
          #{soul.tokenId.toString()}
        </span>
        <span className="text-ink font-medium truncate">
          {soul.agentName || "Unnamed Agent"}
        </span>
      </div>
      <div className="text-[10px] font-mono text-ink-faint mt-1 break-all">
        TBA {soul.tba.slice(0, 8)}…{soul.tba.slice(-6)}
      </div>
    </button>
  );
});

// React.memo + 稳定 onPick → 点击其它 Skill 不会让本卡重渲染
const SkillPick = memo(function SkillPick({
  skill,
  selected,
  onPick,
}: {
  skill: SkillRow;
  selected: boolean;
  onPick: (id: bigint) => void;
}) {
  const tag =
    skill.category === "finance"
      ? "tag-cyan"
      : skill.category === "text"
      ? "tag-soul"
      : "tag";
  return (
    <button
      type="button"
      onClick={() => onPick(skill.skillId)}
      className={`w-full text-left p-3 rounded-md border transition-all ${
        selected
          ? "border-magenta bg-magenta/5"
          : "border-border bg-bg hover:border-soul/40 hover:bg-soul/5"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ink font-medium">{skill.name}</span>
        <span className="text-soul-soft text-[11px] font-mono">
          {formatUnits(skill.pricePerCall, USDC_DECIMALS)} USDC
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className={tag}>
          #{skill.skillId.toString()} · {skill.category}
        </span>
        <span className="text-[10px] text-ink-faint truncate">
          {skill.description}
        </span>
      </div>
    </button>
  );
});

function PlaceholderPanel() {
  const { t } = useI18n();
  const bullets = [
    t("run.placeholder.b1"),
    t("run.placeholder.b2"),
    t("run.placeholder.b3"),
    t("run.placeholder.b4"),
  ];
  return (
    <div className="surface-glow p-8 md:p-10 flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="text-magenta text-2xl">⬡</span>
        <h3 className="display text-xl">{t("run.placeholder.title")}</h3>
      </div>
      <ul className="space-y-2.5">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-sm text-ink leading-relaxed"
          >
            <span className="text-cyan font-mono mt-0.5 shrink-0">›</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="pt-4 border-t border-border">
        <p className="text-[12px] text-ink-dim leading-relaxed font-mono">
          {t("run.placeholder.hint")}
        </p>
      </div>
    </div>
  );
}

function LoadingPanel({ step, skill }: { step: Step; skill: string }) {
  const stepLabel: Record<Exclude<Step, "idle" | "done" | "error">, string> = {
    approving: "Approving USDC allowance",
    escrowing: "Escrowing funds on SkillRegistry",
    calling: `Calling ${skill}`,
  };
  return (
    <div className="surface-gradient p-10 text-center flex flex-col items-center gap-4 animate-fade-in">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2.5 h-2.5 rounded-full bg-cyan animate-pulse-dot"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <h3 className="display text-2xl">
        {stepLabel[step as keyof typeof stepLabel] ?? "Working…"}
      </h3>
      <div className="text-[11px] uppercase tracking-[0.13em] text-magenta font-mono">
        Approve · Escrow · Fetch · Settle · Attest
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: RunSuccess }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="surface-gradient p-6 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.13em] text-cyan font-mono flex items-center gap-2">
          <span>✓</span> Settled — Soul #{result.soulTokenId.toString()} got a new
          attestation
        </div>
        <pre className="bg-bg p-4 rounded font-mono text-[12px] text-ink-dim overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(result.data, null, 2)}
        </pre>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat
          value={`${formatUnits(result.paidAmount, 6)} USDC`}
          label="Paid by you"
          color="text-soul-soft"
        />
        <Stat
          value={`${(result.durationMs / 1000).toFixed(1)}s`}
          label="End-to-end"
          color="text-ink"
        />
        <Stat
          value={`#${result.callId}`}
          label="On-chain callId"
          color="text-cyan"
        />
      </div>

      <div className="surface p-5 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.13em] text-magenta font-mono">
          Transactions
        </div>
        {result.approveTxHash && (
          <TxRow label="approve" hash={result.approveTxHash} />
        )}
        <TxRow label="escrowForCall" hash={result.escrowTxHash} />
        <div className="text-[10px] text-ink-faint font-mono break-all border-t border-border/60 pt-2">
          paymentHash {result.paymentHash.slice(0, 16)}…{result.paymentHash.slice(-8)}
          <br />
          recipient TBA {result.callerTBA.slice(0, 10)}…{result.callerTBA.slice(-6)}
        </div>
      </div>

      {/* Caller 反向评分（multi-rater attestation 闭环） */}
      <CallerRatePanel callId={BigInt(result.callId)} skillName={result.skillName} />

      <div className="surface p-5 text-sm text-ink-dim space-y-2">
        <div className="text-[11px] uppercase tracking-[0.13em] text-cyan font-mono">
          What just happened
        </div>
        <ol className="space-y-1 text-[12px] leading-relaxed list-decimal list-inside">
          <li>
            Your wallet signed approve + escrow. Service never saw your private key.
          </li>
          <li>
            Service verified callId on SkillRegistry, ran the handler, settled — moving
            USDC to its owner & writing an on-chain attestation.
          </li>
          <li>
            Attestation is keyed by your Soul TBA (CREATE2-derived). Transfer the SOUL
            NFT to anyone — history follows.
          </li>
        </ol>
        <Link
          href={`/profile/${result.soulTokenId.toString()}`}
          className="inline-block text-soul-soft underline underline-offset-2 text-[12px]"
        >
          See it on /profile/{result.soulTokenId.toString()} →
        </Link>
      </div>
    </div>
  );
}

/**
 * CallerRatePanel — caller 反向给 skill provider 打分
 *
 * 兑现 multi-rater attestation 的闭环：
 *   - settle 时 provider 已经给 caller 打分（写 PROVIDER attestation）
 *   - 这里 caller 给 provider 反向打分（写 CALLER attestation）
 *   - 双向声誉，刷分等于打自己
 *
 * 状态机：未评 → 选星 → 提交（钱包签）→ 链上确认 → 已评
 */
/// 链上 comment 字段长度上限（与 PneumaAttestation.MAX_COMMENT_LENGTH 对齐）
const MAX_COMMENT_LENGTH = 280;

function CallerRatePanel({ callId, skillName }: { callId: bigint; skillName: string }) {
  const [hover, setHover] = useState(0);
  const [picked, setPicked] = useState(0);
  const [comment, setComment] = useState("");
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { data: alreadyRated, refetch: refetchRated } = useReadContract({
    address: SKILL_REGISTRY,
    abi: SkillRegistryAbi,
    functionName: "callerHasRated",
    args: [callId],
    query: { refetchInterval: 6000 },
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateTxHash, setRateTxHash] = useState<Hex | null>(null);

  if (alreadyRated || rateTxHash) {
    return (
      <div className="surface p-5 space-y-2 border-cyan/30">
        <div className="text-[11px] uppercase tracking-[0.13em] text-cyan font-mono">
          ✓ You rated this skill — multi-rater attestation closed
        </div>
        <p className="text-[12px] text-ink-dim leading-relaxed">
          Your rating was written on-chain as a CALLER-role attestation
          (raterRole=1) on {skillName}. Provider's reputation now blends
          provider-rated + caller-rated stars.
        </p>
        {rateTxHash && (
          <a
            href={txUrl(rateTxHash)}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono text-soul-soft underline underline-offset-2"
          >
            tx {rateTxHash.slice(0, 12)}…{rateTxHash.slice(-8)} ↗
          </a>
        )}
      </div>
    );
  }

  async function submit() {
    if (picked < 1 || picked > 5) return;
    if (!publicClient) return;
    setError(null);
    setSubmitting(true);
    try {
      const hash = await writeContractAsync({
        address: SKILL_REGISTRY,
        abi: SkillRegistryAbi,
        functionName: "callerRateSkill",
        args: [callId, picked, comment.trim()],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setRateTxHash(hash);
      await refetchRated();
    } catch (err) {
      setError(
        (err as { shortMessage?: string }).shortMessage ?? (err as Error).message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface p-5 space-y-3 border-magenta/30">
      <div className="text-[11px] uppercase tracking-[0.13em] text-magenta font-mono">
        Rate {skillName}
      </div>
      <p className="text-[12px] text-ink-dim leading-relaxed">
        You paid for this. Now you grade the provider.{" "}
        <span className="text-ink">Caller-rated attestation</span> closes the
        double-blind feedback loop — provider can't self-stuff stars when callers
        rate too.
      </p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = (hover || picked) >= n;
          return (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setPicked(n)}
              disabled={submitting}
              className={`text-2xl transition-colors ${
                active ? "text-magenta" : "text-ink-faint"
              } hover:scale-110`}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
            >
              ★
            </button>
          );
        })}
        <span className="ml-2 text-[11px] text-ink-dim font-mono">
          {picked > 0 ? `${picked} / 5` : "pick a rating"}
        </span>
      </div>

      {/* v3 comment 输入 — 让真用户写文字反馈，star 之外的高信息密度信号 */}
      <div className="space-y-1">
        <label
          htmlFor={`comment-${callId.toString()}`}
          className="block text-[10px] uppercase tracking-[0.13em] text-ink-dim font-mono"
        >
          Optional review · max {MAX_COMMENT_LENGTH} chars
        </label>
        <textarea
          id={`comment-${callId.toString()}`}
          rows={3}
          maxLength={MAX_COMMENT_LENGTH}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={submitting}
          placeholder="What worked? What broke? Future callers will read this on-chain."
          className="w-full text-[12px] bg-bg border border-border rounded-md p-2 font-mono text-ink placeholder:text-ink-faint focus:outline-none focus:border-magenta/60 resize-none"
        />
        <div className="text-right text-[10px] font-mono text-ink-faint">
          {comment.length} / {MAX_COMMENT_LENGTH}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={picked < 1 || submitting}
        className="btn-primary w-full text-sm"
      >
        {submitting ? "Signing…" : "Submit rating + review to chain"}
      </button>
      {error && (
        <div className="text-xs text-magenta bg-magenta/10 border border-magenta/40 rounded-md p-3 break-words font-mono">
          {error}
        </div>
      )}
    </div>
  );
}

function TxRow({ label, hash }: { label: string; hash: Hex }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] font-mono">
      <span className="text-ink-dim">{label}</span>
      <a
        href={txUrl(hash)}
        target="_blank"
        rel="noreferrer"
        className="text-soul-soft hover:text-magenta underline underline-offset-2 truncate"
      >
        {hash.slice(0, 12)}…{hash.slice(-8)} ↗
      </a>
    </div>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="surface p-4">
      <div className={`stat-value text-2xl ${color}`}>{value}</div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function isBusy(step: Step): boolean {
  return step === "approving" || step === "escrowing" || step === "calling";
}

function randomBytes32(): Hex {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return ("0x" +
    Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as Hex;
}

function encodePaymentHeader(args: {
  callId: bigint;
  paymentHash: Hex;
  signature: Hex;
  caller: Address;
  callerTBA: Address;
  maxAmount: bigint;
  deadline: number;
}): string {
  // x402 header v5: base64(JSON.stringify(payload))，含 EIP-712 完整字段
  // server 端 PneumaMiddleware.verifyPayment 会做：
  //   1) 链上 verifyCall(callId, paymentHash, skillId)
  //   2) EIP-712 verifyPaymentAuth(signature, expectedCaller=链上 c.caller)
  const payload = {
    x402Version: 1,
    scheme: "pneuma-ec-escrow",
    callId: args.callId.toString(),
    paymentHash: args.paymentHash,
    signature: args.signature,
    caller: args.caller,
    callerTBA: args.callerTBA,
    maxAmount: args.maxAmount.toString(),
    deadline: args.deadline,
  };
  // 浏览器原生 btoa 只接 ASCII，这里 payload 全 ASCII 安全
  return btoa(JSON.stringify(payload));
}

/**
 * 从 escrow tx receipt 里解 callId
 *
 * CallEscrowed event：
 *   event CallEscrowed(uint256 indexed callId, uint256 indexed skillId, address indexed caller, ...)
 * topic[0] = event sig
 * topic[1] = callId（indexed）
 *
 * 这里只取第一个 SkillRegistry 发出的 log，hackathon 简化（一次 escrow 一个 callId）
 */
function parseCallIdFromReceipt(
  logs: { address: string; topics: readonly Hex[] }[],
): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== SKILL_REGISTRY.toLowerCase()) continue;
    if (log.topics.length < 2) continue;
    return BigInt(log.topics[1]);
  }
  return null;
}

/**
 * 不同 category skill 接受的 body shape 不同；hackathon 阶段做一次智能包装
 *   - finance: { symbol }
 *   - text:    { text }
 *   - 其他:    如果 query 已是 JSON 直接 parse；否则当 prompt 字段
 *
 * 让用户在表单里只填关键内容，不用关心 JSON 结构。
 */
function packBodyForCategory(category: string, query: string): Record<string, unknown> {
  const trimmed = query.trim();
  if (category === "finance") {
    return { symbol: trimmed.toUpperCase() };
  }
  if (category === "text") {
    return { text: trimmed };
  }
  // 通用 fallback：JSON 优先，否则 { input }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // fallthrough
    }
  }
  return { input: trimmed };
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "(no body)";
  }
}

// publicClient 的类型只在编译期需要，这里用类型断言来抚平 wagmi 返回的 union
// 不直接 import 是为了避免 ts-eslint 提示 unused
export type _PublicClient = PublicClient;

// ──────────────────────────────────────────────────────────────────────
//  Smart mode —— 自然语言 → planner LLM → 多 skill 并行调用
// ──────────────────────────────────────────────────────────────────────

interface OrchestrateResponse {
  query: string;
  callerTBA: string;
  plan: {
    reasoning: string;
    steps: Array<{
      skillId: number;
      reason: string;
      body: Record<string, unknown>;
    }>;
  };
  results: Array<{
    skillId: number;
    skillName: string;
    success: boolean;
    data: unknown;
    error: string | null;
    callId: string | null;
    paidAmount: string | null;
    escrowTxHash: string | null;
    durationMs: number;
  }>;
  answer: string;
}

/**
 * SmartRunPanel —— 自然语言模式
 *
 * 用户输入一句话 → POST /api/orchestrate（已有 server-side bridge）：
 *   1. discoverSkills 拉链上 SkillRegistry
 *   2. plan() 让 LLM 拆解为 N 步 skill 调用
 *   3. Executor.executeParallel 并行 escrow + call + settle
 *   4. aggregate() 把多个结果聚合成单段最终答案
 *
 * 注意：当前 /api/orchestrate 用 server-side DEPLOYER_PRIVATE_KEY 签 escrow
 * （demo 简化）。真实生产应改成 user wallet 直签——架构没破，只是 UX 路径替换。
 */
function SmartRunPanel({
  tokenId,
  souls,
  onPickSoul,
  initialQuery = "",
}: {
  tokenId: bigint | null;
  souls: SoulSummary[];
  onPickSoul: (id: bigint) => void;
  /** /discover 一键执行跳过来时预填的 query */
  initialQuery?: string;
}) {
  const [input, setInput] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<OrchestrateResponse | null>(null);

  async function run() {
    if (!tokenId || input.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setResp(null);
    try {
      const r = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: input.trim(),
          tokenId: Number(tokenId),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setResp(data as OrchestrateResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[480px_1fr] gap-6 items-start">
      {/* Left: Soul picker + input */}
      <div className="space-y-5">
        <div className="surface p-5 space-y-4">
          <label className="label">Pick your Soul</label>
          {souls.length === 0 ? (
            <div className="text-sm text-ink-dim leading-relaxed">
              No Soul yet on this wallet.{" "}
              <Link
                href="/mint"
                className="text-soul-soft underline underline-offset-2"
              >
                Mint one first →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {souls.map((s) => (
                <SoulPick
                  key={s.tokenId.toString()}
                  soul={s}
                  selected={tokenId === s.tokenId}
                  onPick={onPickSoul}
                />
              ))}
            </div>
          )}
        </div>

        <div className="surface p-5 space-y-4">
          <label className="label flex items-center justify-between">
            <span>What do you want to do?</span>
            <span className="text-[10px] text-magenta font-mono uppercase tracking-wider">
              ⚡ planner LLM 自动选 skill
            </span>
          </label>
          <textarea
            className="input min-h-[120px] resize-y font-sans text-sm leading-relaxed"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例：查 ETH 当前价格，再用一句话总结这段..."
            disabled={busy}
          />
          <button
            type="button"
            onClick={run}
            disabled={busy || !tokenId || input.trim().length === 0}
            className="btn-primary w-full text-sm"
          >
            {busy
              ? "Planning + executing..."
              : "▶ 让 planner 拆任务并并行结算"}
          </button>
          {error && (
            <div className="text-xs text-magenta bg-magenta/10 border border-magenta/40 rounded-md p-3 break-words font-mono">
              {error}
            </div>
          )}
          <p className="text-[10px] text-ink-faint font-mono leading-relaxed">
            planner 会读链上 skill 列表 + 真用户评论，挑 N 个并行调用 + 聚合答案。
            每个 skill 独立 escrow / settle / 链上 attestation。
          </p>
        </div>
      </div>

      {/* Right: Plan + results + final answer */}
      <div className="space-y-4">
        {!resp && !busy && (
          <div className="surface-glow p-12 text-center flex flex-col items-center gap-3">
            <div className="text-magenta text-3xl">⚡</div>
            <h3 className="display text-xl">Smart mode</h3>
            <p className="text-ink-dim text-sm max-w-md leading-relaxed">
              Type a natural-language task on the left. The planner LLM will
              break it into atomic skill calls and execute them in parallel
              against on-chain registered services.
            </p>
          </div>
        )}

        {busy && (
          <div className="surface-glow p-8 text-center font-mono text-sm text-cyan animate-pulse">
            Planner 正在拆解任务...
          </div>
        )}

        {resp && (
          <>
            <div className="surface p-5 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
                Plan · 拆解为 {resp.plan.steps.length} 步
              </div>
              <p className="text-sm text-ink-dim italic leading-relaxed">
                {resp.plan.reasoning}
              </p>
              <div className="space-y-2 font-mono text-[11px]">
                {resp.plan.steps.map((step, i) => (
                  <div
                    key={i}
                    className="bg-bg/40 border border-border rounded p-2"
                  >
                    <div className="text-magenta">
                      {String(i + 1).padStart(2, "0")} → skill #{step.skillId}
                    </div>
                    <div className="text-ink-dim mt-1">{step.reason}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface p-5 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.13em] text-cyan font-mono">
                Parallel x402 execution · {resp.results.filter((r) => r.success).length} / {resp.results.length} ✓
              </div>
              <div className="space-y-2">
                {resp.results.map((r) => (
                  <div
                    key={r.skillId}
                    className="surface px-3 py-2 flex items-center gap-3 text-[12px] font-mono"
                  >
                    <span
                      className={r.success ? "text-cyan" : "text-magenta"}
                    >
                      {r.success ? "✓" : "✗"}
                    </span>
                    <span className="text-ink flex-1 truncate">
                      {r.skillName}
                    </span>
                    {r.paidAmount && (
                      <span className="text-soul-soft text-[11px]">
                        {(Number(r.paidAmount) / 1e6).toFixed(4)} USDC
                      </span>
                    )}
                    <span className="text-ink-faint text-[10px]">
                      {r.durationMs}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface-gradient p-5 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.13em] text-magenta">
                Final answer · aggregated
              </div>
              <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
                {resp.answer}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
