// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PneumaCourt} from "../src/PneumaCourt.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";

/// @notice V6.1 增量部署：只部 PneumaCourt + wire setPneumaCourt
/// @dev 假设 V6.0 合约已部署且不需要重部。读 .env.local 已有的 SkillRegistry 地址。
///      使用前请确保：
///        - SkillRegistry 已部署且 deployer 持 GOVERNOR_ROLE
///        - 当前 SkillRegistry 包含 V6.1 新增的 setPneumaCourt() 函数（即重部署过的版本）
///
///      运行：
///        forge script script/DeployCourt.s.sol \
///          --rpc-url $ARC_TESTNET_RPC_URL \
///          --private-key $DEPLOYER_PRIVATE_KEY \
///          --broadcast --legacy
contract DeployCourt is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");
        address soulNftAddr = vm.envAddress("NEXT_PUBLIC_SOUL_NFT_ADDRESS");
        require(skillRegistryAddr != address(0), "DeployCourt: SKILL_REGISTRY missing");
        require(soulNftAddr != address(0), "DeployCourt: SOUL_NFT missing");

        console2.log("=== Pneuma Court v0.1 Incremental Deploy ===");
        console2.log("Deployer:        ", deployer);
        console2.log("SkillRegistry:   ", skillRegistryAddr);
        console2.log("SoulNFT:         ", soulNftAddr);
        console2.log("");

        vm.startBroadcast(deployerKey);

        PneumaCourt court = new PneumaCourt(skillRegistryAddr, soulNftAddr, deployer);
        console2.log("PneumaCourt:     ", address(court));

        // wire SkillRegistry to know court address
        SkillRegistry(skillRegistryAddr).setPneumaCourt(address(court));
        console2.log("Wired SkillRegistry <- PneumaCourt (slashOnCourtRuling allowed)");

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Court Deploy Complete ===");
        console2.log("Add to .env.local:");
        console2.log("NEXT_PUBLIC_PNEUMA_COURT_ADDRESS=", address(court));
    }
}
