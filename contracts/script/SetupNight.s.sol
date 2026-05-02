// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";

/// @title SetupNight — 一次性 skill 注册脚本（"小陈睡觉赚钱" demo）
/// @notice 只做一件事：在 SkillRegistry 注册 "translate-pro" V5 per-byte skill
///         （owner = DEPLOYER = "小陈"）
///         - baseFee = 0.03 USDC, input 0.03/KB, output 0.2/KB
///         - 让 1-5 KB 输入产生 0.26-1.18 USDC 单价 → 12 单 ~7-9 USDC 故事流水
///
/// @dev 为什么只做 skill 注册不做 USDC funding：
///      Arc Circle USDC 的 isBlocklisted precompile (0x1800...0001) 在 forge
///      内部 EVM 解释器下会 StackUnderflow，导致任何 `transfer` / `transferFrom`
///      调用都 revert。--skip-simulation 只跳过 broadcast 前的 simulation，
///      不跳过脚本本身的 EVM 解释执行 → USDC 路径必须用 cast send，绕过解释器。
///
/// @dev 使用方式：
///   cd contracts
///   forge script script/SetupNight.s.sol \
///       --rpc-url $ARC_TESTNET_RPC_URL \
///       --broadcast --legacy
///
///   跑完后把脚本输出的 TRANSLATE_PRO_SKILL_ID=N 写到 .env.local
///   funding + 12-call burst 由 scripts/demo-night.sh 用 cast send 完成
contract SetupNight is Script {
    function run() external {
        uint256 providerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address provider = vm.addr(providerKey);

        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");

        SkillRegistry registry = SkillRegistry(skillRegistryAddr);

        console2.log("=== Pneuma Demo | Sleep-Night Setup ===");
        console2.log("Provider (XiaoChen):", provider);
        console2.log("");

        // ─── 注册 translate-pro skill ─────────────────────────────────
        vm.startBroadcast(providerKey);
        uint256 translateProId = registry.registerSkillFull(
            SkillRegistry.RegisterParams({
                name: "translate-pro",
                description: "XiaoChen Pro Translation (EN/ZH/JA/DE) - human-curated terminology, per-KB billed",
                endpoint: "http://localhost:3002/api/translate",
                category: "text",
                pricePerCall: 0,
                providerStake: 0,
                slaTimeoutSec: 1 hours,
                slashBps: 0,
                maxInputBytes: 8192,         // 8 KB ~ 2k 中文字
                maxOutputBytes: 8192,
                baseFee: 30_000,             // 0.03 USDC connection fee
                inputPricePerKB: 30_000,     // 0.03 USDC / KB input
                outputPricePerKB: 200_000,   // 0.2  USDC / KB output
                upstreamModel: "human-in-the-loop",
                markupBps: 0                 // 自营无中转
            })
        );
        vm.stopBroadcast();

        console2.log("translate-pro registered:");
        console2.log("       skillId  =", translateProId);
        console2.log("       -> add to .env.local: TRANSLATE_PRO_SKILL_ID=", translateProId);
        console2.log("");
        console2.log("=== Setup complete ===");
        console2.log("Next: write TRANSLATE_PRO_SKILL_ID into .env.local, then run:");
        console2.log("  bash scripts/demo-night.sh");
    }
}
