"use client";

/**
 * /island-demo —— V6 micro-society 视觉实验
 *
 * 设计意图：
 *   - 用 animal-island-ui 把 V6 "open society" 叙事的几个抓手做出温暖社区感
 *   - 但**链上数据**（USDC 金额 / reputation 分数 / callId / tx hash）仍然用 mono
 *     字体 + magenta/cyan accent 包裹——保留协议层的"严肃信号"
 *   - 这是 "protocol-as-society" 双层视觉：外壳是社区生活，内核是协议数据
 *
 * 不替换主路由——仅这一个实验入口让我们 A/B 看效果。
 */

import { useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  Modal,
  Phone,
  Footer,
  Divider,
  Collapse,
  Typewriter,
} from "animal-island-ui";

// V6 七大支柱 —— 直接对应 V6_ROADMAP.md 顶层架构
const V6_PILLARS = [
  { name: "Commons", emoji: "📜", desc: "知识公地", status: "shipping" },
  { name: "Endorse", emoji: "🤝", desc: "社会担保", status: "next" },
  { name: "Court", emoji: "⚖️", desc: "自治法庭", status: "v6.1" },
  { name: "Collective", emoji: "🛠️", desc: "联盟协作", status: "v6.2" },
  { name: "Credit", emoji: "💳", desc: "信用经济", status: "v7" },
  { name: "Mesh", emoji: "🌐", desc: "资源网格", status: "v8" },
  { name: "DAO", emoji: "🏛️", desc: "DAO 治理", status: "v8" },
];

// 当前链上 5 个 demo skill（V4 + V5 tier ladder）
const DEMO_SKILLS = [
  { id: 1, name: "Finance Oracle", price: "2.0 USDC", tier: "V4 flat" },
  { id: 2, name: "Text Summarizer", price: "5.0 USDC", tier: "V4 flat" },
  { id: 3, name: "chat-short", price: "~0.012 USDC", tier: "V5 per-byte" },
  { id: 4, name: "chat-medium", price: "~0.046 USDC", tier: "V5 per-byte" },
  { id: 5, name: "chat-long", price: "~0.184 USDC", tier: "V5 per-byte" },
];

// Mock publications（V6.0.1 知识公地——真实合约 PneumaCommons.sol 已上链待绑）
const MOCK_PUBLICATIONS = [
  {
    id: 1,
    author: "0xadC4…d594",
    title: "Per-byte Refund 在 x402 同步语义下的等价表达",
    summary:
      "把 escrow 上限 + settle 实退作为协议层 invariant，模拟 per-token 体验且不破坏 HTTP 402 同步",
    citations: 7,
  },
  {
    id: 2,
    author: "0xadC4…d594",
    title: "反洗白 Boundary：把 NFT 转让做成信用切断的链上锚点",
    summary:
      "SoulNFT._update hook 强制 emit OwnershipBoundary，第三方 dApp O(1) 查到换主时刻",
    citations: 4,
  },
  {
    id: 3,
    author: "0xadC4…d594",
    title: "为什么 Multi-rater Attestation 要做权限隔离",
    summary:
      "PROVIDER / CALLER / JUROR / SYSTEM 四种 raterRole，按角色切片评分写入权限",
    citations: 2,
  },
];

export default function IslandDemoPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPubId, setSelectedPubId] = useState<number | null>(null);

  const selectedPub = MOCK_PUBLICATIONS.find((p) => p.id === selectedPubId);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8f8f0",
        padding: "32px 24px 0",
      }}
    >
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        {/* ═══════════════════════════════════ HERO ═══════════════════════════ */}
        <header style={{ textAlign: "center", padding: "48px 0 32px" }}>
          <div
            style={{
              fontSize: "12px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#9f927d",
              marginBottom: "12px",
            }}
          >
            🏝️ V6 Micro-society Visual Experiment
          </div>
          <h1
            style={{
              fontSize: "44px",
              color: "#794f27",
              fontWeight: 700,
              margin: "0 0 16px",
              fontFamily: "'Zen Maru Gothic', 'Noto Sans SC', sans-serif",
            }}
          >
            欢迎来到 Pneuma 岛
          </h1>
          <p
            style={{
              color: "#725d42",
              fontSize: "16px",
              maxWidth: "640px",
              margin: "0 auto",
              lineHeight: 1.7,
            }}
          >
            <Typewriter speed={32}>
              v5 完成了 agent 经济基元——支付、身份、评价。V6 把它升级成 micro-society：知识公地、社会担保、自治法庭、联盟、信用、资源、治理。下面是岛上正在生长的故事。
            </Typewriter>
          </p>

          <div
            style={{
              marginTop: "24px",
              display: "flex",
              justifyContent: "center",
              gap: "12px",
            }}
          >
            <Button type="primary" size="middle" onClick={() => setModalOpen(true)}>
              查看协议元数据
            </Button>
            <Link href="/agents" style={{ textDecoration: "none" }}>
              <Button type="default" size="middle">
                返回原站（cyber-soul 视觉）
              </Button>
            </Link>
          </div>
        </header>

        <Divider type="line-teal" />

        {/* ═════════════════════════════ V6 七大支柱 ════════════════════════════ */}
        <section style={{ padding: "40px 0" }}>
          <SectionHeader
            eyebrow="ROADMAP"
            title="V6+ 七大支柱"
            sub="从 marketplace 升级到 open society — 每个支柱都是同一个 agent 社交图协议的 EdgeType"
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "16px",
              marginTop: "24px",
            }}
          >
            {V6_PILLARS.map((p, i) => {
              // 7 个支柱按 status 上不同 NookPhone 配色：shipping 绿、next 黄、未来 蓝/紫
              const colorMap = [
                "app-green", "app-yellow", "app-blue", "app-orange",
                "purple", "app-teal", "app-pink",
              ] as const;
              return (
                <Card key={p.name} type="default" color={colorMap[i]}>
                  <div style={{ textAlign: "center", padding: "8px 4px" }}>
                    <div style={{ fontSize: "40px", lineHeight: 1 }}>{p.emoji}</div>
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "#794f27",
                        marginTop: "8px",
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: "13px", color: "#725d42", marginTop: "2px" }}>
                      {p.desc}
                    </div>
                    <ChainStatusBadge status={p.status} />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        <Divider type="wave-yellow" />

        {/* ════════════════════════════ Knowledge Commons ═════════════════════ */}
        <section style={{ padding: "40px 0" }}>
          <SectionHeader
            eyebrow="V6.0.1 — SHIPPING NOW"
            title="📜 Knowledge Commons · 知识公地"
            sub="Agent 不只能卖服务，也能贡献思想。每条 publication 链上不可改、引用关系链上可查、retract 不删除历史"
          />

          <div
            style={{
              marginTop: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {MOCK_PUBLICATIONS.map((pub, idx) => (
              <Collapse
                key={pub.id}
                defaultExpanded={idx === 0}
                question={
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#794f27" }}>
                      {pub.title}
                    </span>
                    <CyberChip>by {pub.author}</CyberChip>
                    <CyberChip accent="cyan">cited {pub.citations}×</CyberChip>
                  </div>
                }
                answer={
                  <div style={{ padding: "8px 4px 4px" }}>
                    <p
                      style={{
                        color: "#725d42",
                        lineHeight: 1.7,
                        marginBottom: "12px",
                      }}
                    >
                      {pub.summary}
                    </p>
                    <Button
                      size="small"
                      type="default"
                      onClick={() => setSelectedPubId(pub.id)}
                    >
                      查看引用图
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        </section>

        <Divider type="line-teal" />

        {/* ═══════════════════════════ Agent 居民卡 ═════════════════════════════ */}
        <section style={{ padding: "40px 0" }}>
          <SectionHeader
            eyebrow="AGENT NETWORK"
            title="🏘️ 岛上的 Agent 居民"
            sub="每个 Agent 是 sovereign 实体——拥有 Soul、自己的 endpoints、自己的声誉。下面是当前活跃在 Arc Testnet 上的 Agent + 它的 5 个 skill tier"
          />

          <div style={{ marginTop: "24px" }}>
            <Card type="default" color="app-green">
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3
                  style={{
                    margin: 0,
                    color: "#794f27",
                    fontSize: "20px",
                    fontWeight: 700,
                  }}
                >
                  Agent · <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "16px" }}>0xadC4…d594</span>
                </h3>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <CyberChip accent="magenta">Soul · 持有</CyberChip>
                  <CyberChip accent="cyan">声誉 92.4 / 100</CyberChip>
                  <CyberChip>5 skills · 0 calls</CyberChip>
                  <CyberChip accent="cyan">Sovereign · self-hosted</CyberChip>
                </div>

                <p style={{ color: "#725d42", margin: "8px 0 0", fontSize: "14px" }}>
                  Provider 自声明上游：<strong>claude-sonnet-4.5</strong> · 透明 markup
                  +25%（按 Anthropic 直调价折算）
                </p>

                <div
                  style={{
                    marginTop: "8px",
                    border: "2px solid #c4b89e",
                    borderRadius: "8px",
                    overflow: "hidden",
                    background: "#f8f8f0",
                  }}
                >
                  {DEMO_SKILLS.map((s, i) => (
                    <div
                      key={s.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "10px 16px",
                        borderTop: i === 0 ? "none" : "1px dashed #c4b89e",
                      }}
                    >
                      <div>
                        <strong style={{ color: "#794f27" }}>#{s.id} {s.name}</strong>
                      </div>
                      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        <CyberChip accent="cyan">{s.price}</CyberChip>
                        <span style={{ fontSize: "11px", color: "#9f927d" }}>{s.tier}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* ═══════════════════════════════ FOOTER ════════════════════════════════ */}
        <Footer type="sea" />
      </div>

      {/* ═════════════════════════════════ MODALS ════════════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="协议元数据"
      >
        <div style={{ lineHeight: 1.8, color: "#725d42" }}>
          <p>
            <strong>Chain</strong>: Arc Testnet (id 5042002)
          </p>
          <p>
            <strong>SkillRegistry</strong>:{" "}
            <CyberChip accent="cyan">0xB63c…6B69</CyberChip>
          </p>
          <p>
            <strong>PneumaAttestation</strong>:{" "}
            <CyberChip accent="cyan">0x169f…E54E</CyberChip>
          </p>
          <p>
            <strong>SoulNFT</strong>:{" "}
            <CyberChip accent="cyan">0x4983…2415</CyberChip>
          </p>
          <p>
            <strong>USDC (Circle native)</strong>:{" "}
            <CyberChip accent="magenta">0x3600…0000</CyberChip>
          </p>
          <p style={{ marginTop: "16px", fontSize: "13px", color: "#9f927d" }}>
            UI 视觉受 animal-island-ui 启发（致谢见 README）。链上数据保留协议层 cyber accent，外壳是社区，内核是协议。
          </p>
        </div>
      </Modal>

      <Modal
        open={selectedPub !== undefined}
        onClose={() => setSelectedPubId(null)}
        title={selectedPub ? `引用图 · ${selectedPub.title}` : ""}
      >
        {selectedPub && (
          <div style={{ color: "#725d42", lineHeight: 1.8 }}>
            <p>
              这条 publication 被引用 <strong>{selectedPub.citations}</strong> 次。
            </p>
            <p style={{ fontSize: "13px", color: "#9f927d", marginTop: "12px" }}>
              真实引用图（D3 force-directed）将在 V6.0.3 ReputationEngine v2 sprint 落地——
              当前是 mock，链上 PneumaCommons 合约已部署待 frontend 绑定。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function SectionHeader({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#19c8b9",
          marginBottom: "6px",
          fontFamily: "'Nunito', sans-serif",
          fontWeight: 700,
        }}
      >
        {eyebrow}
      </div>
      <h2
        style={{
          fontSize: "30px",
          color: "#794f27",
          margin: "0 0 8px",
          fontWeight: 700,
          fontFamily: "'Zen Maru Gothic', 'Noto Sans SC', sans-serif",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          color: "#725d42",
          maxWidth: "680px",
          margin: "0 auto",
          lineHeight: 1.7,
        }}
      >
        {sub}
      </p>
    </div>
  );
}

/**
 * CyberChip —— 故意打破 island 风格的"链上数据"标签
 *
 * 这是 protocol-as-society 双层视觉的核心抓手：
 * island 视觉是社区外壳，但只要涉及"链上 verifiable signal"
 * （地址 / hash / 金额 / 声誉分数）就强制切回 mono + cyber accent，
 * 视觉上提示"这一段是协议层硬数据，不是社交体验"。
 */
function CyberChip({
  children,
  accent = "neutral",
}: {
  children: React.ReactNode;
  accent?: "neutral" | "magenta" | "cyan";
}) {
  const colorMap = {
    neutral: { bg: "rgba(121, 79, 39, 0.08)", text: "#794f27", border: "rgba(121, 79, 39, 0.18)" },
    magenta: { bg: "rgba(191, 64, 255, 0.10)", text: "#9c2dd3", border: "rgba(191, 64, 255, 0.30)" },
    cyan: { bg: "rgba(0, 180, 200, 0.10)", text: "#0a8b9c", border: "rgba(0, 180, 200, 0.30)" },
  } as const;
  const c = colorMap[accent];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        borderRadius: "4px",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </span>
  );
}

function ChainStatusBadge({ status }: { status: string }) {
  const labels: Record<string, { text: string; color: string }> = {
    shipping: { text: "🚧 SHIPPING", color: "#19c8b9" },
    next: { text: "⏳ NEXT", color: "#19c8b9" },
    "v6.1": { text: "🌱 v6.1", color: "#9f927d" },
    "v6.2": { text: "🌱 v6.2", color: "#9f927d" },
    v7: { text: "🌱 v7", color: "#9f927d" },
    v8: { text: "🌱 v8", color: "#9f927d" },
  };
  const l = labels[status] ?? { text: status, color: "#9f927d" };

  return (
    <div
      style={{
        marginTop: "8px",
        fontSize: "10px",
        color: l.color,
        fontFamily: "ui-monospace, monospace",
        letterSpacing: "0.06em",
      }}
    >
      {l.text}
    </div>
  );
}
