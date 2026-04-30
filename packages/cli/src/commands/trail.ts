/**
 * `pneuma trail` — 链上 attestation 收据 feed（Spending Trail 的 CLI 版）
 */

import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { getActiveKey } from "../keys.js";
import { makePublicClient } from "../clients.js";
import { SoulNFTAbi, PneumaAttestationAbi } from "../abi.js";
import { c, fmtUsdc, shortAddr } from "../format.js";

const RATER_LABEL: Record<number, string> = {
  0: "PROVIDER",
  1: "CALLER",
  2: "JUROR",
  3: "SYSTEM",
};

export function registerTrailCommand(parent: Command) {
  parent
    .command("trail")
    .description("Show on-chain attestation receipts for your Soul TBA")
    .option("-t, --token-id <id>", "Soul tokenId (default: latest you own)")
    .option("-l, --last <n>", "show only last N receipts", "20")
    .option("--show-revoked", "include revoked attestations")
    .option("-j, --json", "JSON output")
    .action(async (opts) => {
      const cfg = loadConfig();
      const key = getActiveKey();
      const pub = makePublicClient(cfg);

      // resolve tokenId → tba
      let tokenId: bigint;
      if (opts.tokenId) {
        tokenId = BigInt(opts.tokenId);
      } else {
        const balance = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "balanceOf",
          args: [key.address],
        });
        if (balance === 0n) {
          console.log(c.warn("No Soul minted by this wallet."));
          return;
        }
        const total = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "totalMinted",
        });
        tokenId = 0n;
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
        if (tokenId === 0n) {
          console.log(c.warn("Couldn't auto-resolve Soul tokenId."));
          return;
        }
      }

      const tba = await pub.readContract({
        address: cfg.soulNft,
        abi: SoulNFTAbi,
        functionName: "tbaOf",
        args: [tokenId],
      });

      const atts = await pub.readContract({
        address: cfg.pneumaAttestation,
        abi: PneumaAttestationAbi,
        functionName: "getAttestationsByRecipient",
        args: [tba],
      });

      let filtered = [...atts];
      if (!opts.showRevoked) filtered = filtered.filter((a) => !a.revoked);

      // 按时间倒序
      filtered.sort((a, b) => Number(b.timestamp - a.timestamp));
      const limit = Number(opts.last);
      filtered = filtered.slice(0, limit);

      if (opts.json) {
        console.log(
          JSON.stringify(
            filtered.map((a) => ({
              uid: a.uid,
              skillId: a.skillId.toString(),
              callId: a.callId.toString(),
              skillName: a.skillName,
              category: a.skillCategory,
              rating: a.rating,
              raterRole: RATER_LABEL[a.raterRole] ?? `UNKNOWN(${a.raterRole})`,
              paid: a.paidAmount.toString(),
              timestamp: a.timestamp.toString(),
              revoked: a.revoked,
            })),
            null,
            2,
          ),
        );
        return;
      }

      const validNonSystem = atts.filter((a) => !a.revoked && a.raterRole !== 3);
      const totalSpent = validNonSystem.reduce((s, a) => s + a.paidAmount, 0n);

      console.log(c.bold(`Soul #${tokenId} — Spending Trail`));
      console.log(
        `  ${c.dim("Total spent: ")} ${c.bold(fmtUsdc(totalSpent))}   ${c.dim(`across ${validNonSystem.length} call${validNonSystem.length === 1 ? "" : "s"}`)}`,
      );
      console.log("");

      if (filtered.length === 0) {
        console.log(c.dim("  No receipts yet."));
        return;
      }

      for (const a of filtered) {
        const isBoundary = a.raterRole === 3;
        const role = RATER_LABEL[a.raterRole] ?? "?";
        const when = new Date(Number(a.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 16);

        if (isBoundary) {
          console.log(
            `  ${c.magenta("├─ Ownership boundary")} ${c.dim(when)}  ${c.dim(`uid ${shortAddr(a.uid)}`)}`,
          );
          continue;
        }
        const stars = "★".repeat(a.rating) + "☆".repeat(5 - a.rating);
        const revoked = a.revoked ? c.dim(" [revoked]") : "";
        console.log(
          `  ${c.cyan(stars)} ${c.bold(a.skillName.slice(0, 30).padEnd(30))} ${c.dim(role.padEnd(8))} ${fmtUsdc(a.paidAmount).padStart(12)}  ${c.dim(when)}${revoked}`,
        );
      }
    });
}
