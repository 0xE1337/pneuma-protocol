// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PneumaCourt} from "../src/PneumaCourt.sol";

/// @notice 只部署 PneumaCourt，不 wire 到 SkillRegistry
/// @dev 当前已部署的 SkillRegistry 是 V6.0（没有 setPneumaCourt 函数）。
///      Court 跑独立 dispute lifecycle —— file / vote / finalize 全套可演示。
///      `slashOnCourtRuling` 联动 slash 留到 SkillRegistry 重部时再开。
contract DeployCourtOnly is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");
        address soulNftAddr = vm.envAddress("NEXT_PUBLIC_SOUL_NFT_ADDRESS");
        require(skillRegistryAddr != address(0), "DeployCourtOnly: SKILL_REGISTRY missing");
        require(soulNftAddr != address(0), "DeployCourtOnly: SOUL_NFT missing");

        console2.log("=== Pneuma Court (standalone) Deploy ===");
        console2.log("Deployer:        ", deployer);
        console2.log("SkillRegistry:   ", skillRegistryAddr);
        console2.log("SoulNFT:         ", soulNftAddr);

        vm.startBroadcast(deployerKey);
        PneumaCourt court = new PneumaCourt(skillRegistryAddr, soulNftAddr, deployer);
        vm.stopBroadcast();

        console2.log("PneumaCourt:     ", address(court));
        console2.log("");
        console2.log("Add to .env.local:");
        console2.log("NEXT_PUBLIC_PNEUMA_COURT_ADDRESS=", address(court));
        console2.log("");
        console2.log("Note: SkillRegistry v6.0 has no setPneumaCourt() yet,");
        console2.log("so guilty verdicts will not auto-slash. Wire it up when");
        console2.log("SkillRegistry is redeployed with v6.1.");
    }
}
