// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {SoulNFT} from "../src/SoulNFT.sol";
import {SoulAccount} from "../src/SoulAccount.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {ReputationGraph} from "../src/ReputationGraph.sol";
import {PneumaCourt} from "../src/PneumaCourt.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice V6.1 PneumaCourt v0.1 端到端测试 —— 全部 10 个 invariant + integration
contract PneumaCourtTest is Test {
    ERC6551Registry public registry;
    SoulAccount public accountImpl;
    SoulNFT public soulNFT;
    PneumaAttestation public attestation;
    MockUSDC public usdc;
    SkillRegistry public skillRegistry;
    ReputationGraph public graph;
    PneumaCourt public court;

    address public admin = address(0xA11CE);
    address public alice = address(0xA11CE2); // plaintiff = caller
    address public bob = address(0xB0B); // defendant = skill owner
    address public juror1 = address(0x91111);
    address public juror2 = address(0x92222);
    address public juror3 = address(0x93333);
    address public juror4 = address(0x94444);
    address public mallory = address(0xBAD); // 不持 Soul

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
        court = new PneumaCourt(address(skillRegistry), address(soulNFT), admin);

        // 反向授权
        vm.startPrank(admin);
        attestation.grantRole(attestation.ATTESTER_ROLE(), address(skillRegistry));
        attestation.setSkillRegistry(address(skillRegistry));
        graph.grantSlashHook(address(skillRegistry));
        skillRegistry.setReputationGraph(address(graph));
        // V6.1 新增：SkillRegistry 知道 court 地址
        skillRegistry.setPneumaCourt(address(court));
        vm.stopPrank();

        // mint Souls
        vm.prank(alice);
        (, aliceTBA) = soulNFT.publicMint("Alice", "");
        vm.prank(bob);
        soulNFT.publicMint("Bob", "");
        vm.prank(juror1);
        soulNFT.publicMint("Juror1", "");
        vm.prank(juror2);
        soulNFT.publicMint("Juror2", "");
        vm.prank(juror3);
        soulNFT.publicMint("Juror3", "");
        vm.prank(juror4);
        soulNFT.publicMint("Juror4", "");

        // USDC 给 alice + bob
        usdc.mint(alice, 1000 * 1e6);
        usdc.mint(bob, 1000 * 1e6);
    }

    /// 公共流程：bob 注册 skill + alice 调用 + bob settle → 拿到一个已 settled 的 callId
    function _setupSettledCall() internal returns (uint256 skillId, uint256 callId) {
        vm.startPrank(bob);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        skillId = skillRegistry.registerSkill(
            "S",
            "d",
            "e",
            "finance",
            10 * 1e6, // 10 USDC per call
            100 * 1e6, // 100 USDC stake
            1 hours,
            5_000, // 50% slashBps
            4096,
            8192
        );
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 10 * 1e6);
        callId = skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("p"), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        skillRegistry.settleCall(callId, 0, 5, "");
    }

    function _defaultJurors() internal view returns (address[] memory) {
        address[] memory j = new address[](3);
        j[0] = juror1;
        j[1] = juror2;
        j[2] = juror3;
        return j;
    }

    // ─────────────────────── fileDispute ───────────────────────

    function test_FileDispute_HappyPath() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(
            callId, keccak256("ipfs://evidence"), "Bob delivered garbage", _defaultJurors()
        );

        assertEq(disputeId, 1);

        (
            uint256 retCallId,
            address plaintiff,
            address defendant,
            ,
            ,
            address[] memory jurorList,
            ,
            ,
            ,
            PneumaCourt.DisputeStatus status,
            PneumaCourt.Verdict verdict
        ) = court.getDispute(disputeId);

        assertEq(retCallId, callId);
        assertEq(plaintiff, alice);
        assertEq(defendant, bob);
        assertEq(jurorList.length, 3);
        assertEq(uint256(status), uint256(PneumaCourt.DisputeStatus.Voting));
        assertEq(uint256(verdict), uint256(PneumaCourt.Verdict.Pending));
        assertTrue(court.isCallDisputed(callId));
    }

    function test_FileDispute_NotPlaintiff_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(bob); // bob 不是 caller
        vm.expectRevert(PneumaCourt.NotPlaintiff.selector);
        court.fileDispute(callId, keccak256("e"), "", _defaultJurors());
    }

    function test_FileDispute_DuplicateRevert() public {
        (, uint256 callId) = _setupSettledCall();

        vm.startPrank(alice);
        court.fileDispute(callId, keccak256("e1"), "", _defaultJurors());
        vm.expectRevert(PneumaCourt.CallAlreadyDisputed.selector);
        court.fileDispute(callId, keccak256("e2"), "", _defaultJurors());
        vm.stopPrank();
    }

    function test_FileDispute_TooFewJurors_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](2);
        j[0] = juror1;
        j[1] = juror2;

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.TooFewJurors.selector);
        court.fileDispute(callId, keccak256("e"), "", j);
    }

    function test_FileDispute_TooManyJurors_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](12);
        for (uint256 i; i < 12; ++i) j[i] = address(uint160(0xC000 + i));

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.TooManyJurors.selector);
        court.fileDispute(callId, keccak256("e"), "", j);
    }

    function test_FileDispute_JurorNoSoul_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](3);
        j[0] = juror1;
        j[1] = juror2;
        j[2] = mallory; // 没 Soul

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.JurorMustHoldSoul.selector);
        court.fileDispute(callId, keccak256("e"), "", j);
    }

    function test_FileDispute_DuplicateJuror_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](3);
        j[0] = juror1;
        j[1] = juror2;
        j[2] = juror1; // 重复

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.DuplicateJuror.selector);
        court.fileDispute(callId, keccak256("e"), "", j);
    }

    function test_FileDispute_PlaintiffAsJuror_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](3);
        j[0] = juror1;
        j[1] = alice; // plaintiff
        j[2] = juror2;

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.PlaintiffCannotBeJuror.selector);
        court.fileDispute(callId, keccak256("e"), "", j);
    }

    function test_FileDispute_DefendantAsJuror_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](3);
        j[0] = juror1;
        j[1] = bob; // defendant
        j[2] = juror2;

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.DefendantCannotBeJuror.selector);
        court.fileDispute(callId, keccak256("e"), "", j);
    }

    function test_FileDispute_EmptyEvidence_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        vm.expectRevert(PneumaCourt.EmptyEvidenceHash.selector);
        court.fileDispute(callId, bytes32(0), "", _defaultJurors());
    }

    // ─────────────────────── vote ───────────────────────

    function test_Vote_HappyPath() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror1);
        court.vote(disputeId, true);

        assertTrue(court.hasVoted(disputeId, juror1));
        assertTrue(court.jurorVerdict(disputeId, juror1));
    }

    function test_Vote_NonJuror_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror4); // 不在 juror 列表
        vm.expectRevert(PneumaCourt.NotJuror.selector);
        court.vote(disputeId, true);
    }

    function test_Vote_DuplicateVote_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.startPrank(juror1);
        court.vote(disputeId, true);
        vm.expectRevert(PneumaCourt.AlreadyVoted.selector);
        court.vote(disputeId, false);
        vm.stopPrank();
    }

    function test_Vote_AfterDeadline_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        skip(25 hours);

        vm.prank(juror1);
        vm.expectRevert(PneumaCourt.VotingEnded.selector);
        court.vote(disputeId, true);
    }

    // ─────────────────────── finalize ───────────────────────

    function test_Finalize_GuiltyMajority_TriggersSlash() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        // 2 vote guilty, 1 innocent (3 中 2 多数判 guilty)
        vm.prank(juror1);
        court.vote(disputeId, true);
        vm.prank(juror2);
        court.vote(disputeId, true);
        vm.prank(juror3);
        court.vote(disputeId, false);

        skip(25 hours);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(juror1);
        court.finalize(disputeId);

        // 验证：判决 Guilty
        (,,,,,,,,, PneumaCourt.DisputeStatus status, PneumaCourt.Verdict verdict) = court.getDispute(disputeId);
        assertEq(uint256(status), uint256(PneumaCourt.DisputeStatus.Resolved));
        assertEq(uint256(verdict), uint256(PneumaCourt.Verdict.GuiltyForPlaintiff));

        // 验证：SkillRegistry slash 触发
        // Bob 的 skill stake 100 USDC，slashBps 50% → 50 USDC slash 给 alice
        assertEq(usdc.balanceOf(alice) - aliceBalBefore, 50 * 1e6, "alice should get slash from Bob");
    }

    function test_Finalize_InnocentMajority_NoSlash() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror1);
        court.vote(disputeId, false);
        vm.prank(juror2);
        court.vote(disputeId, false);
        vm.prank(juror3);
        court.vote(disputeId, true);

        skip(25 hours);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(juror1);
        court.finalize(disputeId);

        (,,,,,,,,,, PneumaCourt.Verdict verdict) = court.getDispute(disputeId);
        assertEq(uint256(verdict), uint256(PneumaCourt.Verdict.InnocentForDefendant));
        assertEq(usdc.balanceOf(alice), aliceBalBefore, "no slash on innocent");
    }

    function test_Finalize_Tie_DefaultsInnocent() public {
        // 4 jurors, 2-2 tie → multi-jurors 不可能 2-2 平局 with MIN_JURORS=3, 但 4 jurors 时可
        (, uint256 callId) = _setupSettledCall();

        address[] memory j = new address[](4);
        j[0] = juror1;
        j[1] = juror2;
        j[2] = juror3;
        j[3] = juror4;

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", j);

        // 2 guilty / 2 innocent
        vm.prank(juror1);
        court.vote(disputeId, true);
        vm.prank(juror2);
        court.vote(disputeId, true);
        vm.prank(juror3);
        court.vote(disputeId, false);
        vm.prank(juror4);
        court.vote(disputeId, false);

        skip(25 hours);

        vm.prank(juror1);
        court.finalize(disputeId);

        // 4 中 2 不达多数（需要 3）→ Innocent
        (,,,,,,,,,, PneumaCourt.Verdict verdict) = court.getDispute(disputeId);
        assertEq(uint256(verdict), uint256(PneumaCourt.Verdict.InnocentForDefendant), "tie defaults innocent");
    }

    function test_Finalize_BeforeDeadline_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror1);
        court.vote(disputeId, true);

        // 还在投票期
        vm.prank(juror1);
        vm.expectRevert(PneumaCourt.VotingStillActive.selector);
        court.finalize(disputeId);
    }

    function test_Finalize_AlreadyResolved_Reverts() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror1);
        court.vote(disputeId, false);
        vm.prank(juror2);
        court.vote(disputeId, false);

        skip(25 hours);

        vm.prank(juror1);
        court.finalize(disputeId);

        vm.expectRevert(PneumaCourt.AlreadyResolved.selector);
        vm.prank(juror2);
        court.finalize(disputeId);
    }

    function test_Finalize_AnyoneCanTriggerAfterDeadline() public {
        (, uint256 callId) = _setupSettledCall();

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror1);
        court.vote(disputeId, false);
        vm.prank(juror2);
        court.vote(disputeId, false);
        vm.prank(juror3);
        court.vote(disputeId, true);

        skip(25 hours);

        // 随便一个第三方触发兜底 finalize（mallory 没 Soul，任何 EOA）
        vm.prank(mallory);
        court.finalize(disputeId);

        (,,,,,,,,, PneumaCourt.DisputeStatus status,) = court.getDispute(disputeId);
        assertEq(uint256(status), uint256(PneumaCourt.DisputeStatus.Resolved));
    }

    // ─────────────────────── End-to-end with ReputationGraph ───────────────────────

    function test_Finalize_GuiltyAlsoSlashesEndorsers() public {
        (, uint256 callId) = _setupSettledCall();

        // 4th party endorses bob
        vm.prank(juror4);
        usdc.mint(juror4, 1000 * 1e6);
        vm.prank(juror4);
        usdc.approve(address(graph), 200 * 1e6);
        vm.prank(juror4);
        graph.endorse(bob, 200 * 1e6, "back bob");

        vm.prank(alice);
        uint256 disputeId = court.fileDispute(callId, keccak256("e"), "", _defaultJurors());

        vm.prank(juror1);
        court.vote(disputeId, true);
        vm.prank(juror2);
        court.vote(disputeId, true);
        vm.prank(juror3);
        court.vote(disputeId, true);

        skip(25 hours);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(juror1);
        court.finalize(disputeId);

        // alice gets:
        //   - skill slash (50% of 100 USDC) = 50 USDC
        //   - endorser slash via ReputationGraph (50% of 200 USDC) = 100 USDC
        //   total = 150 USDC
        assertEq(usdc.balanceOf(alice) - aliceBalBefore, 150 * 1e6, "alice gets dual slash");
    }
}
