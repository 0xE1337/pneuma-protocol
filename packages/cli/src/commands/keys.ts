/**
 * `pneuma keys` — 本地 wallet 管理（list / add / remove / activate）
 *
 * 对位 Monid `monid keys`，但底层是 EVM 私钥而非 API key。
 */

import type { Command } from "commander";
import type { Hex } from "viem";
import { addKey, listKeys, removeKey, activateKey } from "../keys.js";
import { c, shortAddr } from "../format.js";

export function registerKeysCommands(parent: Command) {
  const keys = parent.command("keys").description("Manage local wallets (private keys)");

  keys
    .command("list")
    .description("List all stored wallets")
    .option("-j, --json", "JSON output")
    .action((opts) => {
      const data = listKeys();
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      if (data.entries.length === 0) {
        console.log(c.dim("No keys stored."));
        console.log(c.dim("Add one with: pneuma keys add -l <label> -k <0x...>"));
        return;
      }
      console.log(c.bold("Stored wallets:"));
      for (const e of data.entries) {
        const marker = e.label === data.active ? c.ok("●") : c.dim("○");
        console.log(`  ${marker} ${c.bold(e.label.padEnd(16))} ${c.cyan(shortAddr(e.address))}`);
      }
    });

  keys
    .command("add")
    .description("Add a wallet from a 32-byte hex private key")
    .requiredOption("-l, --label <label>", "human-readable label, e.g. 'main'")
    .requiredOption("-k, --key <hex>", "0x-prefixed 64-char private key")
    .action((opts) => {
      const entry = addKey(opts.label, opts.key as Hex);
      console.log(c.ok(`✓ Added '${entry.label}' (${entry.address})`));
    });

  keys
    .command("remove")
    .description("Remove a wallet")
    .requiredOption("-l, --label <label>", "label to remove")
    .action((opts) => {
      removeKey(opts.label);
      console.log(c.ok(`✓ Removed '${opts.label}'`));
    });

  keys
    .command("activate")
    .description("Switch the active wallet")
    .requiredOption("-l, --label <label>", "label to activate")
    .action((opts) => {
      activateKey(opts.label);
      console.log(c.ok(`✓ '${opts.label}' is now active`));
    });
}
