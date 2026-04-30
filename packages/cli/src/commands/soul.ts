/**
 * `pneuma soul` — Soul (ERC-721) + TBA (ERC-6551) 身份管理
 */

import type { Command } from "commander";
import ora from "ora";
import { loadConfig, explorerAddrUrl, explorerTxUrl } from "../config.js";
import { getActiveKey } from "../keys.js";
import { makePublicClient, makeWalletClient } from "../clients.js";
import { SoulNFTAbi, Erc20Abi, PneumaAttestationAbi } from "../abi.js";
import { c, shortAddr, fmtUsdc } from "../format.js";

export function registerSoulCommands(parent: Command) {
  const soul = parent.command("soul").description("Manage your Soul (ERC-721 identity + ERC-6551 wallet)");

  // pneuma soul mint --name <name>
  soul
    .command("mint")
    .description("Mint a new Soul NFT — derives a TBA wallet automatically")
    .requiredOption("-n, --name <name>", "agent display name")
    .option("-u, --uri <uri>", "optional metadata URI (ipfs:// / https://)", "")
    .action(async (opts) => {
      const cfg = loadConfig();
      const key = getActiveKey();
      const pub = makePublicClient(cfg);
      const wallet = makeWalletClient(cfg, key);

      const spinner = ora(`Minting Soul "${opts.name}"…`).start();
      try {
        const { request } = await pub.simulateContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "publicMint",
          args: [opts.name, opts.uri],
          account: wallet.account!,
        });
        const txHash = await wallet.writeContract(request);
        spinner.text = `Sent tx ${shortAddr(txHash)} — waiting for confirmation…`;
        const receipt = await pub.waitForTransactionReceipt({ hash: txHash });

        // Read totalMinted to get the new tokenId (last minted = totalMinted)
        const totalMinted = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "totalMinted",
        });
        const tba = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "tbaOf",
          args: [totalMinted],
        });

        spinner.succeed(c.ok("Soul minted"));
        console.log(`  ${c.dim("Token ID:")}  ${c.bold("#" + totalMinted.toString())}`);
        console.log(`  ${c.dim("Owner:   ")}  ${c.cyan(key.address)}`);
        console.log(`  ${c.dim("TBA:     ")}  ${c.cyan(tba)}`);
        console.log(`  ${c.dim("Tx:      ")}  ${c.dim(explorerTxUrl(cfg, txHash))}`);
        console.log("");
        console.log(c.dim(`Next: fund the TBA with USDC, then 'pneuma discover' to find skills.`));
        void receipt;
      } catch (err) {
        spinner.fail(c.err(`Mint failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // pneuma soul status [--token-id <id>]
  soul
    .command("status")
    .description("Show identity + USDC balance + on-chain reputation summary")
    .option("-t, --token-id <id>", "Soul tokenId (default: your latest minted)")
    .option("-j, --json", "JSON output")
    .action(async (opts) => {
      const cfg = loadConfig();
      const key = getActiveKey();
      const pub = makePublicClient(cfg);

      let tokenId: bigint;
      if (opts.tokenId) {
        tokenId = BigInt(opts.tokenId);
      } else {
        // 默认：找你账号下编号最大的
        const balance = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "balanceOf",
          args: [key.address],
        });
        if (balance === 0n) {
          console.log(c.warn("No Soul minted by this wallet yet."));
          console.log(c.dim("Run: pneuma soul mint --name <agent-name>"));
          return;
        }
        const total = await pub.readContract({
          address: cfg.soulNft,
          abi: SoulNFTAbi,
          functionName: "totalMinted",
        });
        // 简化：从 total 倒序找第一个 owner == key.address 的 (hackathon 阶段够用)
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
          console.log(c.warn("Couldn't auto-resolve your Soul tokenId. Pass --token-id."));
          return;
        }
      }

      const tba = await pub.readContract({
        address: cfg.soulNft,
        abi: SoulNFTAbi,
        functionName: "tbaOf",
        args: [tokenId],
      });
      const owner = await pub.readContract({
        address: cfg.soulNft,
        abi: SoulNFTAbi,
        functionName: "ownerOf",
        args: [tokenId],
      });
      const usdcBal = await pub.readContract({
        address: cfg.usdc,
        abi: Erc20Abi,
        functionName: "balanceOf",
        args: [tba],
      });
      const attestations = await pub.readContract({
        address: cfg.pneumaAttestation,
        abi: PneumaAttestationAbi,
        functionName: "getAttestationsByRecipient",
        args: [tba],
      });

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              tokenId: tokenId.toString(),
              owner,
              tba,
              usdcBalance: usdcBal.toString(),
              attestationCount: attestations.length,
            },
            null,
            2,
          ),
        );
        return;
      }

      const validAtts = attestations.filter((a) => !a.revoked && a.raterRole !== 3);

      console.log(c.bold(`Soul #${tokenId}`));
      console.log(`  ${c.dim("Owner:        ")} ${c.cyan(owner)}`);
      console.log(`  ${c.dim("TBA wallet:   ")} ${c.cyan(tba)}`);
      console.log(`  ${c.dim("USDC balance: ")} ${c.bold(fmtUsdc(usdcBal))}`);
      console.log(
        `  ${c.dim("Reputation:   ")} ${c.bold(validAtts.length.toString())} verified call${validAtts.length === 1 ? "" : "s"}` +
          (validAtts.length === 0 ? c.dim(" (cold-start)") : ""),
      );
      console.log("");
      console.log(c.dim(`Explorer: ${explorerAddrUrl(cfg, tba)}`));
    });
}
