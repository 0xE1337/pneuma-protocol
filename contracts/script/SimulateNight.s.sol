// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {SoulNFT} from "../src/SoulNFT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title SimulateNight — "小陈睡觉赚钱" demo 的洪峰模拟
/// @notice 三个 caller（Tokyo / Berlin / SF）×4 次调用 = 12 次 escrow→settle→rate 完整闭环
///         每个 caller 的 4 次调用输入大小渐变（1KB → 5KB），让 USDC 单价覆盖 1.2-5.2 区间
///         总流水预期 ≈ 40-50 USDC（贴近"小陈一晚 47.3 USDC"故事数字）
///
///         所有 tx 真上链 Arc Testnet。/admin/dashboard 实时事件流可同步看到 12 条 event 滚入
///         （CallEscrowed / CallSettled / CallerRatedSkill 三类，每单各一条 → 36 条事件）
///
/// @dev 前置：
///   1. 跑 SetupNight.s.sol，把输出的 TRANSLATE_PRO_SKILL_ID 写入 .env.local
///   2. .env.local 须含 DEPLOYER + AGENT_CALLER + AGENT_FINANCE2 + AGENT_CHAT2 四把 key
///
///   forge script script/SimulateNight.s.sol \
///       --rpc-url $ARC_TESTNET_RPC_URL \
///       --broadcast --legacy --skip-simulation
contract SimulateNight is Script {
    /// @dev 4 档输入大小，渐变让单价从 1.2 USDC 爬到 5.2 USDC
    uint32[4] internal INPUT_SIZES = [uint32(800), uint32(2200), uint32(3500), uint32(5000)];

    /// @dev 对应 maxOutputBytes（escrow 锁定上限）
    uint32[4] internal MAX_OUTPUT_SIZES = [uint32(1024), uint32(2500), uint32(4000), uint32(5500)];

    /// @dev 对应 actualOutputBytes（settle 实际值，永远 ≤ max → 触发 per-byte refund 给 caller）
    uint32[4] internal ACTUAL_OUTPUT_SIZES = [uint32(700), uint32(1900), uint32(3200), uint32(4400)];

    /// @dev 4 档评分（caller→provider 的反向评分），都给 4-5 星，符合"专业"故事
    uint8[4] internal CALLER_RATINGS = [5, 4, 5, 5];

    /// @dev 4 档评论（caller→provider）
    string[4] internal CALLER_COMMENTS = [
        "Terminology spot-on, fast turnaround.",
        "Good. Minor stylistic edits needed.",
        "Excellent legal-doc translation, will use again.",
        "Top-tier quality on long medical abstract."
    ];

    /// @dev provider→caller 的正向评分
    uint8 internal constant PROVIDER_RATING = 5;
    string internal constant PROVIDER_COMMENT = "Clear request, clean payload.";

    function run() external {
        uint256 providerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 tokyoKey = vm.envUint("AGENT_CALLER_PRIVATE_KEY");
        uint256 berlinKey = vm.envUint("AGENT_FINANCE2_PRIVATE_KEY");
        uint256 sfKey = vm.envUint("AGENT_CHAT2_PRIVATE_KEY");

        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");
        address soulNftAddr = vm.envAddress("NEXT_PUBLIC_SOUL_NFT_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 skillId = vm.envUint("TRANSLATE_PRO_SKILL_ID");

        SkillRegistry registry = SkillRegistry(skillRegistryAddr);
        SoulNFT soul = SoulNFT(soulNftAddr);
        IERC20 token = IERC20(usdc);

        console2.log("=== Pneuma Demo | 12-Call Sleep-Night Burst ===");
        console2.log("translate-pro skillId:", skillId);
        console2.log("");

        _runCallerBatch(registry, soul, token, providerKey, tokyoKey, "Tokyo", skillId, usdc);
        _runCallerBatch(registry, soul, token, providerKey, berlinKey, "Berlin", skillId, usdc);
        _runCallerBatch(registry, soul, token, providerKey, sfKey, "SF", skillId, usdc);

        console2.log("");
        console2.log("=== Burst complete ===");
        console2.log("Verify on /admin/dashboard or /profile/<deployer-soul-id>");
        console2.log("All tx hashes printed above are real Arc Testnet --");
        console2.log("paste any one into testnet.arcscan.app to inspect on-chain.");
    }

    /// @dev 对单个 caller 跑 4 轮调用
    function _runCallerBatch(
        SkillRegistry registry,
        SoulNFT soul,
        IERC20 token,
        uint256 providerKey,
        uint256 callerKey,
        string memory label,
        uint256 skillId,
        address usdc
    ) internal {
        address caller = vm.addr(callerKey);
        uint256 callerSoulId = _findFirstSoulOf(soul, caller);
        require(callerSoulId != 0, string.concat("caller has no Soul: ", label));
        address callerTBA = soul.tbaOf(callerSoulId);

        console2.log("");
        console2.log(string.concat("--- ", label, " batch ---"));
        console2.log("  caller EOA :", caller);
        console2.log("  caller Soul:", callerSoulId);
        console2.log("  caller TBA :", callerTBA);

        // 4 轮调用前先 approve 一笔大额，避免每次单独 approve 浪费 gas + tx 数
        // 总预算上限：4 * 6 USDC = 24 USDC
        vm.startBroadcast(callerKey);
        token.approve(address(registry), 24_000_000);
        vm.stopBroadcast();

        for (uint256 i = 0; i < 4; i++) {
            _runOneCall(
                registry,
                providerKey,
                callerKey,
                callerTBA,
                skillId,
                INPUT_SIZES[i],
                MAX_OUTPUT_SIZES[i],
                ACTUAL_OUTPUT_SIZES[i],
                CALLER_RATINGS[i],
                CALLER_COMMENTS[i],
                i + 1
            );
        }
    }

    /// @dev 单次调用闭环：caller escrow → provider settle → caller reverse-rate
    function _runOneCall(
        SkillRegistry registry,
        uint256 providerKey,
        uint256 callerKey,
        address callerTBA,
        uint256 skillId,
        uint32 inputBytes,
        uint32 maxOutputBytes,
        uint32 actualOutputBytes,
        uint8 callerRating,
        string memory callerComment,
        uint256 roundIdx
    ) internal {
        // 1. caller escrow
        bytes32 paymentHash = keccak256(
            abi.encode("pneuma-night", callerTBA, skillId, block.timestamp, roundIdx)
        );
        vm.startBroadcast(callerKey);
        uint256 callId = registry.escrowForCall(skillId, callerTBA, paymentHash, inputBytes, maxOutputBytes);
        vm.stopBroadcast();

        // 2. provider settle (含 per-byte refund：actualOutput < maxOutput → 自动退差额)
        vm.startBroadcast(providerKey);
        registry.settleCall(callId, actualOutputBytes, PROVIDER_RATING, PROVIDER_COMMENT);
        vm.stopBroadcast();

        // 3. caller reverse-rate
        vm.startBroadcast(callerKey);
        registry.callerRateSkill(callId, callerRating, callerComment);
        vm.stopBroadcast();

        console2.log(string.concat("  [round ", _u2s(roundIdx), "] callId="), callId);
        console2.log("    inputBytes :", inputBytes);
        console2.log("    maxOutput  :", maxOutputBytes);
        console2.log("    actualOut  :", actualOutputBytes);
        console2.log("    callerStar :", uint256(callerRating));
    }

    /// @dev 反查某个地址持有的第一个 Soul tokenId（O(N), N=totalMinted）
    function _findFirstSoulOf(SoulNFT soul, address owner) internal view returns (uint256) {
        uint256 minted = soul.totalMinted();
        for (uint256 i = 1; i <= minted; i++) {
            try soul.ownerOf(i) returns (address o) {
                if (o == owner) {
                    return i;
                }
            } catch {
                continue; // burned token → skip
            }
        }
        return 0;
    }

    /// @dev uint → string（forge 没现成 short helper）
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
            digits -= 1;
            buf[digits] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }
        return string(buf);
    }
}
