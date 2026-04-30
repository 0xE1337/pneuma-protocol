/**
 * 本地 wallet keystore —— 跟 Monid `monid keys add/list/activate` 对位
 *
 * 文件位置: ~/.pneuma/keys.json
 * 文件权限: 0600（仅当前用户可读写）
 *
 * 安全说明：
 *   - hackathon 阶段：明文私钥（throwaway 钱包）—— 跟同期对手一致
 *   - mainnet 路径：v2 改为系统 keychain（macOS Keychain / libsecret），
 *     私钥永不落盘；v3 集成 hardware wallet（Ledger / Lattice）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

const HOME_DIR = join(homedir(), ".pneuma");
const KEYS_FILE = join(HOME_DIR, "keys.json");

export interface KeyEntry {
  label: string;
  privateKey: Hex;
  address: Address;
  createdAt: string;
}

interface KeysFile {
  active: string | null; // 当前激活 label
  entries: KeyEntry[];
}

function ensureDir() {
  if (!existsSync(HOME_DIR)) {
    mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  }
}

function read(): KeysFile {
  ensureDir();
  if (!existsSync(KEYS_FILE)) {
    return { active: null, entries: [] };
  }
  return JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
}

function write(data: KeysFile) {
  ensureDir();
  writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  // 确保文件权限收紧（防止其他用户读到私钥）
  try {
    chmodSync(KEYS_FILE, 0o600);
  } catch {
    /* ignore on platforms without chmod */
  }
}

export function listKeys(): { active: string | null; entries: KeyEntry[] } {
  const data = read();
  return data;
}

export function addKey(label: string, privateKey: Hex): KeyEntry {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKeyAsString(privateKey))) {
    throw new Error("private key must be 0x-prefixed 32-byte hex");
  }
  const data = read();
  if (data.entries.some((e) => e.label === label)) {
    throw new Error(`label "${label}" already exists; remove it first`);
  }
  const account = privateKeyToAccount(privateKey);
  const entry: KeyEntry = {
    label,
    privateKey,
    address: account.address,
    createdAt: new Date().toISOString(),
  };
  data.entries.push(entry);
  if (data.active === null) data.active = label;
  write(data);
  return entry;
}

export function removeKey(label: string) {
  const data = read();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => e.label !== label);
  if (data.entries.length === before) {
    throw new Error(`no key with label "${label}"`);
  }
  if (data.active === label) {
    data.active = data.entries[0]?.label ?? null;
  }
  write(data);
}

export function activateKey(label: string) {
  const data = read();
  if (!data.entries.some((e) => e.label === label)) {
    throw new Error(`no key with label "${label}"`);
  }
  data.active = label;
  write(data);
}

export function getActiveKey(): KeyEntry {
  const data = read();
  if (data.active === null) {
    throw new Error(
      "no active key. Run: pneuma keys add -l <label> -k <private-key>",
    );
  }
  const entry = data.entries.find((e) => e.label === data.active);
  if (!entry) {
    throw new Error("active key label points to a missing entry; run pneuma keys list");
  }
  return entry;
}

function privateKeyAsString(pk: Hex): string {
  return typeof pk === "string" ? pk : (pk as unknown as string);
}
