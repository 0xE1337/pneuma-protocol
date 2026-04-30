// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {SoulNFT} from "../src/SoulNFT.sol";
import {SoulAccount} from "../src/SoulAccount.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {ReputationGraph} from "../src/ReputationGraph.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice ReputationGraph 端到端测试 —— V6.0.2 担保图全部 invariant
contract ReputationGraphTest is Test {
    ERC6551Registry public registry;
    SoulAccount public accountImpl;
    SoulNFT public soulNFT;
    PneumaAttestation public attestation;
    MockUSDC public usdc;
    ReputationGraph public graph;

    address public admin = address(0xA11CE);
    address public alice = address(0xA11CE2); // endorser
    address public bob = address(0xB0B);       // endorsee
    address public charlie = address(0xC4471E); // 第二 endorser
    address public mallory = address(0xBAD);    // attacker (no Soul)
    address public skillRegistryMock = address(0x57A11);
    address public victim = address(0xDEAD);    // harmedParty for slash

    uint256 public constant DEFAULT_STAKE = 100 * 1e6; // 100 USDC

    function setUp() public {
        registry = new ERC6551Registry();
        accountImpl = new SoulAccount();
        usdc = new MockUSDC();
        attestation = new PneumaAttestation(admin);

        vm.prank(admin);
        soulNFT = new SoulNFT(address(registry), address(accountImpl), address(attestation));

        graph = new ReputationGraph(address(usdc), address(soulNFT), admin);

        // 给所有用户 mint Soul（除 mallory 外）+ USDC
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");
        vm.prank(bob);
        soulNFT.publicMint("Bob", "");
        vm.prank(charlie);
        soulNFT.publicMint("Charlie", "");

        usdc.mint(alice, 10_000 * 1e6);
        usdc.mint(charlie, 10_000 * 1e6);
        usdc.mint(mallory, 10_000 * 1e6);

        // 授权 SLASH_HOOK_ROLE 给 mock SkillRegistry
        vm.prank(admin);
        graph.grantSlashHook(skillRegistryMock);
    }

    function _approveAndEndorse(address endorser, address endorsee, uint256 stake)
        internal
        returns (uint256 eid)
    {
        vm.prank(endorser);
        usdc.approve(address(graph), stake);
        vm.prank(endorser);
        eid = graph.endorse(endorsee, stake, "trusted partner");
    }

    // ─────────────────────── Endorse ───────────────────────

    function test_Endorse_HappyPath() public {
        vm.prank(alice);
        usdc.approve(address(graph), DEFAULT_STAKE);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 eid = graph.endorse(bob, DEFAULT_STAKE, "trusted partner");

        assertEq(eid, 1);

        ReputationGraph.Endorsement memory e = graph.getEndorsement(eid);
        assertEq(e.endorser, alice);
        assertEq(e.endorsee, bob);
        assertEq(e.stakedAmount, DEFAULT_STAKE);
        assertTrue(e.active);
        assertEq(e.unlockRequestedAt, 0);

        // funds locked in graph
        assertEq(usdc.balanceOf(alice), aliceBalBefore - DEFAULT_STAKE);
        assertEq(usdc.balanceOf(address(graph)), DEFAULT_STAKE);

        // aggregate views
        assertEq(graph.totalActiveStakeTo(bob), DEFAULT_STAKE);
        assertEq(graph.getActiveEndorsementId(alice, bob), eid);
    }

    function test_Endorse_NoSoul_Reverts() public {
        // mallory 没 Soul
        vm.prank(mallory);
        usdc.approve(address(graph), DEFAULT_STAKE);

        vm.prank(mallory);
        vm.expectRevert(ReputationGraph.NotSoulHolder.selector);
        graph.endorse(bob, DEFAULT_STAKE, "");
    }

    function test_Endorse_EndorseeNoSoul_Reverts() public {
        vm.prank(alice);
        usdc.approve(address(graph), DEFAULT_STAKE);

        vm.prank(alice);
        vm.expectRevert(ReputationGraph.NotSoulHolder.selector);
        graph.endorse(mallory, DEFAULT_STAKE, "");
    }

    function test_Endorse_SelfRevert() public {
        vm.prank(alice);
        usdc.approve(address(graph), DEFAULT_STAKE);

        vm.prank(alice);
        vm.expectRevert(ReputationGraph.CannotEndorseSelf.selector);
        graph.endorse(alice, DEFAULT_STAKE, "");
    }

    function test_Endorse_StakeBelowMin_Reverts() public {
        vm.prank(alice);
        usdc.approve(address(graph), 100); // below 1 USDC default minStake

        vm.prank(alice);
        vm.expectRevert(ReputationGraph.StakeTooLow.selector);
        graph.endorse(bob, 100, "");
    }

    function test_Endorse_DuplicatePairRejected() public {
        _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(alice);
        usdc.approve(address(graph), DEFAULT_STAKE);
        vm.prank(alice);
        vm.expectRevert(ReputationGraph.AlreadyEndorsing.selector);
        graph.endorse(bob, DEFAULT_STAKE, "second");
    }

    function test_Endorse_ContextTooLong_Reverts() public {
        vm.prank(alice);
        usdc.approve(address(graph), DEFAULT_STAKE);

        bytes memory bs = new bytes(281);
        for (uint256 i; i < 281; ++i) bs[i] = "x";
        string memory longCtx = string(bs);

        vm.prank(alice);
        vm.expectRevert(ReputationGraph.ContextTooLong.selector);
        graph.endorse(bob, DEFAULT_STAKE, longCtx);
    }

    function test_Endorse_MultipleEndorsersToSameEndorsee() public {
        _approveAndEndorse(alice, bob, DEFAULT_STAKE);
        _approveAndEndorse(charlie, bob, DEFAULT_STAKE * 2);

        assertEq(graph.totalActiveStakeTo(bob), DEFAULT_STAKE * 3);
        uint256[] memory active = graph.getActiveEndorsementsTo(bob);
        assertEq(active.length, 2);
    }

    // ─────────────────────── Unlock + Withdraw ───────────────────────

    function test_RequestUnlock_AndWithdrawAfterDelay() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(alice);
        graph.requestUnlock(eid);

        // before delay
        vm.expectRevert(ReputationGraph.UnlockStillPending.selector);
        vm.prank(alice);
        graph.withdraw(eid);

        // skip 24h
        skip(24 hours + 1);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        graph.withdraw(eid);

        assertEq(usdc.balanceOf(alice), aliceBalBefore + DEFAULT_STAKE);
        assertEq(graph.totalActiveStakeTo(bob), 0);

        // active list emptied
        uint256[] memory active = graph.getActiveEndorsementsTo(bob);
        assertEq(active.length, 0);

        // pair lock released - can re-endorse
        assertEq(graph.getActiveEndorsementId(alice, bob), 0);
    }

    function test_RequestUnlock_NotEndorser_Reverts() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(charlie);
        vm.expectRevert(ReputationGraph.NotEndorser.selector);
        graph.requestUnlock(eid);
    }

    function test_RequestUnlock_DoubleRequest_Reverts() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.startPrank(alice);
        graph.requestUnlock(eid);
        vm.expectRevert(ReputationGraph.UnlockStillPending.selector);
        graph.requestUnlock(eid);
        vm.stopPrank();
    }

    function test_Withdraw_BeforeRequest_Reverts() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(alice);
        vm.expectRevert(ReputationGraph.UnlockNotRequested.selector);
        graph.withdraw(eid);
    }

    // ─────────────────────── Slash Hook ───────────────────────

    function test_OnEndorseeSlashed_BasicProportional() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        // 50% slash
        uint256 slashBps = 5_000;
        uint256 victimBalBefore = usdc.balanceOf(victim);

        vm.prank(skillRegistryMock);
        graph.onEndorseeSlashed(bob, slashBps, victim);

        uint256 expectedSlash = (DEFAULT_STAKE * slashBps) / 10_000;
        assertEq(usdc.balanceOf(victim), victimBalBefore + expectedSlash);

        ReputationGraph.Endorsement memory e = graph.getEndorsement(eid);
        assertEq(e.stakedAmount, DEFAULT_STAKE - expectedSlash);
        assertTrue(e.active, "slash does not flip active, only reduces stake");

        assertEq(graph.totalActiveStakeTo(bob), DEFAULT_STAKE - expectedSlash);
    }

    function test_OnEndorseeSlashed_FullSlash() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(skillRegistryMock);
        graph.onEndorseeSlashed(bob, 10_000, victim); // 100%

        ReputationGraph.Endorsement memory e = graph.getEndorsement(eid);
        assertEq(e.stakedAmount, 0);
        assertEq(usdc.balanceOf(victim), DEFAULT_STAKE);
    }

    function test_OnEndorseeSlashed_OnlyAuthorized() public {
        _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(mallory);
        vm.expectRevert();
        graph.onEndorseeSlashed(bob, 5_000, victim);
    }

    function test_OnEndorseeSlashed_AffectsAllActiveEndorsers() public {
        _approveAndEndorse(alice, bob, DEFAULT_STAKE);
        _approveAndEndorse(charlie, bob, DEFAULT_STAKE * 2);

        uint256 victimBalBefore = usdc.balanceOf(victim);

        vm.prank(skillRegistryMock);
        graph.onEndorseeSlashed(bob, 1_000, victim); // 10%

        // alice 100 * 10% = 10 USDC; charlie 200 * 10% = 20 USDC
        assertEq(usdc.balanceOf(victim), victimBalBefore + 10 * 1e6 + 20 * 1e6);
    }

    function test_OnEndorseeSlashed_PendingUnlock_StillSlashed() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        // alice 启动撤保
        vm.prank(alice);
        graph.requestUnlock(eid);

        // 撤保 24h 倒计时中 bob 出事 → alice 仍被联动 slash（这是设计）
        vm.prank(skillRegistryMock);
        graph.onEndorseeSlashed(bob, 5_000, victim);

        ReputationGraph.Endorsement memory e = graph.getEndorsement(eid);
        assertEq(e.stakedAmount, DEFAULT_STAKE / 2, "pending-unlock endorsement still subject to slash");
    }

    function test_OnEndorseeSlashed_ZeroBpsNoOp() public {
        _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        uint256 victimBalBefore = usdc.balanceOf(victim);
        vm.prank(skillRegistryMock);
        graph.onEndorseeSlashed(bob, 0, victim);
        assertEq(usdc.balanceOf(victim), victimBalBefore);
    }

    function test_OnEndorseeSlashed_BpsTooHigh_Reverts() public {
        vm.prank(skillRegistryMock);
        vm.expectRevert(ReputationGraph.InvalidSlashBps.selector);
        graph.onEndorseeSlashed(bob, 20_000, victim);
    }

    // ─────────────────────── Governance ───────────────────────

    function test_SetMinStake_GovernorOnly() public {
        vm.prank(admin);
        graph.setMinStake(5 * 1e6);
        assertEq(graph.minStake(), 5 * 1e6);

        vm.prank(alice);
        vm.expectRevert();
        graph.setMinStake(1);
    }

    function test_RevokeSlashHook() public {
        vm.prank(admin);
        graph.revokeSlashHook(skillRegistryMock);

        vm.prank(skillRegistryMock);
        vm.expectRevert();
        graph.onEndorseeSlashed(bob, 5_000, victim);
    }

    // ─────────────────────── Combined / Realistic Flow ───────────────────────

    function test_RealisticFlow_EndorseSlashWithdraw() public {
        // alice 担保 bob 100 USDC，charlie 担保 bob 50 USDC
        uint256 eA = _approveAndEndorse(alice, bob, 100 * 1e6);
        uint256 eC = _approveAndEndorse(charlie, bob, 50 * 1e6);

        // bob 出事，被 slash 20% （SkillRegistry 触发）
        vm.prank(skillRegistryMock);
        graph.onEndorseeSlashed(bob, 2_000, victim);

        // alice 100 - 20 = 80; charlie 50 - 10 = 40
        assertEq(graph.getEndorsement(eA).stakedAmount, 80 * 1e6);
        assertEq(graph.getEndorsement(eC).stakedAmount, 40 * 1e6);
        assertEq(usdc.balanceOf(victim), 30 * 1e6); // 20 + 10

        // alice 决定撤保
        vm.prank(alice);
        graph.requestUnlock(eA);
        skip(24 hours + 1);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        graph.withdraw(eA);
        assertEq(usdc.balanceOf(alice), aliceBalBefore + 80 * 1e6, "alice withdraws remaining stake");

        // charlie 仍 active
        assertEq(graph.totalActiveStakeTo(bob), 40 * 1e6);
    }

    function test_ReEndorseAfterWithdraw() public {
        uint256 eid = _approveAndEndorse(alice, bob, DEFAULT_STAKE);

        vm.prank(alice);
        graph.requestUnlock(eid);
        skip(24 hours + 1);
        vm.prank(alice);
        graph.withdraw(eid);

        // 现在可以重新担保
        vm.prank(alice);
        usdc.approve(address(graph), DEFAULT_STAKE);
        vm.prank(alice);
        uint256 newEid = graph.endorse(bob, DEFAULT_STAKE, "round 2");
        assertEq(newEid, 2, "new endorsementId");
    }
}
