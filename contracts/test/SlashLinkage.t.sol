// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {SoulNFT} from "../src/SoulNFT.sol";
import {SoulAccount} from "../src/SoulAccount.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {ReputationGraph} from "../src/ReputationGraph.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice V6.0.2 SkillRegistry → ReputationGraph slash 联动端到端测试
///
/// 验证：
///   1. claimTimeoutAndSlash 路径触发 endorser 联动 slash
///   2. slashOnRevoke 路径触发 endorser 联动 slash
///   3. ReputationGraph 未配置时 slash 行为跟 v5 一致（向后兼容）
contract SlashLinkageTest is Test {
    ERC6551Registry public registry;
    SoulAccount public accountImpl;
    SoulNFT public soulNFT;
    PneumaAttestation public attestation;
    MockUSDC public usdc;
    SkillRegistry public skillRegistry;
    ReputationGraph public graph;

    address public admin = address(0xA11CE);
    address public alice = address(0xA11CE2);     // caller（被欺骗方，slash 资金接收人）
    address public bob = address(0xB0B);           // provider（skill owner，被 slash 方）
    address public carol = address(0xCA401);       // endorser（给 bob 担保的人）

    address public aliceTBA;

    function setUp() public {
        registry = new ERC6551Registry();
        accountImpl = new SoulAccount();
        usdc = new MockUSDC();
        attestation = new PneumaAttestation(admin);

        vm.prank(admin);
        soulNFT = new SoulNFT(address(registry), address(accountImpl), address(attestation));

        skillRegistry = new SkillRegistry(address(usdc), address(attestation), admin);
        graph = new ReputationGraph(address(usdc), address(soulNFT), admin);

        // 反向授权
        vm.startPrank(admin);
        attestation.grantRole(attestation.ATTESTER_ROLE(), address(skillRegistry));
        attestation.setSkillRegistry(address(skillRegistry));
        // V6.0.2: SkillRegistry 持 SLASH_HOOK_ROLE 才能触发 graph.onEndorseeSlashed
        graph.grantSlashHook(address(skillRegistry));
        // SkillRegistry 知道 graph 地址才能调用
        skillRegistry.setReputationGraph(address(graph));
        vm.stopPrank();

        // mint Souls + USDC
        vm.prank(alice);
        (, aliceTBA) = soulNFT.publicMint("Alice", "");
        vm.prank(bob);
        soulNFT.publicMint("Bob", "");
        vm.prank(carol);
        soulNFT.publicMint("Carol", "");

        usdc.mint(alice, 1000 * 1e6);
        usdc.mint(bob, 1000 * 1e6);
        usdc.mint(carol, 1000 * 1e6);
    }

    function test_TimeoutSlash_LinkagesToEndorser() public {
        // bob 注册 skill 锁 100 USDC stake，slashBps = 5000 (50%)
        vm.startPrank(bob);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        uint256 skillId = skillRegistry.registerSkill(
            "S", "d", "e", "finance",
            10 * 1e6, // 10 USDC per call
            100 * 1e6, // 100 USDC stake
            1 hours, // SLA
            5_000, // 50% slashBps
            4096, 8192
        );
        vm.stopPrank();

        // carol 给 bob 担保 200 USDC
        vm.startPrank(carol);
        usdc.approve(address(graph), 200 * 1e6);
        graph.endorse(bob, 200 * 1e6, "trusted partner");
        vm.stopPrank();

        // alice 调 bob 的 skill
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 10 * 1e6);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("payment1"), 1024, 0);
        vm.stopPrank();

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        // 时间快进过 SLA → 任何人触发 timeout slash
        skip(2 hours);
        vm.prank(alice);
        skillRegistry.claimTimeoutAndSlash(callId);

        // 1) bob 的 skill stake 被 slash 50% = 50 USDC → alice
        // 2) carol 的 endorsement stake 被联动 slash 50% = 100 USDC → alice
        // 3) alice 收到 escrow 退还 10 USDC
        // 总计: alice 应增加 = 10 (escrow refund) + 50 (skill slash) + 100 (endorser slash) = 160 USDC
        uint256 aliceBalAfter = usdc.balanceOf(alice);
        assertEq(aliceBalAfter - aliceBalBefore, 160 * 1e6, "alice gets refund + dual slash");

        // carol 的 endorsement stake 减半
        uint256[] memory carolEndorsements = graph.getEndorsementsByEndorser(carol);
        assertEq(carolEndorsements.length, 1);
        ReputationGraph.Endorsement memory e = graph.getEndorsement(carolEndorsements[0]);
        assertEq(e.stakedAmount, 100 * 1e6, "carol stake slashed 50%");
        assertTrue(e.active, "endorsement still active after partial slash");
    }

    function test_RevokeSlash_LinkagesToEndorser() public {
        // 同上但走 revoke 路径
        vm.startPrank(bob);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        uint256 skillId = skillRegistry.registerSkill(
            "S", "d", "e", "finance",
            10 * 1e6, 100 * 1e6, 1 hours, 5_000, 4096, 8192
        );
        vm.stopPrank();

        vm.startPrank(carol);
        usdc.approve(address(graph), 200 * 1e6);
        graph.endorse(bob, 200 * 1e6, "trusted partner");
        vm.stopPrank();

        // alice escrow + bob settle (生成 attestation)
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 10 * 1e6);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("p"), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        bytes32 attestUid = skillRegistry.settleCall(callId, 0, 5, "");

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 carolStakeBefore = graph.totalActiveStakeTo(bob);

        // SkillRegistry 是 attester，由其 revoke 触发 slashOnRevoke → 联动 slash carol
        // （现实中 dispute 流程会由仲裁机制 / governor 走，hackathon 简化为 attester 自 revoke）
        vm.prank(address(skillRegistry));
        attestation.revoke(attestUid);

        // alice 应收到 50 USDC (skill slash) + 100 USDC (endorser slash) = 150 USDC
        // 注意：revoke 路径没退 escrow（escrow 已 settle 给 bob 了）
        assertEq(
            usdc.balanceOf(alice) - aliceBalBefore,
            150 * 1e6,
            "alice gets skill slash + endorser slash via revoke"
        );

        // carol stake 被减
        uint256 carolStakeAfter = graph.totalActiveStakeTo(bob);
        assertEq(carolStakeBefore - carolStakeAfter, 100 * 1e6);
    }

    function test_BackwardCompat_NoGraphConfigured_NoLinkageTriggered() public {
        // 把 graph 卸载
        vm.prank(admin);
        skillRegistry.setReputationGraph(address(0));

        // 同样流程
        vm.startPrank(bob);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        uint256 skillId = skillRegistry.registerSkill(
            "S", "d", "e", "finance",
            10 * 1e6, 100 * 1e6, 1 hours, 5_000, 4096, 8192
        );
        vm.stopPrank();

        // carol 担保（但 graph 不会被联动）
        vm.startPrank(carol);
        usdc.approve(address(graph), 200 * 1e6);
        graph.endorse(bob, 200 * 1e6, "trusted partner");
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 10 * 1e6);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        skip(2 hours);
        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        skillRegistry.claimTimeoutAndSlash(callId);

        // 只有 skill slash 50 USDC + escrow refund 10 USDC = 60 USDC（无担保联动）
        assertEq(usdc.balanceOf(alice) - aliceBalBefore, 60 * 1e6);

        // carol stake 不变
        assertEq(graph.totalActiveStakeTo(bob), 200 * 1e6);
    }

    function test_NoEndorsement_GraphConfigured_NoOpButNoCrash() public {
        // graph 已配置但 bob 没人担保 → slash 不应该 crash
        vm.startPrank(bob);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        uint256 skillId = skillRegistry.registerSkill(
            "S", "d", "e", "finance",
            10 * 1e6, 100 * 1e6, 1 hours, 5_000, 4096, 8192
        );
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 10 * 1e6);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        skip(2 hours);
        vm.prank(alice);
        skillRegistry.claimTimeoutAndSlash(callId);
        // 不 revert 即可
    }
}
