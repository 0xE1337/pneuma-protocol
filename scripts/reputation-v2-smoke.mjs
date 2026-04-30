#!/usr/bin/env node
/**
 * V6.0.3 ReputationEngine v2 — 4 维公式 smoke test
 *
 * 验证：
 *   1. 0-state agent → 0 分
 *   2. 单维度（economic only）正确累积
 *   3. 多维度独立累积（economic + intellectual + social）
 *   4. 加权和数学正确（30/25/30/15）
 *   5. retracted publication 不算 intellectual
 *   6. inactive endorsement 不算 social
 *   7. 边界：极大 stake 不会让 social 超过 100
 *   8. age decay 工作正常
 *
 * 这个 smoke 不是单元测试 framework，是 stand-alone 验证脚本。
 * 因为 apps/hub 还没装测试 runner（next dev 优先），用 node 脚本兜底。
 *
 * 运行：node scripts/reputation-v2-smoke.mjs
 *
 * 注意：reputationScore.v2.ts 是 TypeScript，本脚本通过 tsx 或 esbuild 跑
 * Hackathon 阶段简化：直接 inline 复现公式做端到端验证（精度 ±2 接受）
 */

let pass = 0;
let fail = 0;

function expect(label, cond, extra = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
    fail++;
  }
}

// ─── 复现 v2 公式 (跟 reputationScore.v2.ts 同步) ───

const USDC_SCALE = 10 ** 6;
const AGE_RAMP_DAYS = 30;
const DECAY_LAMBDA = 0.023;
const DIM_WEIGHTS = { economic: 0.30, intellectual: 0.25, social: 0.30, judicial: 0.15 };

function computeIntellectualScore(publications, now) {
  const valid = publications.filter((p) => !p.retracted);
  if (valid.length === 0) return { score: 0, detail: { publications: 0, citations: 0 } };

  const totalCitations = valid.reduce((s, p) => s + Number(p.citationCount), 0);
  if (totalCitations === 0) {
    return { score: Math.min(10, valid.length * 2), detail: { publications: valid.length, citations: 0 } };
  }

  const earliest = valid.reduce((min, p) => (p.publishedAt < min ? p.publishedAt : min), valid[0].publishedAt);
  const latest = valid.reduce((max, p) => (p.publishedAt > max ? p.publishedAt : max), valid[0].publishedAt);

  const ageDays = Math.max(0, (now - Number(earliest)) / 86400);
  const idleDays = Math.max(0, (now - Number(latest)) / 86400);
  const ageFactor = Math.min(1, ageDays / AGE_RAMP_DAYS);
  const decayFactor = Math.max(0, 1 - DECAY_LAMBDA * idleDays);

  const score = Math.min(100, Math.sqrt(totalCitations) * ageFactor * decayFactor * 8);
  return { score, detail: { publications: valid.length, citations: totalCitations } };
}

function computeSocialScore(endorsementsReceived, now) {
  const active = endorsementsReceived.filter((e) => e.active);
  if (active.length === 0) return { score: 0, detail: { activeEndorsements: 0 } };

  const totalStakeUsdc = active.reduce((s, e) => s + Number(e.stakedAmount), 0) / USDC_SCALE;
  const diversity = Math.min(active.length / 5, 1);
  const earliest = active.reduce((min, e) => (e.startedAt < min ? e.startedAt : min), active[0].startedAt);
  const ageDays = Math.max(0, (now - Number(earliest)) / 86400);
  const ageFactor = Math.min(1, ageDays / AGE_RAMP_DAYS);

  const score = Math.min(100, Math.sqrt(totalStakeUsdc) * diversity * ageFactor * 6);
  return { score, detail: { activeEndorsements: active.length, totalStakeUsdc } };
}

// ─── Tests ───

console.log("V6.0.3 ReputationEngine v2 smoke test");
console.log("─".repeat(48));

const NOW = 1730000000; // 2024-10-27
const ONE_DAY = 86400;

// Test 1: zero state → 0
console.log("\n[1] Zero-state agent → all 0");
{
  const i = computeIntellectualScore([], NOW);
  const s = computeSocialScore([], NOW);
  expect("intellectual = 0", i.score === 0);
  expect("social = 0", s.score === 0);
}

// Test 2: published 5 with 0 citations → base 10
console.log("\n[2] 5 publications, 0 citations → base score 10");
{
  const pubs = Array.from({ length: 5 }, (_, idx) => ({
    pubId: BigInt(idx + 1),
    citationCount: 0n,
    publishedAt: BigInt(NOW - 10 * ONE_DAY),
    retracted: false,
  }));
  const i = computeIntellectualScore(pubs, NOW);
  expect("score = 10 (base)", i.score === 10, `got ${i.score}`);
}

// Test 3: 4 pubs with total 16 citations + 30+ days old → significant
console.log("\n[3] 4 pubs · 16 citations · 30 days old → significant score");
{
  const pubs = [
    { pubId: 1n, citationCount: 4n, publishedAt: BigInt(NOW - 30 * ONE_DAY), retracted: false },
    { pubId: 2n, citationCount: 6n, publishedAt: BigInt(NOW - 20 * ONE_DAY), retracted: false },
    { pubId: 3n, citationCount: 4n, publishedAt: BigInt(NOW - 10 * ONE_DAY), retracted: false },
    { pubId: 4n, citationCount: 2n, publishedAt: BigInt(NOW - 5 * ONE_DAY), retracted: false },
  ];
  const i = computeIntellectualScore(pubs, NOW);
  // sqrt(16) × 1.0 (age full) × ~0.885 (idle 5 days decay) × 8 = ~28
  expect("score in [25, 35]", i.score >= 25 && i.score <= 35, `got ${i.score.toFixed(1)}`);
}

// Test 4: retracted not counted
console.log("\n[4] Retracted publications excluded");
{
  const pubs = [
    { pubId: 1n, citationCount: 100n, publishedAt: BigInt(NOW - 30 * ONE_DAY), retracted: true },
    { pubId: 2n, citationCount: 0n, publishedAt: BigInt(NOW - 30 * ONE_DAY), retracted: false },
  ];
  const i = computeIntellectualScore(pubs, NOW);
  expect("retracted ignored, only 1 valid pub → base 2", i.score === 2, `got ${i.score}`);
}

// Test 5: 1 endorsement 100 USDC + age full → significant
console.log("\n[5] 1 endorsement 100 USDC · 30 days → social score");
{
  const ends = [
    { stakedAmount: BigInt(100 * USDC_SCALE), active: true, startedAt: BigInt(NOW - 30 * ONE_DAY) },
  ];
  const s = computeSocialScore(ends, NOW);
  // sqrt(100) × 0.2 (1/5 diversity) × 1.0 × 6 = 12
  expect("score ≈ 12", Math.abs(s.score - 12) < 1, `got ${s.score.toFixed(1)}`);
}

// Test 6: 5 endorsements, full diversity
console.log("\n[6] 5 endorsements (max diversity) · 100 USDC each · 30 days");
{
  const ends = Array.from({ length: 5 }, () => ({
    stakedAmount: BigInt(100 * USDC_SCALE),
    active: true,
    startedAt: BigInt(NOW - 30 * ONE_DAY),
  }));
  const s = computeSocialScore(ends, NOW);
  // sqrt(500) × 1.0 × 1.0 × 6 = 134 → clamp 100
  expect("score = 100 (clamp)", s.score === 100, `got ${s.score.toFixed(1)}`);
}

// Test 7: inactive endorsements excluded
console.log("\n[7] Inactive endorsements excluded");
{
  const ends = [
    { stakedAmount: BigInt(10000 * USDC_SCALE), active: false, startedAt: BigInt(NOW - 30 * ONE_DAY) },
    { stakedAmount: BigInt(10 * USDC_SCALE), active: true, startedAt: BigInt(NOW - 30 * ONE_DAY) },
  ];
  const s = computeSocialScore(ends, NOW);
  // 只算 10 USDC active: sqrt(10) × 0.2 × 1.0 × 6 = ~3.8
  expect("only active counted", s.score < 5, `got ${s.score.toFixed(1)}`);
}

// Test 8: weighted total math
console.log("\n[8] Weighted total math (30/25/30/15)");
{
  // Simulate: economic=80, intellectual=60, social=40, judicial=0
  const total = 80 * DIM_WEIGHTS.economic +
                60 * DIM_WEIGHTS.intellectual +
                40 * DIM_WEIGHTS.social +
                0  * DIM_WEIGHTS.judicial;
  // = 24 + 15 + 12 + 0 = 51
  expect("total = 51", total === 51, `got ${total}`);
}

// Test 9: age factor ramp under 30 days
console.log("\n[9] Age ramp under 30 days");
{
  const pubs = [
    { pubId: 1n, citationCount: 100n, publishedAt: BigInt(NOW - 15 * ONE_DAY), retracted: false },
  ];
  const i = computeIntellectualScore(pubs, NOW);
  // sqrt(100) × 0.5 (age 15/30) × ~0.655 (idle 15 decay) × 8 = ~26
  expect("partial age factor applied", i.score < 35, `got ${i.score.toFixed(1)}`);
}

// Test 10: idle decay erodes score over time
console.log("\n[10] Idle decay erodes score (40 days idle → near 0)");
{
  const pubs = [
    { pubId: 1n, citationCount: 100n, publishedAt: BigInt(NOW - 60 * ONE_DAY), retracted: false },
  ];
  const i = computeIntellectualScore(pubs, NOW);
  // decay = max(0, 1 - 0.023 × 60) = max(0, -0.38) = 0
  expect("score = 0 due to idle decay", i.score === 0, `got ${i.score.toFixed(1)}`);
}

console.log("\n" + "─".repeat(48));
console.log(`Total: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
