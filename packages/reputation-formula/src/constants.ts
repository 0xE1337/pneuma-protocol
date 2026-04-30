/**
 * 公式常量 —— 与 Pneuma 协议层 invariant 对齐
 *
 * 这些常量在合约 + 前端 + 第三方 dApp 间必须保持一致；改动需要全协议升级。
 * 后续可由 PneumaGovernance（V8 Roadmap）通过 DAO 投票调整。
 */

/** Circle 原生 USDC 6 decimals（Arc / Base / Optimism 全链一致） */
export const USDC_DECIMALS = 6;

/**
 * raterRole 权重 —— 防 provider 自刷
 *
 *   - PROVIDER (0)：1.0× 基准
 *   - CALLER   (1)：1.5× 真金白银付钱方
 *   - JUROR    (2)：2.0× 第三方权威
 *   - SYSTEM   (3)：通过 default 1.0×（boundary attestation 不参与 score）
 */
export const ROLE_WEIGHTS: Record<number, number> = {
  0: 1.0,
  1: 1.5,
  2: 2.0,
};

/** 30-day 半衰期线性近似的衰减率 */
export const DECAY_LAMBDA = 0.023;

/** age 因子线性 ramp 长度（天） */
export const AGE_RAMP_DAYS = 30;

/**
 * v2 4 维加权
 *
 * Demo 期间等比偏 economic + social（demo 流量主要来自付费 + 担保），
 * 后续可链上 governance 调整。
 */
export const DIM_WEIGHTS = {
  economic: 0.30,
  intellectual: 0.25,
  social: 0.30,
  judicial: 0.15,
} as const;
