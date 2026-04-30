// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

interface ISkillRegistry {
    function registerSkill(
        string calldata name,
        string calldata description,
        string calldata endpoint,
        string calldata category,
        uint256 pricePerCall
    ) external returns (uint256 skillId);
}

/// @notice One-shot script — register YOUR skill in Pneuma SkillRegistry
/// @dev    Run from package root:
///           pnpm register
///         (which expands to:)
///           forge script script/RegisterMySkill.s.sol \
///             --rpc-url $ARC_TESTNET_RPC_URL \
///             --private-key $DEPLOYER_PRIVATE_KEY --broadcast
///
///         Pre-requisites:
///           - .env.local copied from .env.example
///           - SKILL_NAME / DESCRIPTION / CATEGORY / PRICE_USDC filled in
///           - DEPLOYER_PRIVATE_KEY funded with USDC on Arc Testnet for gas
contract RegisterMySkill is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");

        string memory name = vm.envString("SKILL_NAME");
        string memory description = vm.envString("SKILL_DESCRIPTION");
        string memory category = vm.envString("SKILL_CATEGORY");
        // SKILL_PRICE_USDC：以整数 USDC 计价，乘 1e6 转成 USDC 最小单位（6 decimals）
        uint256 priceInUsdc = vm.envUint("SKILL_PRICE_USDC");
        uint256 port = vm.envOr("SKILL_PORT", uint256(3010));

        // hackathon 默认：endpoint = http://localhost:$PORT/api/run
        // production：把它改成你的真公网 URL（必须支持 CORS）
        string memory endpoint =
            string.concat("http://localhost:", _u2s(port), "/api/run");

        console2.log("=== Register My Pneuma Skill ===");
        console2.log("name:        ", name);
        console2.log("description: ", description);
        console2.log("category:    ", category);
        console2.log("price (USDC):", priceInUsdc);
        console2.log("endpoint:    ", endpoint);
        console2.log("");

        ISkillRegistry registry = ISkillRegistry(skillRegistryAddr);

        vm.startBroadcast(deployerPrivateKey);
        uint256 skillId = registry.registerSkill(
            name, description, endpoint, category, priceInUsdc * 1e6
        );
        vm.stopBroadcast();

        console2.log("");
        console2.log("=== ✅ Skill registered ===");
        console2.log("skillId:", skillId);
        console2.log("");
        console2.log("Now paste this into .env.local:");
        console2.log("SKILL_ID=", skillId);
        console2.log("");
        console2.log("Then run `pnpm dev` to start your skill server.");
    }

    /// @dev minimal uint -> ascii string for endpoint composition
    function _u2s(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 digits;
        while (tmp != 0) {
            digits++;
            tmp /= 10;
        }
        bytes memory buf = new bytes(digits);
        while (v != 0) {
            digits--;
            buf[digits] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }
        return string(buf);
    }
}
