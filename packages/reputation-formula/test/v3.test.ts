/**
 * v3 公式 + boundary-tier + effective-tier 数值锁定
 *
 * 这些 expected 是在 P3a/P3b 提交时锁定的；改公式系数会让测试 fail，
 * 强制走 v4 升级流程而不是默默漂移。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePunishmentFactor,
  computeSlashedRatio,
  computeJudicialScoreV3,
  computeReputationV3,
  getBoundaryTier,
  countRollingBoundaryTriggers,
  applyBoundaryPenalty,
  getEffectiveTier,
  BOUNDARY_PENALTY,
  ROLLING_WINDOW_SECONDS,
  type DisputeRecordLike,
  type JurorVoteLike,
  type EndorsementLike,
} from "../src/index.js";

const NOW = 1735603200; // 2025-01-01 UTC
const AGENT: `0x${string}` = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: `0x${string}` = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// ─────────────────────── punishmentFactor ───────────────────────

test("punishmentFactor: 0 案件 → 0", () => {
  const r = computePunishmentFactor([], AGENT);
  assert.equal(r.factor, 0);
  assert.equal(r.guiltyCount, 0);
  assert.equal(r.innocentCount, 0);
});

test("punishmentFactor: 1 guilty → 1/6 ≈ 0.167", () => {
  const disputes: DisputeRecordLike[] = [
    {
      disputeId: 1n,
      callId: 1n,
      plaintiff: OTHER,
      defendant: AGENT,
      jurors: [],
      status: 2,
      verdict: 1, // GUILTY
    },
  ];
  const r = computePunishmentFactor(disputes, AGENT);
  assert.equal(r.guiltyCount, 1);
  assert.equal(r.innocentCount, 0);
  assert.ok(Math.abs(r.factor - 1 / 6) < 1e-6);
});

test("punishmentFactor: 5 guilty / 0 innocent → 0.5", () => {
  const disputes: DisputeRecordLike[] = Array.from({ length: 5 }, (_, i) => ({
    disputeId: BigInt(i + 1),
    callId: BigInt(i + 1),
    plaintiff: OTHER,
    defendant: AGENT,
    jurors: [],
    status: 2,
    verdict: 1,
  }));
  const r = computePunishmentFactor(disputes, AGENT);
  assert.equal(r.factor, 0.5);
});

test("punishmentFactor: voting 中（status=1）的案件不算", () => {
  const disputes: DisputeRecordLike[] = [
    {
      disputeId: 1n,
      callId: 1n,
      plaintiff: OTHER,
      defendant: AGENT,
      jurors: [],
      status: 1, // VOTING，未 resolve
      verdict: 0,
    },
  ];
  const r = computePunishmentFactor(disputes, AGENT);
  assert.equal(r.factor, 0);
});

test("punishmentFactor: agent 作为 plaintiff 不算", () => {
  const disputes: DisputeRecordLike[] = [
    {
      disputeId: 1n,
      callId: 1n,
      plaintiff: AGENT, // agent 是起诉方，不是被告
      defendant: OTHER,
      jurors: [],
      status: 2,
      verdict: 1,
    },
  ];
  const r = computePunishmentFactor(disputes, AGENT);
  assert.equal(r.factor, 0);
});

// ─────────────────────── slashedRatio ───────────────────────

test("slashedRatio: 0 担保 → 0", () => {
  const r = computeSlashedRatio([], 0);
  assert.equal(r.ratio, 0);
});

test("slashedRatio: 5 担保 0 被罚 → 0", () => {
  const endorsees: EndorsementLike[] = Array.from({ length: 5 }, () => ({
    stakedAmount: 100_000_000n,
    active: true,
    startedAt: BigInt(NOW),
  }));
  const r = computeSlashedRatio(endorsees, 0);
  assert.equal(r.ratio, 0);
});

test("slashedRatio: 5 担保 1 被罚 → 1/6 ≈ 0.167", () => {
  const endorsees: EndorsementLike[] = Array.from({ length: 5 }, () => ({
    stakedAmount: 100_000_000n,
    active: true,
    startedAt: BigInt(NOW),
  }));
  const r = computeSlashedRatio(endorsees, 1);
  assert.ok(Math.abs(r.ratio - 1 / 6) < 1e-6);
});

// ─────────────────────── judicial v3 ───────────────────────

test("judicial v3: 0 投票 → 0", () => {
  const r = computeJudicialScoreV3([], NOW);
  assert.equal(r.score, 0);
});

test("judicial v3: 5 投票全对 + 当天 → accuracy=1, decay 满, score 较高", () => {
  const votes: JurorVoteLike[] = Array.from({ length: 5 }, (_, i) => ({
    disputeId: BigInt(i + 1),
    jurorVerdict: 1,
    finalVerdict: 1,
    filedAt: BigInt(NOW),
  }));
  const r = computeJudicialScoreV3(votes, NOW);
  assert.equal(r.detail.totalVotes, 5);
  assert.equal(r.detail.correctVotes, 5);
  // sqrt(5) × 1 × 1 × 8 ≈ 17.89
  assert.ok(r.score > 17 && r.score < 18);
});

test("judicial v3: 4 投票 2 对 → accuracy=0.5", () => {
  const votes: JurorVoteLike[] = [
    { disputeId: 1n, jurorVerdict: 1, finalVerdict: 1, filedAt: BigInt(NOW) },
    { disputeId: 2n, jurorVerdict: 1, finalVerdict: 1, filedAt: BigInt(NOW) },
    { disputeId: 3n, jurorVerdict: 2, finalVerdict: 1, filedAt: BigInt(NOW) },
    { disputeId: 4n, jurorVerdict: 2, finalVerdict: 1, filedAt: BigInt(NOW) },
  ];
  const r = computeJudicialScoreV3(votes, NOW);
  assert.equal(r.detail.accuracy, "0.50");
});

// ─────────────────────── computeReputationV3 兼容 v2 ───────────────────────

test("v3 不传 court 数据 → punishmentFactor=0, slashedRatio=0, judicial=0（等价 v2 + judicial=0）", () => {
  const r = computeReputationV3({
    attestations: [],
    defendantAddress: AGENT,
  });
  assert.equal(r.punishmentFactor, 0);
  assert.equal(r.slashedRatio, 0);
  assert.equal(r.judicial.score, 0);
  assert.equal(r.hasGuiltyRecord, false);
  assert.equal(r.boundaryTriggers12mo, 0);
});

test("v3 + 1 guilty → economic 衰减 ~17%", () => {
  // 给一条 caller 5★ 的 attestation，让 economic 有非零分
  const r = computeReputationV3({
    attestations: [
      {
        rating: 5,
        paidAmount: 100_000_000n,
        timestamp: BigInt(NOW - 60 * 86400),
        revoked: false,
        raterRole: 1,
      },
    ],
    disputes: [
      {
        disputeId: 1n,
        callId: 1n,
        plaintiff: OTHER,
        defendant: AGENT,
        jurors: [],
        status: 2,
        verdict: 1,
      },
    ],
    defendantAddress: AGENT,
    now: NOW,
  });
  assert.ok(Math.abs(r.punishmentFactor - 1 / 6) < 1e-6);
  assert.equal(r.hasGuiltyRecord, true);
});

// ─────────────────────── boundary-tier ───────────────────────

test("getBoundaryTier: 0/1/2/3+ → anchored/candidate/observed/frozen", () => {
  assert.equal(getBoundaryTier(0).id, "anchored");
  assert.equal(getBoundaryTier(1).id, "candidate");
  assert.equal(getBoundaryTier(2).id, "observed");
  assert.equal(getBoundaryTier(3).id, "frozen");
  assert.equal(getBoundaryTier(99).id, "frozen");
  assert.equal(getBoundaryTier(-1).id, "anchored");
});

test("countRollingBoundaryTriggers: 滚动 12 个月窗口", () => {
  const recent = BigInt(NOW - 60 * 86400); // 60 天前
  const old = BigInt(NOW - 400 * 86400); // 400 天前（窗口外）
  const triggers = [recent, recent, old, old, old];
  const count = countRollingBoundaryTriggers(triggers, NOW);
  assert.equal(count, 2); // 只算窗口内的 2 个
});

test("applyBoundaryPenalty: candidate 扣 200, observed 扣 500", () => {
  const a = applyBoundaryPenalty(800, 0);
  assert.equal(a.adjustedScore, 800);
  assert.equal(a.tier.id, "anchored");

  const b = applyBoundaryPenalty(800, 1);
  assert.equal(b.adjustedScore, 600);
  assert.equal(b.tier.id, "candidate");

  const c = applyBoundaryPenalty(800, 2);
  assert.equal(c.adjustedScore, 300);
  assert.equal(c.tier.id, "observed");

  const d = applyBoundaryPenalty(800, 5);
  assert.equal(d.adjustedScore, 300);
  assert.equal(d.tier.id, "frozen");
  assert.equal(d.tier.growthFrozen, true);
});

test("ROLLING_WINDOW_SECONDS = 365 days", () => {
  assert.equal(ROLLING_WINDOW_SECONDS, 365 * 24 * 60 * 60);
});

test("BOUNDARY_PENALTY 数值锁定", () => {
  assert.equal(BOUNDARY_PENALTY.FIRST_HIT, 200);
  assert.equal(BOUNDARY_PENALTY.SECOND_HIT, 300);
  assert.equal(BOUNDARY_PENALTY.THIRD_HIT_FREEZE, true);
});

// ─────────────────────── effective-tier ───────────────────────

test("effective-tier: 0 触发 + 无 guilty + score 90 → Diamond + Anchored", () => {
  const e = getEffectiveTier(90, 0, false);
  assert.equal(e.displayScore, 900);
  assert.equal(e.reputationTier.id, "diamond");
  assert.equal(e.integrityTier.id, "anchored");
  assert.equal(e.cappedByGuilty, false);
  assert.equal(e.growthFrozen, false);
});

test("effective-tier: 1 boundary 触发 → 扣 200 + Candidate 标签", () => {
  // raw 80 → display 800 → -200 = 600 → Gold
  const e = getEffectiveTier(80, 1, false);
  assert.equal(e.rawDisplayScore, 800);
  assert.equal(e.displayScore, 600);
  assert.equal(e.reputationTier.id, "gold");
  assert.equal(e.integrityTier.id, "candidate");
});

test("effective-tier: court guilty hard cap → 钳到 Silver", () => {
  // raw 90 → display 900 → 没 boundary 不扣 → diamond
  // 但 hasGuiltyRecord=true → 钳到 silver
  const e = getEffectiveTier(90, 0, true);
  assert.equal(e.displayScore, 900);
  assert.equal(e.reputationTier.id, "silver");
  assert.equal(e.cappedByGuilty, true);
});

test("effective-tier: 3+ boundary 触发 → frozen + growthFrozen=true", () => {
  const e = getEffectiveTier(80, 3, false);
  assert.equal(e.integrityTier.id, "frozen");
  assert.equal(e.growthFrozen, true);
});

test("effective-tier: 同时 guilty + frozen → 双标签都生效", () => {
  // raw 95 → display 950 → boundary -500 → 450 → silver
  // silver 已经在 hard cap 里，cappedByGuilty=false（hard cap 没机会动）
  // 这种 case 是 boundary 比 hard cap 更狠 → 双标签同时显示但 cappedByGuilty 不重复触发
  const e = getEffectiveTier(95, 5, true);
  assert.equal(e.reputationTier.id, "silver");
  assert.equal(e.integrityTier.id, "frozen");
  assert.equal(e.cappedByGuilty, false); // 已经在 silver，hard cap 无事可做
  assert.equal(e.growthFrozen, true);
});

test("effective-tier: guilty hard cap 单独触发（boundary penalty 不够狠时）", () => {
  // raw 90 → display 900 → 0 boundary 不扣 → diamond
  // hasGuiltyRecord → 钳到 silver
  const e = getEffectiveTier(90, 0, true);
  assert.equal(e.reputationTier.id, "silver");
  assert.equal(e.cappedByGuilty, true); // 这里 hard cap 真生效了
  assert.equal(e.integrityTier.id, "anchored");
});
