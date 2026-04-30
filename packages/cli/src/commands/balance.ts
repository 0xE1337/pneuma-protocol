/**
 * `pneuma balance` — 显示 wallet + TBA 的 USDC 余额
 */

import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { getActiveKey } from "../keys.js";
import { makePublicClient } from "../clients.js";
import { Erc20Abi, SoulNFTAbi } from "../abi.js";
import { c, fmtUsdc, shortAddr } from "../format.js";

export function registerBalanceCommand(parent: Command) {
  parent
    .command("balance")
    .description("Show USDC balance for your wallet and your Soul TBA")
    .option("-t, --token-id <id>", "Soul tokenId (default: latest you own)")
    .option("-j, --json", "JSON output")
    .action(async (opts) => {
      const cfg = loadConfig();
      const key = getActiveKey();
      const pub = makePublicClient(cfg);

      const eoaBal = await pub.readContract({
        address: cfg.usdc,
        abi: Erc20Abi,
        functionName: "balanceOf",
        args: [key.address],
      });

      // 推断 tokenId
      let tokenId: bigint | null = null;
      let tba: string | null = null;
      let tbaBal = 0n;

      if (opts.tokenId) {
        tokenId = BigInt(opts.tokenId);
      } else {
        const balance = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "balanceOf",
          args: [key.address],
        });
        if (balance > 0n) {
          const total = await pub.readContract({
            address: cfg.soulNft,
            abi: SoulNFTAbi,
            functionName: "totalMinted",
          });
          for (let i = total; i > 0n; i--) {
            const owner = await pub.readContract({
              address: cfg.soulNft,
              abi: SoulNFTAbi,
              functionName: "ownerOf",
              args: [i],
            });
            if (owner.toLowerCase() === key.address.toLowerCase()) {
              tokenId = i;
              break;
            }
          }
        }
      }

      if (tokenId !== null) {
        tba = (await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "tbaOf",
          args: [tokenId],
        })) as string;
        tbaBal = await pub.readContract({
          address: cfg.usdc,
          abi: Erc20Abi,
          functionName: "balanceOf",
          args: [tba as `0x${string}`],
        });
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              wallet: key.address,
              walletUsdc: eoaBal.toString(),
              soulTokenId: tokenId?.toString() ?? null,
              tba,
              tbaUsdc: tbaBal.toString(),
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(c.bold("Balances"));
      console.log(
        `  ${c.dim("Wallet")} ${c.cyan(shortAddr(key.address)).padEnd(12)} ${c.bold(fmtUsdc(eoaBal))}`,
      );
      if (tokenId !== null && tba) {
        console.log(
          `  ${c.dim("Soul #" + tokenId)} TBA ${c.cyan(shortAddr(tba)).padEnd(8)} ${c.bold(fmtUsdc(tbaBal))}`,
        );
      } else {
        console.log(c.dim("  No Soul minted yet — run: pneuma soul mint --name <agent>"));
      }
    });
}
