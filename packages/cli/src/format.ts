/**
 * 终端输出 helpers —— 颜色、对齐、单位换算
 */

import chalk from "chalk";
import type { Address } from "viem";

const NO_COLOR = process.env.NO_COLOR === "1" || process.env.NO_COLOR === "true";

function paint(fn: (s: string) => string, s: string) {
  return NO_COLOR ? s : fn(s);
}

export const c = {
  ok: (s: string) => paint(chalk.green, s),
  warn: (s: string) => paint(chalk.yellow, s),
  err: (s: string) => paint(chalk.red, s),
  dim: (s: string) => paint(chalk.gray, s),
  bold: (s: string) => paint(chalk.bold, s),
  cyan: (s: string) => paint(chalk.cyan, s),
  magenta: (s: string) => paint(chalk.magenta, s),
};

export function shortAddr(a: Address | string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** 6-decimal USDC 格式化 */
export function fmtUsdc(amount: bigint): string {
  const i = amount / 1_000_000n;
  const f = amount % 1_000_000n;
  if (f === 0n) return `${i.toString()} USDC`;
  return `${i.toString()}.${f.toString().padStart(6, "0").replace(/0+$/, "")} USDC`;
}

/** 通用 ERC-20 格式化（自定义 decimals） */
export function fmtErc20(amount: bigint, decimals: number, symbol = ""): string {
  const div = 10n ** BigInt(decimals);
  const i = amount / div;
  const f = amount % div;
  const fStr = f.toString().padStart(decimals, "0").replace(/0+$/, "");
  const num = fStr.length > 0 ? `${i}.${fStr}` : i.toString();
  return symbol ? `${num} ${symbol}` : num;
}

export function fmtSeconds(s: bigint | number): string {
  const n = typeof s === "bigint" ? Number(s) : s;
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m${n % 60}s`;
  return `${Math.floor(n / 3600)}h${Math.floor((n % 3600) / 60)}m`;
}
