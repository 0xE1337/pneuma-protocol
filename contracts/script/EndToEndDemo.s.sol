// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SoulNFT} from "../src/SoulNFT.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice 端到端 demo —— 验证 Pneuma 协议层 mint → escrow → settle → caller-rate 完整闭环
/// @dev 使用方式：
///      forge script script/EndToEndDemo.s.sol \
///          --rpc-url $ARC_TESTNET_RPC_URL --broadcast --legacy
///      （DEPLOYER_PRIVATE_KEY 和 TEST_SELLER_PRIVATE_KEY 都从 .env.local 读）
contract EndToEndDemo is Script {
    function run() external {
        uint256 callerKey = vm.envUint("TEST_SELLER_PRIVATE_KEY");
        uint256 providerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address caller = vm.addr(callerKey);
        address provider = vm.addr(providerKey);

        address soulNftAddr = vm.envAddress("NEXT_PUBLIC_SOUL_NFT_ADDRESS");
        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");
        address attestationAddr = vm.envAddress("NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");

        SoulNFT soulNFT = SoulNFT(soulNftAddr);
        SkillRegistry skillRegistry = SkillRegistry(skillRegistryAddr);
        PneumaAttestation attestation = PneumaAttestation(attestationAddr);

        console2.log("=== Pneuma End-to-End Demo ===");
        console2.log("Caller (Test Seller):", caller);
        console2.log("Provider (Deployer):", provider);
        console2.log("USDC (Arc native):", usdc);
        console2.log("");

        // 1. Caller mint Soul
        vm.startBroadcast(callerKey);
        (uint256 tokenId, address callerTBA) = soulNFT.publicMint("Test Bot", "ipfs://test");
        vm.stopBroadcast();
        console2.log("[1] Soul minted: tokenId=", tokenId);
        console2.log("    callerTBA   =", callerTBA);

        // 2. Caller approve SkillRegistry for 2.5 USDC (cover Finance Oracle = 2 USDC + buffer)
        vm.startBroadcast(callerKey);
        IERC20(usdc).approve(skillRegistryAddr, 2_500_000);
        vm.stopBroadcast();
        console2.log("[2] Approved SkillRegistry for 2.5 USDC");

        // 3. Caller escrowForCall (Finance Oracle, skillId=1)
        bytes32 paymentHash = keccak256(abi.encode("pneuma-demo", tokenId, block.timestamp));
        vm.startBroadcast(callerKey);
        uint256 callId = skillRegistry.escrowForCall(1, callerTBA, paymentHash, 1024, 0);
        vm.stopBroadcast();
        console2.log("[3] Escrowed callId=", callId);

        // 4. Provider settleCall — provider 给 caller 写 5-star attestation (PROVIDER raterRole)
        vm.startBroadcast(providerKey);
        bytes32 providerAttestUid = skillRegistry.settleCall(callId, 0, 5, "demo: settled");
        vm.stopBroadcast();
        console2.log("[4] Provider settled. Attestation uid (PROVIDER):");
        console2.logBytes32(providerAttestUid);

        // 5. Caller reverse-rate (CALLER raterRole) — multi-rater attestation 闭环
        vm.startBroadcast(callerKey);
        bytes32 callerAttestUid = skillRegistry.callerRateSkill(callId, 4, "demo: 4-star, would call again");
        vm.stopBroadcast();
        console2.log("[5] Caller reverse-rated. Attestation uid (CALLER):");
        console2.logBytes32(callerAttestUid);

        // 6. Verify: read attestations on caller TBA
        PneumaAttestation.Attestation[] memory atts = attestation.getAttestationsByRecipient(callerTBA);
        console2.log("");
        console2.log("=== Attestations on caller TBA ===");
        console2.log("Total written:", atts.length);
        for (uint256 i = 0; i < atts.length; i++) {
            console2.log("  --- attestation", i, "---");
            console2.log("    skillId:    ", atts[i].skillId);
            console2.log("    rating:     ", atts[i].rating);
            console2.log("    paidAmount: ", atts[i].paidAmount);
            console2.log("    raterRole:  ", uint8(atts[i].raterRole));
            console2.log("    skillName:  ", atts[i].skillName);
            console2.log("    revoked:    ", atts[i].revoked);
        }

        console2.log("");
        console2.log("=== Demo complete ===");
        console2.log("Soul tokenId:", tokenId);
        console2.log("Soul TBA:", callerTBA);
        console2.log("callId:", callId);
        console2.log("Pneuma protocol layer is live.");
    }
}
