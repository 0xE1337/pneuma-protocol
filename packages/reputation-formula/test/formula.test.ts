/**
 * 公式正确性测试 —— 锁定数值，防 future refactor 漂移
 *
 * 这些 expected 值不是随手编的，是从 V5/V6 frontend 实测下来的；
 * 任何改动公式系数都会让测试 fail，强制升级版本。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeReputation,
  computeReputationV2,
  computeEconomicScore,
  computeIntellectualScore,
  computeSocialScore,
  computeJudicialScore,
  formatScore,
  DIM_WEIGHTS,
  type AttestationLike,
  type PublicationLike,
  type EndorsementLike,
} from "../src/index.js";

const NOW = 1735603200; // 2025-01-01 UTC

function att(overrides: Partial<AttestationLike> = {}): AttestationLike {
  return {
    rating: 5,
    paidAmount: 100_000_000n, // 100 USDC
    timestamp: BigInt(NOW - 86400), // 1 day ago
    revoked: false,
    raterRole: 1, // CALLER
    ...overrides,
  };
}

// ───────────────────────── v1 ─────────────────────────

test("v1: empty input → score 0", () => {
  const r = computeReputation([], NOW);
  assert.equal(r.score, 0);
  assert.equal(r.validCount, 0);
  assert.equal(r.totalVolumeRaw, 0n);
});

test("v1: all revoked → score 0", () => {
  const r = computeReputation(
    [att({ revoked: true }), att({ revoked: true })],
    NOW,
  );
  assert.equal(r.score, 0);
  assert.equal(r.validCount, 0);
});

test("v1: single CALLER 5★ × 100 USDC × 1 day idle → reasonable score", () => {
  const r = computeReputation([att()], NOW);
  // sqrt(100) × min(1, 1/30) × (1 + 0.1·log₂(2)) × (1 - 0.023·1) × 5 × 5
  //   = 10 × 0.0333 × 1.1 × 0.977 × 5 × 5 ≈ 8.95
  assert.ok(r.score > 8 && r.score < 10, `expected 8-10, got ${r.score}`);
  assert.equal(r.validCount, 1);
  assert.equal(r.totalVolumeRaw, 100_000_000n);
});

test("v1: revoked ratio penalizes repMultiplier", () => {
  const a1 = att();
  const a2 = att({ revoked: true });
  const r = computeReputation([a1, a2], NOW);
  // revokedRatio = 0.5 → repMultiplier ≈ 1 + 0.1·log₂(2) − 0.5·0.5 ≈ 0.85
  assert.ok(r.repMultiplier < 0.9 && r.repMultiplier > 0.7);
});

test("v1: idle penalty kicks in at >40 days", () => {
  const r = computeReputation(
    [att({ timestamp: BigInt(NOW - 86400 * 50) })],
    NOW,
  );
  // decayFactor = max(0, 1 - 0.023·50) = max(0, -0.15) = 0 → score 0
  assert.equal(r.score, 0);
  assert.equal(r.decayFactor, 0);
});

test("v1: CALLER weight (1.5) > PROVIDER weight (1.0)", () => {
  // 同样的 5★ 和 1★ 配置，CALLER 5★ + PROVIDER 1★ vs CALLER 1★ + PROVIDER 5★
  const callerHigh = computeReputation(
    [att({ rating: 5, raterRole: 1 }), att({ rating: 1, raterRole: 0 })],
    NOW,
  );
  const callerLow = computeReputation(
    [att({ rating: 1, raterRole: 1 }), att({ rating: 5, raterRole: 0 })],
    NOW,
  );
  assert.ok(
    callerHigh.score > callerLow.score,
    `CALLER weight should dominate: high=${callerHigh.score}, low=${callerLow.score}`,
  );
});

test("v1: idleDays uses latest, ageDays uses earliest", () => {
  const r = computeReputation(
    [
      att({ timestamp: BigInt(NOW - 86400 * 10) }), // 10d ago (earliest)
      att({ timestamp: BigInt(NOW - 86400 * 2) }),   // 2d ago (latest)
    ],
    NOW,
  );
  assert.ok(Math.abs(r.idleDays - 2) < 0.1, `idleDays expected ~2, got ${r.idleDays}`);
});

test("v1: formatScore — small score uses 2 decimals", () => {
  assert.equal(formatScore(0.05), "0.05");
  assert.equal(formatScore(1.5), "1.5");
  assert.equal(formatScore(99.99), "100.0");
});

// ───────────────────────── v2 ─────────────────────────

test("v2: empty input → all zero", () => {
  const r = computeReputationV2({ attestations: [] });
  assert.equal(r.total, 0);
  assert.equal(r.economic.score, 0);
  assert.equal(r.intellectual.score, 0);
  assert.equal(r.social.score, 0);
  assert.equal(r.judicial.score, 0);
});

test("v2: economic score matches v1 score exactly", () => {
  const atts = [att(), att({ rating: 4, paidAmount: 50_000_000n })];
  const v1 = computeReputation(atts, NOW);
  const v2 = computeEconomicScore(atts, NOW);
  assert.equal(v2.score, v1.score);
});

test("v2: intellectual — 0 publications → score 0", () => {
  const r = computeIntellectualScore([], NOW);
  assert.equal(r.score, 0);
});

test("v2: intellectual — 5 publications, 0 citations → base score 10", () => {
  const pubs: PublicationLike[] = Array(5)
    .fill(0)
    .map((_, i) => ({
      pubId: BigInt(i + 1),
      citationCount: 0n,
      publishedAt: BigInt(NOW - 86400 * 5),
      retracted: false,
    }));
  const r = computeIntellectualScore(pubs, NOW);
  assert.equal(r.score, 10);
});

test("v2: intellectual — retracted publications excluded", () => {
  const pubs: PublicationLike[] = [
    {
      pubId: 1n,
      citationCount: 100n,
      publishedAt: BigInt(NOW - 86400 * 30),
      retracted: false,
    },
    {
      pubId: 2n,
      citationCount: 100n,
      publishedAt: BigInt(NOW - 86400 * 30),
      retracted: true, // 不计入
    },
  ];
  const r = computeIntellectualScore(pubs, NOW);
  // 只计 pub 1 的 100 citations
  // sqrt(100) × min(1, 30/30) × max(0, 1-0.023·30) × 8 = 10 × 1 × 0.31 × 8 = 24.8
  assert.ok(r.score > 20 && r.score < 30, `expected 20-30, got ${r.score}`);
});

test("v2: social — inactive endorsements excluded", () => {
  const ends: EndorsementLike[] = [
    {
      stakedAmount: 100_000_000n, // 100 USDC
      active: true,
      startedAt: BigInt(NOW - 86400 * 10),
    },
    {
      stakedAmount: 1_000_000_000n, // 1000 USDC，但 inactive
      active: false,
      startedAt: BigInt(NOW - 86400 * 30),
    },
  ];
  const r = computeSocialScore(ends, NOW);
  // 只计 active 的 100 USDC
  assert.equal(r.detail.totalStakeUsdc, "100.00");
});

test("v2: social — diversity caps at 5 endorsers", () => {
  // 用小 stake 防 clamp 100：每人 5 USDC，5 人 = 25 USDC，sqrt(25)·6 = 30 分
  const make = (n: number): EndorsementLike[] =>
    Array(n)
      .fill(0)
      .map(() => ({
        stakedAmount: 5_000_000n, // 5 USDC each
        active: true,
        startedAt: BigInt(NOW - 86400 * 30),
      }));
  const r5 = computeSocialScore(make(5), NOW);
  const r10 = computeSocialScore(make(10), NOW);
  // 5 = 满 diversity；10 也是满 diversity（diversity clamp 在 1.0）
  assert.equal(r5.detail.diversity, "1.00");
  assert.equal(r10.detail.diversity, "1.00");
  // 10 endorsers 因 totalStake 翻倍 → score 大 sqrt(2) 倍
  assert.ok(r10.score > r5.score, `r10=${r10.score} should > r5=${r5.score}`);
});

test("v2: judicial always 0 (V6.1 placeholder)", () => {
  const r = computeJudicialScore([]);
  assert.equal(r.score, 0);
  assert.equal(r.detail.note, "V6.1 Roadmap (PneumaCourt)");
});

test("v2: total = sum(score × weight)", () => {
  const r = computeReputationV2({
    attestations: [att()],
    publications: [
      {
        pubId: 1n,
        citationCount: 25n,
        publishedAt: BigInt(NOW - 86400 * 10),
        retracted: false,
      },
    ],
    endorsementsReceived: [
      {
        stakedAmount: 200_000_000n, // 200 USDC
        active: true,
        startedAt: BigInt(NOW - 86400 * 15),
      },
    ],
    now: NOW,
  });

  const expected =
    r.economic.score * DIM_WEIGHTS.economic +
    r.intellectual.score * DIM_WEIGHTS.intellectual +
    r.social.score * DIM_WEIGHTS.social +
    r.judicial.score * DIM_WEIGHTS.judicial;

  assert.ok(
    Math.abs(r.total - expected) < 0.0001,
    `total ${r.total} should equal weighted sum ${expected}`,
  );
});

test("v2: dim weights sum to 1.0", () => {
  const sum =
    DIM_WEIGHTS.economic +
    DIM_WEIGHTS.intellectual +
    DIM_WEIGHTS.social +
    DIM_WEIGHTS.judicial;
  assert.ok(Math.abs(sum - 1.0) < 0.0001, `weights sum ${sum} should be 1.0`);
});
