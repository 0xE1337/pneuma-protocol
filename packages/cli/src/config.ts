/**
 * 环境变量加载 + 合约地址默认值
 *
 * 优先级（从高到低）：
 *   1. 进程 env vars（CI / 一次性 override）
 *   2. ~/.pneuma/config.json（用户态）
 *   3. <repo-root>/.env.local（开发态）
 *   4. 内置 Arc Testnet 默认值（最后兜底）
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadEnv } from "dotenv";
import type { Address } from "viem";

const HOME_CONFIG_DIR = join(homedir(), ".pneuma");
const HOME_CONFIG_FILE = join(HOME_CONFIG_DIR, "config.json");

export interface PneumaConfig {
  rpcUrl: string;
  chainId: number;
  explorer: string;
  usdc: Address;
  soulNft: Address;
  skillRegistry: Address;
  pneumaAttestation: Address;
  budgetController?: Address;
}

interface PartialConfigFile {
  rpcUrl?: string;
  chainId?: number;
  explorer?: string;
  usdc?: string;
  soulNft?: string;
  skillRegistry?: string;
  pneumaAttestation?: string;
  budgetController?: string;
}

/** 尝试从 ~/.pneuma/config.json 读取 */
function readUserConfigFile(): PartialConfigFile {
  if (!existsSync(HOME_CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HOME_CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/** 在 cwd 向上查 .env.local */
function loadDotEnvLocal() {
  const candidates = [
    join(process.cwd(), ".env.local"),
    join(process.cwd(), "../.env.local"),
    join(process.cwd(), "../../.env.local"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      loadEnv({ path: p });
      return p;
    }
  }
  return null;
}

export function loadConfig(): PneumaConfig {
  loadDotEnvLocal();
  const file = readUserConfigFile();

  const rpcUrl =
    process.env.ARC_TESTNET_RPC_URL ?? file.rpcUrl ?? "https://rpc.testnet.arc.network";
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? file.chainId ?? 5042002);
  const explorer =
    process.env.NEXT_PUBLIC_CHAIN_EXPLORER ?? file.explorer ?? "https://testnet.arcscan.app";

  const need = (key: string, fileVal: string | undefined): Address => {
    const v = process.env[key] ?? fileVal;
    if (!v) {
      throw new Error(
        `Missing ${key}. Either set it in <repo>/.env.local or run 'pneuma keys add' (TODO: persist addresses to ~/.pneuma/config.json).`,
      );
    }
    return v as Address;
  };

  return {
    rpcUrl,
    chainId,
    explorer,
    usdc: need("NEXT_PUBLIC_USDC_ADDRESS", file.usdc),
    soulNft: need("NEXT_PUBLIC_SOUL_NFT_ADDRESS", file.soulNft),
    skillRegistry: need("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS", file.skillRegistry),
    pneumaAttestation: need(
      "NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS",
      file.pneumaAttestation,
    ),
    budgetController:
      (process.env.NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS ?? file.budgetController) as
        | Address
        | undefined,
  };
}

export function explorerTxUrl(cfg: PneumaConfig, hash: string): string {
  return `${cfg.explorer}/tx/${hash}`;
}

export function explorerAddrUrl(cfg: PneumaConfig, addr: string): string {
  return `${cfg.explorer}/address/${addr}`;
}
