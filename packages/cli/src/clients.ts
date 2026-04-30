/**
 * viem 客户端工厂 —— public + wallet 双 client
 */

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PneumaConfig } from "./config.js";
import type { KeyEntry } from "./keys.js";

export function makePublicClient(cfg: PneumaConfig): PublicClient {
  return createPublicClient({ transport: http(cfg.rpcUrl) }) as PublicClient;
}

export function makeWalletClient(cfg: PneumaConfig, key: KeyEntry): WalletClient {
  const account = privateKeyToAccount(key.privateKey);
  return createWalletClient({ account, transport: http(cfg.rpcUrl) }) as WalletClient;
}
