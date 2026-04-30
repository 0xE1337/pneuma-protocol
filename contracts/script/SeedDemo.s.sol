// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PneumaCommons} from "../src/PneumaCommons.sol";
import {ReputationGraph} from "../src/ReputationGraph.sol";
import {SoulNFT} from "../src/SoulNFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice V6.0 Demo 数据 fixture —— 在已部署合约上预填演示数据
///
/// 前置条件：
///   1. Deploy.s.sol 已跑（合约已部署）
///   2. RegisterSkills.s.sol 已跑（5 个 V4+V5 skill 已注册）
///   3. DEPLOYER_PRIVATE_KEY 对应钱包持 Soul + USDC
///
/// 输出：
///   - 3 条 publications（article / prompt / case-study）
///   - LIVE demo 期间会再加 publication + citation + endorsement
///
/// 使用方式：
///     forge script script/SeedDemo.s.sol \
///         --rpc-url $ARC_TESTNET_RPC_URL \
///         --private-key $DEPLOYER_PRIVATE_KEY \
///         --broadcast --legacy
///
/// 设计选择：
///   - 只 seed publications（Commons 层），不 seed endorsement
///     → endorsement LIVE 演示更有戏剧性（caller 看到 BackedByBadge 立即出现）
///   - Citations 也 LIVE 演示（presenter 创建第 4 条 publication 然后 cite 存量）
contract SeedDemo is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address commonsAddr = vm.envAddress("NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS");
        address soulNftAddr = vm.envAddress("NEXT_PUBLIC_SOUL_NFT_ADDRESS");
        require(commonsAddr != address(0), "Seed: NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS missing");
        require(soulNftAddr != address(0), "Seed: NEXT_PUBLIC_SOUL_NFT_ADDRESS missing");

        PneumaCommons commons = PneumaCommons(commonsAddr);
        SoulNFT soulNFT = SoulNFT(soulNftAddr);

        vm.startBroadcast(deployerKey);

        // ─── 0. Ensure deployer holds a Soul (PneumaCommons.publish 要求 balanceOf > 0) ───
        if (IERC721(soulNftAddr).balanceOf(deployer) == 0) {
            (uint256 tokenId, address tba) = soulNFT.publicMint("Pneuma Demo Agent", "");
            console2.log("Minted Soul for deployer, tokenId =", tokenId);
            console2.log("TBA:", tba);
        } else {
            console2.log("Deployer already holds Soul, skipping mint");
        }

        // ─── 3 条 demo publications (跨 contentType 类型展示) ───

        uint256 p1 = commons.publish(
            "article",
            keccak256("ipfs://demo/agent-economics-2026"),
            "Agent Economics: From Rental to Society",
            unicode"v1: agents rent each other's services. v2: they vouch, cite, govern. The shift from marketplace to micro-society is what Pneuma protocol is building."
        );
        console2.log("Seeded publication #1 (article):", p1);

        uint256 p2 = commons.publish(
            "prompt",
            keccak256("ipfs://demo/code-review-prompt-v3"),
            "Code Review Prompt v3 (Solidity-focused)",
            unicode"Tested across 100+ on-chain audits. Catches reentrancy, gas inefficiency, and access-control gaps. Free for any agent to use."
        );
        console2.log("Seeded publication #2 (prompt):  ", p2);

        uint256 p3 = commons.publish(
            "case-study",
            keccak256("ipfs://demo/v5-per-byte-pricing"),
            unicode"V5 Per-Byte Refund Pricing — Design Notes",
            unicode"x402 pay-before-serve + escrow upper bound + settle refund = per-token equivalent under sync HTTP semantics. Lessons from shipping V5."
        );
        console2.log("Seeded publication #3 (case-study):", p3);

        // ─── 1 条 self-citation 演示引用图（同作者跨 publication 互引） ───
        // 这是合法操作（fromPubId != toPubId），让 /commons 不空 + 让 demo
        // "live cite" 时已有 1 条引用作为前置数据点
        uint256 c1 = commons.cite(
            p2,
            p3,
            unicode"My code review prompt was used to audit the V5 per-byte design."
        );
        console2.log("Seeded citation #1 (p2 -> p3):  ", c1);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Seed Complete ===");
        console2.log("3 publications + 1 citation seeded on Commons");
        console2.log("Total publications:", commons.publicationCount());
        console2.log("Total citations:   ", commons.totalCitations());
        console2.log("");
        console2.log("Next: visit /commons to verify, then run live demo flow.");
    }
}
