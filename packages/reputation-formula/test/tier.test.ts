/**
 * 段位边界测试 —— 锁定 P3a 提交时的段位区间
 *
 * 段位区间是产品决策可调；调整后这个 test 必须同步改，提醒所有 dApp
 * 段位语义已经漂移。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scaleToDisplayScore,
  getTier,
  tierProgress,
  rankInTier,
  TIERS,
} from "../src/index.js";

test("scaleToDisplayScore: 0-100 → 0-1000 整数", () => {
  assert.equal(scaleToDisplayScore(0), 0);
  assert.equal(scaleToDisplayScore(50), 500);
  assert.equal(scaleToDisplayScore(73.85), 739);
  assert.equal(scaleToDisplayScore(100), 1000);
  // clamp
  assert.equal(scaleToDisplayScore(150), 1000);
  // negative / NaN
  assert.equal(scaleToDisplayScore(-10), 0);
  assert.equal(scaleToDisplayScore(NaN), 0);
});

test("getTier: 边界值落到正确段位", () => {
  assert.equal(getTier(0).id, "newcomer");
  assert.equal(getTier(99).id, "newcomer");
  assert.equal(getTier(100).id, "bronze");
  assert.equal(getTier(299).id, "bronze");
  assert.equal(getTier(300).id, "silver");
  assert.equal(getTier(499).id, "silver");
  assert.equal(getTier(500).id, "gold");
  assert.equal(getTier(699).id, "gold");
  assert.equal(getTier(700).id, "platinum");
  assert.equal(getTier(899).id, "platinum");
  assert.equal(getTier(900).id, "diamond");
  assert.equal(getTier(1000).id, "diamond");
});

test("getTier: 异常值兜底", () => {
  assert.equal(getTier(-1).id, "newcomer");
  assert.equal(getTier(NaN).id, "newcomer");
  assert.equal(getTier(99999).id, "diamond");
});

test("TIERS 数组连续无 gap", () => {
  for (let i = 1; i < TIERS.length; i++) {
    assert.equal(
      TIERS[i]!.min,
      TIERS[i - 1]!.max,
      `tier ${TIERS[i]!.id}.min (${TIERS[i]!.min}) 应该等于 ${TIERS[i - 1]!.id}.max (${TIERS[i - 1]!.max})`,
    );
  }
});

test("tierProgress: 段位内进度归一到 0-1", () => {
  // bronze 区间 [100, 300)，中点 200 → 0.5
  assert.equal(tierProgress(200), 0.5);
  // bronze 起点 → 0
  assert.equal(tierProgress(100), 0);
  // bronze 末尾接近 1
  assert.ok(tierProgress(299) > 0.99);
  // 满级
  assert.equal(tierProgress(1000), 1);
});

test("rankInTier: 段位内排名计算正确", () => {
  // 同段位 5 个分数，目标 600 排名
  const scores = [800, 700, 600, 550, 510];
  const r = rankInTier(scores, 600);
  assert.equal(r.rank, 3);
  assert.equal(r.total, 5);
});
