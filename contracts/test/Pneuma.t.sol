// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2, Vm} from "forge-std/Test.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {SoulNFT} from "../src/SoulNFT.sol";
import {SoulAccount} from "../src/SoulAccount.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {BudgetController} from "../src/BudgetController.sol";

/// @notice Pneuma 协议端到端测试 —— 覆盖 D1 验收所需的全部关键流程
contract PneumaTest is Test {
    ERC6551Registry public registry;
    SoulAccount public accountImpl;
    SoulNFT public soulNFT;
    MockUSDC public usdc;
    PneumaAttestation public attestation;
    SkillRegistry public skillRegistry;

    address public admin = address(0xA11CE);
    address public alice = address(0xA11CE2); // 调用方
    address public bob = address(0xB0B); // 服务提供方
    address public charlie = address(0xC4471E); // 第三方 dApp 用户（用于跨平台读取测试）

    function setUp() public {
        // 1. 部署 ERC-6551 Registry（本地测试用，主网用 canonical 0x000...775758）
        registry = new ERC6551Registry();

        // 2. 部署 SoulAccount 实现合约
        accountImpl = new SoulAccount();

        // 3. 部署 MockUSDC（forge test 内的 6-decimal stablecoin mock）
        usdc = new MockUSDC();

        // 4. 部署 PneumaAttestation（提前到 SoulNFT 之前 — 配合 boundary hook 依赖）
        attestation = new PneumaAttestation(admin);

        // 5. 部署 SoulNFT（注入 attestation 启用 ownership boundary hook）
        vm.prank(admin);
        soulNFT = new SoulNFT(address(registry), address(accountImpl), address(attestation));

        // 6. 部署 SkillRegistry
        skillRegistry = new SkillRegistry(address(usdc), address(attestation), admin);

        // 7a. 反向授权：SkillRegistry 持 ATTESTER_ROLE（正常评分）
        bytes32 attesterRole = attestation.ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(attesterRole, address(skillRegistry));

        // 7b. 反向授权：SoulNFT 持 BOUNDARY_ATTESTER_ROLE（transfer 时写 SYSTEM boundary）
        bytes32 boundaryRole = attestation.BOUNDARY_ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(boundaryRole, address(soulNFT));

        // 8. 给 alice 一些 USDC（mock 无访问控制 mint）
        usdc.mint(alice, 1000 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  SoulNFT
    // ─────────────────────────────────────────────────────────────────────

    function test_PublicMintSoul_DerivesTBA() public {
        vm.prank(alice);
        (uint256 tokenId, address tba) = soulNFT.publicMint("Alice Bot", "ipfs://meta1");

        assertEq(tokenId, 1);
        assertEq(soulNFT.ownerOf(tokenId), alice);

        address expectedTBA = registry.account(
            address(accountImpl), bytes32(0), block.chainid, address(soulNFT), tokenId
        );
        assertEq(tba, expectedTBA);
        assertEq(soulNFT.tbaOf(tokenId), expectedTBA);
    }

    function test_SoulIsTransferable_TBAFollowsNewOwner() public {
        vm.prank(alice);
        (uint256 tokenId, address tba) = soulNFT.publicMint("Alice Bot", "ipfs://meta1");

        assertEq(SoulAccount(payable(tba)).owner(), alice);

        // alice 把 NFT 转给 bob
        vm.prank(alice);
        soulNFT.transferFrom(alice, bob, tokenId);

        assertEq(soulNFT.ownerOf(tokenId), bob);
        assertEq(SoulAccount(payable(tba)).owner(), bob, "TBA owner must follow NFT");
    }

    function test_RevertOnEmptyAgentName() public {
        vm.prank(alice);
        vm.expectRevert(SoulNFT.EmptyAgentName.selector);
        soulNFT.publicMint("", "ipfs://meta");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Payment Token (USDC) — EIP-2612 Permit
    // ─────────────────────────────────────────────────────────────────────

    function test_USDCPermit() public {
        uint256 privKey = 0xA11CE;
        address owner = vm.addr(privKey);
        vm.prank(admin);
        usdc.mint(owner, 100 * 1e6);

        bytes32 permitHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdc.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        owner,
                        bob,
                        50 * 1e6,
                        usdc.nonces(owner),
                        block.timestamp + 1 hours
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, permitHash);

        usdc.permit(owner, bob, 50 * 1e6, block.timestamp + 1 hours, v, r, s);
        assertEq(usdc.allowance(owner, bob), 50 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  PneumaAttestation
    // ─────────────────────────────────────────────────────────────────────

    function test_AttestRequiresAttesterRole() public {
        vm.prank(alice);
        vm.expectRevert();
        attestation.attest(address(0xBABE), 1, 0, bytes32(uint256(1)), 5, 100, "skill", "cat", "");
    }

    function test_AttestAndReadByRecipient() public {
        bytes32 role = attestation.ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(role, alice);

        address tba = address(0xBABE);
        vm.prank(alice);
        bytes32 uid =
            attestation.attest(tba, 42, 0, keccak256("payment1"), 5, 100 * 1e6, "Skill A", "finance", "");

        PneumaAttestation.Attestation[] memory all = attestation.getAttestationsByRecipient(tba);
        assertEq(all.length, 1);
        assertEq(all[0].uid, uid);
        assertEq(all[0].rating, 5);
        assertEq(all[0].skillId, 42);
    }

    function test_RevokeAttestation() public {
        bytes32 role = attestation.ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(role, alice);

        vm.prank(alice);
        bytes32 uid = attestation.attest(address(0xBABE), 1, 0, bytes32(uint256(1)), 5, 100, "skill", "cat", "");

        vm.prank(alice);
        attestation.revoke(uid);

        PneumaAttestation.Attestation memory a = attestation.getAttestation(uid);
        assertTrue(a.revoked);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  SkillRegistry
    // ─────────────────────────────────────────────────────────────────────

    function test_RegisterSkill() public {
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Summarizer", "Text summarization", "https://api.example.com/sum", "text", 5 * 1e6, 0, 1 hours, 0
        , 4096, 8192);
        assertEq(skillId, 1);

        SkillRegistry.Skill memory s = skillRegistry.getSkill(1);
        assertEq(s.owner, bob);
        assertEq(s.pricePerCall, 5 * 1e6);
        assertTrue(s.active);
    }

    function test_EscrowAndSettle_TriggersAttestation() public {
        // bob 注册 skill
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Summarizer", "Text summarization", "https://api.example.com/sum", "text", 5 * 1e6, 0, 1 hours, 0
        , 4096, 8192);

        // alice mint Soul 拿到 TBA
        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice Bot", "ipfs://meta");

        // alice approve + escrow
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 5 * 1e6);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("paymentHash1"), 1024, 0);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(skillRegistry)), 5 * 1e6);

        // bob settle
        uint256 bobBalBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        bytes32 uid = skillRegistry.settleCall(callId, 0, 5, "");

        // 检查资金到 bob
        assertEq(usdc.balanceOf(bob) - bobBalBefore, 5 * 1e6);

        // 检查 attestation 已挂在 alice 的 TBA 上
        PneumaAttestation.Attestation[] memory records = attestation.getAttestationsByRecipient(aliceTBA);
        assertEq(records.length, 1);
        assertEq(records[0].uid, uid);
        assertEq(records[0].rating, 5);
        assertEq(records[0].paidAmount, 5 * 1e6);
        assertEq(records[0].skillName, "Summarizer");
    }

    function test_RefundAfterTimeout() public {
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill("S", "d", "e", "c", 1 * 1e6, 0, 1 hours, 0, 4096, 8192);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 1 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        // 还没超时
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.CallNotTimedOut.selector);
        skillRegistry.refundCall(callId);

        // 跳过超时
        vm.warp(block.timestamp + 2 hours);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        skillRegistry.refundCall(callId);
        assertEq(usdc.balanceOf(alice) - before, 1 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  E2E：跨平台读 —— 亮点 1 的核心验证
    // ─────────────────────────────────────────────────────────────────────

    function test_E2E_CrossPlatformReadByThirdParty() public {
        // Setup: bob 注册 skill, alice mint Soul, alice 调一次
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill("Skill A", "d", "e", "finance", 5 * 1e6, 0, 1 hours, 0, 4096, 8192);

        vm.prank(alice);
        (uint256 tokenId, address aliceTBA) = soulNFT.publicMint("Alice Bot", "ipfs://meta");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("p1"), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        skillRegistry.settleCall(callId, 0, 5, "");

        // === 模拟第三方 dApp（charlie）跨平台读取 alice 的履历 ===
        // charlie 不需要任何特权 —— 只需要知道 alice 的 NFT tokenId
        vm.startPrank(charlie);
        address aliceTBARead = soulNFT.tbaOf(tokenId);
        PneumaAttestation.Attestation[] memory profile = attestation.getAttestationsByRecipient(aliceTBARead);
        vm.stopPrank();

        assertEq(profile.length, 1, "third-party dApp must see Alice's history");
        assertEq(profile[0].rating, 5);
        assertEq(profile[0].skillName, "Skill A");
        assertEq(profile[0].skillCategory, "finance");
    }

    function test_E2E_NFTTransferCarriesHistory() public {
        // alice 累积一条履历，然后把 Soul 转给 bob
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill("S", "d", "e", "c", 1 * 1e6, 0, 1 hours, 0, 4096, 8192);

        vm.prank(alice);
        (uint256 tokenId, address tba) = soulNFT.publicMint("Alice", "");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 1 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, tba, bytes32(0), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        skillRegistry.settleCall(callId, 0, 4, "");

        // alice 把 Soul 转给 charlie
        vm.prank(alice);
        soulNFT.transferFrom(alice, charlie, tokenId);

        // charlie 现在是 NFT 的新主人 —— 但履历仍然挂在 TBA 上，跟着走
        assertEq(soulNFT.ownerOf(tokenId), charlie);
        assertEq(SoulAccount(payable(tba)).owner(), charlie);

        // transfer 后链上履历应包含：1 条 settle attestation + 1 条 SYSTEM boundary
        PneumaAttestation.Attestation[] memory records = attestation.getAttestationsByRecipient(tba);
        assertEq(records.length, 2, "history (1 skill call + 1 boundary) must follow the TBA");

        // 真实评分 + boundary 区分 —— 评分 attestation 还在
        bool foundProvider;
        bool foundBoundary;
        for (uint256 i = 0; i < records.length; ++i) {
            if (records[i].raterRole == PneumaAttestation.RaterRole.PROVIDER) {
                foundProvider = true;
                assertEq(records[i].rating, 4);
            }
            if (records[i].raterRole == PneumaAttestation.RaterRole.SYSTEM) {
                foundBoundary = true;
                assertEq(records[i].rating, 0);
            }
        }
        assertTrue(foundProvider, "provider rating must remain after transfer");
        assertTrue(foundBoundary, "ownership boundary must be written on transfer");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Ownership Boundary —— 反信用洗白攻击的链上锚点
    // ─────────────────────────────────────────────────────────────────────

    function test_MintDoesNotWriteBoundary() public {
        // mint 时 from = address(0) → 不应该写 boundary，避免污染干净 Soul 的开局
        vm.prank(alice);
        (, address tba) = soulNFT.publicMint("Alice", "");

        PneumaAttestation.Attestation[] memory records = attestation.getAttestationsByRecipient(tba);
        assertEq(records.length, 0, "fresh mint must have zero attestations");
    }

    function test_TransferWritesBoundaryAttestation() public {
        vm.prank(alice);
        (uint256 tokenId, address tba) = soulNFT.publicMint("Alice", "");

        // mint 后 0 条
        assertEq(attestation.countByRecipient(tba), 0);

        // alice 转给 bob
        vm.prank(alice);
        soulNFT.transferFrom(alice, bob, tokenId);

        // 转账后必有 1 条 SYSTEM boundary
        PneumaAttestation.Attestation[] memory records = attestation.getAttestationsByRecipient(tba);
        assertEq(records.length, 1, "transfer must write exactly one boundary");

        PneumaAttestation.Attestation memory b = records[0];
        assertEq(uint8(b.raterRole), uint8(PneumaAttestation.RaterRole.SYSTEM), "raterRole=SYSTEM");
        assertEq(b.rating, 0, "boundary rating must be 0");
        assertEq(b.skillId, tokenId, "skillId encodes tokenId for reverse lookup");
        assertEq(b.skillName, "OWNERSHIP_TRANSFER");
        assertEq(b.skillCategory, "system:ownership");
        assertEq(b.attester, address(soulNFT), "boundary attester must be SoulNFT");
        assertEq(b.recipient, tba, "boundary recipient must be the TBA");
    }

    function test_TwoTransfersWriteTwoBoundaries() public {
        vm.prank(alice);
        (uint256 tokenId, address tba) = soulNFT.publicMint("Alice", "");

        // alice → bob → charlie
        vm.prank(alice);
        soulNFT.transferFrom(alice, bob, tokenId);
        vm.prank(bob);
        soulNFT.transferFrom(bob, charlie, tokenId);

        PneumaAttestation.Attestation[] memory records = attestation.getAttestationsByRecipient(tba);
        assertEq(records.length, 2, "two transfers must write two boundaries");

        // 两条都是 SYSTEM
        assertEq(uint8(records[0].raterRole), uint8(PneumaAttestation.RaterRole.SYSTEM));
        assertEq(uint8(records[1].raterRole), uint8(PneumaAttestation.RaterRole.SYSTEM));
    }

    function test_OnlySoulNFTCanWriteBoundary() public {
        // 任意账号即使持有正常 ATTESTER_ROLE，也不能写 boundary
        bytes32 normalRole = attestation.ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(normalRole, alice);

        vm.prank(alice);
        vm.expectRevert(); // AccessControl unauthorized
        attestation.attestOwnershipChange(address(0xBABE), 1, alice, bob);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Multi-rater attestation：caller 反向评分（双向声誉）
    // ─────────────────────────────────────────────────────────────────────

    /// @dev 工具：跑完一次 escrow + settle，返回 callId / aliceTBA 给 caller-rate 测试用
    function _settledCall(uint256 price, uint8 providerRating)
        internal
        returns (uint256 callId, address aliceTBA, uint256 skillId)
    {
        vm.prank(bob);
        skillId = skillRegistry.registerSkill("Skill", "d", "e", "finance", price, 0, 1 hours, 0, 4096, 8192);

        vm.prank(alice);
        (, aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        callId = skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("ph"), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        skillRegistry.settleCall(callId, 0, providerRating, "");
    }

    function test_CallerCanRateAfterSettle() public {
        (uint256 callId,, uint256 skillId) = _settledCall(5 * 1e6, 5);

        // alice 反向给 skill provider 评 4 星
        vm.prank(alice);
        bytes32 uid = skillRegistry.callerRateSkill(callId, 4, "");

        assertTrue(skillRegistry.callerHasRated(callId), "callerRated flag set");

        // attestation 写到 bob (skill owner) 的 recipient index
        PneumaAttestation.Attestation[] memory records = attestation.getAttestationsByRecipient(bob);
        assertEq(records.length, 1, "1 caller-rated attestation on provider");
        assertEq(records[0].uid, uid);
        assertEq(records[0].rating, 4, "caller's 4-star rating recorded");
        assertEq(records[0].skillId, skillId);
        assertEq(uint8(records[0].raterRole), 1, "raterRole=CALLER");
    }

    function test_CallerCannotDoubleRate() public {
        (uint256 callId,,) = _settledCall(2 * 1e6, 5);

        vm.prank(alice);
        skillRegistry.callerRateSkill(callId, 5, "");

        // 第二次评分必须 revert
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.AlreadyCallerRated.selector);
        skillRegistry.callerRateSkill(callId, 1, "");
    }

    function test_NonCallerCannotRate() public {
        (uint256 callId,,) = _settledCall(2 * 1e6, 5);

        // charlie 不是 caller，不能评分
        vm.prank(charlie);
        vm.expectRevert(SkillRegistry.NotCaller.selector);
        skillRegistry.callerRateSkill(callId, 5, "");
    }

    function test_CallerCannotRateBeforeSettle() public {
        // 设置一个 escrow 但不 settle
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill("S", "d", "e", "finance", 1 * 1e6, 0, 1 hours, 0, 4096, 8192);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 1 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        // 还没 settle，alice 评分必须 revert
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.CallNotSettled.selector);
        skillRegistry.callerRateSkill(callId, 5, "");
    }

    function test_DualRatingFlow_BothRolesPresent() public {
        // 一次完整双向评分：provider 给 caller (rating 5) + caller 给 provider (rating 3)
        (uint256 callId, address aliceTBA,) = _settledCall(5 * 1e6, 5);
        vm.prank(alice);
        skillRegistry.callerRateSkill(callId, 3, "");

        // alice TBA 上：1 条 PROVIDER attestation（rating 5）
        PneumaAttestation.Attestation[] memory aliceAtt =
            attestation.getAttestationsByRecipient(aliceTBA);
        assertEq(aliceAtt.length, 1);
        assertEq(uint8(aliceAtt[0].raterRole), 0, "provider-rated");
        assertEq(aliceAtt[0].rating, 5);

        // bob 上：1 条 CALLER attestation（rating 3）
        PneumaAttestation.Attestation[] memory bobAtt =
            attestation.getAttestationsByRecipient(bob);
        assertEq(bobAtt.length, 1);
        assertEq(uint8(bobAtt[0].raterRole), 1, "caller-rated");
        assertEq(bobAtt[0].rating, 3);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Comment 字段 —— 协议层"用户点评"原语
    //  让真实付费方留下文字反馈，其他 caller 决策时除了 score 还能读评论
    // ─────────────────────────────────────────────────────────────────────

    function test_CallerCommentPersistedOnChain() public {
        // 完整 demo：alice 调 bob 的 skill → settle → caller 写带文字的反向评分
        (uint256 callId,,) = _settledCall(5 * 1e6, 5);

        string memory comment = unicode"endpoint 偶尔 504，但结果质量不错，建议加 retry";
        vm.prank(alice);
        skillRegistry.callerRateSkill(callId, 4, comment);

        // 链上读 bob 的 attestation list，文字评论原样回来
        PneumaAttestation.Attestation[] memory bobAtt =
            attestation.getAttestationsByRecipient(bob);
        assertEq(bobAtt.length, 1, "1 caller-rated attestation on bob");
        assertEq(bobAtt[0].rating, 4);
        assertEq(uint8(bobAtt[0].raterRole), 1, "raterRole=CALLER");
        assertEq(bobAtt[0].comment, comment, "caller comment must persist verbatim");
    }

    function test_ProviderCommentInSettleCall() public {
        // provider 在 settle 时也能写 comment（场景：给 caller 备注，比如"已完成，输出在 X 字段"）
        vm.prank(bob);
        uint256 skillId =
            skillRegistry.registerSkill("S", "d", "e", "finance", 1 * 1e6, 0, 1 hours, 0, 4096, 8192);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 1 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        string memory providerNote = unicode"已完成，输出在 result.summary 字段";
        vm.prank(bob);
        skillRegistry.settleCall(callId, 0, 5, providerNote);

        PneumaAttestation.Attestation[] memory aliceAtt =
            attestation.getAttestationsByRecipient(aliceTBA);
        assertEq(aliceAtt.length, 1);
        assertEq(aliceAtt[0].comment, providerNote);
    }

    function test_CommentTooLong_Reverts() public {
        // 超过 280 字符（约一条 tweet）必须 revert，防 storage cost 滥用
        bytes32 role = attestation.ATTESTER_ROLE();
        vm.prank(admin);
        attestation.grantRole(role, alice);

        // 281 个 'a'
        bytes memory longBytes = new bytes(281);
        for (uint256 i; i < 281; ++i) longBytes[i] = 0x61; // 'a'
        string memory tooLong = string(longBytes);

        vm.prank(alice);
        vm.expectRevert(PneumaAttestation.CommentTooLong.selector);
        attestation.attest(address(0xBABE), 1, 0, bytes32(uint256(1)), 5, 100, "s", "c", tooLong);
    }

    function test_BoundaryAttestationHasEmptyComment() public {
        // SYSTEM-rater boundary attestation 永远没人工 comment（协议自动写）
        vm.prank(alice);
        (uint256 tokenId, address tba) = soulNFT.publicMint("Alice", "");
        vm.prank(alice);
        soulNFT.transferFrom(alice, bob, tokenId);

        PneumaAttestation.Attestation[] memory records =
            attestation.getAttestationsByRecipient(tba);
        assertEq(records.length, 1, "transfer wrote 1 boundary");
        assertEq(uint8(records[0].raterRole), uint8(PneumaAttestation.RaterRole.SYSTEM));
        assertEq(bytes(records[0].comment).length, 0, "boundary comment must be empty");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  ERC-8004 IdentityRegistry compliance
    // ─────────────────────────────────────────────────────────────────────

    function test_ERC8004_RegisterMintsSoul() public {
        vm.prank(alice);
        uint256 agentId = soulNFT.register();

        assertEq(agentId, 1);
        assertEq(soulNFT.ownerOf(agentId), alice);
        assertEq(soulNFT.tokenURI(agentId), "", "register() leaves URI empty");

        // ERC-8004 spec: NFT 同时派生 TBA（Pneuma extension）
        assertTrue(soulNFT.tbaOf(agentId) != address(0));
    }

    function test_ERC8004_RegisterWithURI() public {
        vm.prank(alice);
        uint256 agentId = soulNFT.register("ipfs://QmAgentCard");

        assertEq(soulNFT.tokenURI(agentId), "ipfs://QmAgentCard");
    }

    function test_ERC8004_SetAgentURIByOwner() public {
        vm.prank(alice);
        uint256 agentId = soulNFT.register("ipfs://v1");

        vm.prank(alice);
        soulNFT.setAgentURI(agentId, "ipfs://v2");

        assertEq(soulNFT.tokenURI(agentId), "ipfs://v2");
    }

    function test_ERC8004_SetAgentURI_NonOwnerReverts() public {
        vm.prank(alice);
        uint256 agentId = soulNFT.register("ipfs://v1");

        vm.prank(bob);
        vm.expectRevert(SoulNFT.NotSoulOwner.selector);
        soulNFT.setAgentURI(agentId, "ipfs://hijacked");
    }

    function test_ERC8004_DefaultAgentNameOnRegister() public {
        // register() 应自动生成 "Agent #N" 名字（保证 souls[id].agentName 非空）
        vm.prank(alice);
        uint256 agentId = soulNFT.register();
        (string memory agentName,,, address tba,) = soulNFT.souls(agentId);
        assertEq(agentName, "Agent #1");
        assertTrue(tba != address(0));
    }

    function test_ERC8004_RegisteredEventEmitted() public {
        // 用 recordLogs 找 ERC-8004 Registered 签名（topic[0]）的 emit
        vm.recordLogs();
        vm.prank(alice);
        soulNFT.register("ipfs://x");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Registered(uint256,string,address)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) {
                found = true;
                break;
            }
        }
        assertTrue(found, "ERC-8004 Registered event not emitted");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Provider Stake + Auto-Slash —— Track A
    //  押金 + 超时 keeper-slash + revoke→slash 联动
    // ─────────────────────────────────────────────────────────────────────

    /// @dev 工具：用 stake 注册一个 skill 并把 PNM mint + approve 都装好
    function _registerWithStake(
        uint256 price,
        uint256 stake,
        uint256 sla,
        uint256 slashBps
    ) internal returns (uint256 skillId) {
        // 给 bob 充足 PNM 用于 stake
        vm.prank(admin);
        usdc.mint(bob, stake + 1 * 1e6);
        vm.prank(bob);
        usdc.approve(address(skillRegistry), stake);

        vm.prank(bob);
        skillId = skillRegistry.registerSkill(
            "StakedSkill", "d", "https://e", "finance", price, stake, sla, slashBps
        , 4096, 8192);
    }

    function test_RegisterSkill_PullsStake() public {
        uint256 stake = 100 * 1e6;
        uint256 registryBalBefore = usdc.balanceOf(address(skillRegistry));

        uint256 skillId = _registerWithStake(5 * 1e6, stake, 1 hours, 2_500);

        // 合约 PNM 余额增加了 stake 数量
        assertEq(
            usdc.balanceOf(address(skillRegistry)) - registryBalBefore,
            stake,
            "registry must hold provider stake"
        );

        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.providerStake, stake);
        assertEq(s.slaTimeoutSec, 1 hours);
        assertEq(s.slashBps, 2_500);
        assertEq(s.lockedStake, 0, "no calls yet so lockedStake = 0");
    }

    function test_BackwardCompat_RegisterSkillWithZeroStake() public {
        // 零经济安全的 skill 应能正常注册（向后兼容路径）
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Free", "d", "e", "finance", 1 * 1e6, 0, 1 hours, 0
        , 4096, 8192);

        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.providerStake, 0);
        assertEq(s.slashBps, 0);
        assertTrue(s.active);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  反 Self-Dealing —— L1 同地址防御
    //  防最低门槛刷分：provider 用自己的 EOA 作为 caller 调自己的 skill
    //  注意：多钱包 sybil 攻击不在本测试范围（需上层 reputation 公式 + 链下检测）
    // ─────────────────────────────────────────────────────────────────────

    function test_RejectSelfCall_AsSkillOwner() public {
        // bob 注册 skill
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Self", "d", "e", "finance", 1 * 1e6, 0, 1 hours, 0
        , 4096, 8192);

        // bob 给自己 mint Soul 拿 TBA
        vm.prank(bob);
        (, address bobTBA) = soulNFT.publicMint("Bob Bot", "");

        // bob 给自己 mint USDC + approve（模拟攻击者攒 caller 资金）
        usdc.mint(bob, 10 * 1e6);
        vm.prank(bob);
        usdc.approve(address(skillRegistry), 10 * 1e6);

        // bob（同时是 skill owner）尝试用自己的 EOA 作为 caller 调用 → 必须 revert
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.SelfCallForbidden.selector);
        skillRegistry.escrowForCall(skillId, bobTBA, keccak256("self"), 1024, 0);
    }

    function test_NormalCallStillWorks_DifferentCallerAndOwner() public {
        // 防御不能误伤正常路径：alice 调 bob 的 skill（不同地址）应仍可通过
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Normal", "d", "e", "finance", 1 * 1e6, 0, 1 hours, 0
        , 4096, 8192);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 1 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("ok"), 1024, 0);
        vm.stopPrank();

        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertEq(c.caller, alice);
        assertEq(c.callerTBA, aliceTBA);
    }

    function test_RegisterSkill_SlashBpsTooHigh_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.SlashBpsTooHigh.selector);
        skillRegistry.registerSkill(
            "Bad", "d", "e", "finance", 1 * 1e6, 0, 1 hours, 10_001 // > 100%
        , 4096, 8192);
    }

    function test_RegisterSkill_ZeroSla_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.InvalidSlaTimeout.selector);
        skillRegistry.registerSkill("Bad", "d", "e", "finance", 1 * 1e6, 0, 0, 0, 4096, 8192);
    }

    function test_WithdrawStake_RespectsLocked() public {
        uint256 price = 5 * 1e6;
        uint256 stake = 100 * 1e6;
        uint256 skillId = _registerWithStake(price, stake, 1 hours, 2_500);

        // alice escrow 一笔，锁住 price 数量的 stake
        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        // bob 想把全部 stake 取走：必须 revert（lockedStake = price）
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.InsufficientWithdrawableStake.selector);
        skillRegistry.withdrawStake(skillId, stake);

        // 取出 (stake - price) 应成功
        uint256 withdrawable = stake - price;
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        skillRegistry.withdrawStake(skillId, withdrawable);
        assertEq(usdc.balanceOf(bob) - bobBefore, withdrawable);

        // 状态字段反映 stake 变化
        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.providerStake, price, "remaining stake = lockedStake");
        assertEq(s.lockedStake, price);
    }

    function test_WithdrawStake_NonOwner_Reverts() public {
        uint256 stake = 50 * 1e6;
        uint256 skillId = _registerWithStake(1 * 1e6, stake, 1 hours, 1_000);

        vm.prank(alice);
        vm.expectRevert(SkillRegistry.NotSkillOwner.selector);
        skillRegistry.withdrawStake(skillId, 10 * 1e6);
    }

    function test_ClaimTimeoutAndSlash_AnyoneCanCall() public {
        uint256 price = 4 * 1e6;
        uint256 stake = 100 * 1e6;
        uint256 slashBps = 2_500; // 25%
        uint256 sla = 30 minutes;
        uint256 skillId = _registerWithStake(price, stake, sla, slashBps);

        // alice escrow
        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        // 跳过 SLA
        vm.warp(block.timestamp + sla + 1);

        // charlie（第三方 keeper）触发：alice 应同时拿到 escrow 退款 + slash 量
        uint256 expectedSlash = (stake * slashBps) / 10_000; // 25 PNM
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(charlie);
        skillRegistry.claimTimeoutAndSlash(callId);

        assertEq(
            usdc.balanceOf(alice) - aliceBefore,
            price + expectedSlash,
            "alice gets refund + slash"
        );

        // 状态：call 标记为 Refunded + slashed
        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertEq(uint8(c.status), uint8(SkillRegistry.CallStatus.Refunded));
        assertTrue(c.slashed);

        // skill 的 stake 减少
        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.providerStake, stake - expectedSlash);
        assertEq(s.lockedStake, 0, "lockedStake released after slash");
    }

    function test_ClaimTimeoutAndSlash_BeforeTimeout_Reverts() public {
        uint256 price = 1 * 1e6;
        uint256 stake = 50 * 1e6;
        uint256 sla = 1 hours;
        uint256 skillId = _registerWithStake(price, stake, sla, 1_000);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        // SLA 还没到
        vm.prank(charlie);
        vm.expectRevert(SkillRegistry.SlaNotExpired.selector);
        skillRegistry.claimTimeoutAndSlash(callId);
    }

    function test_ClaimTimeoutAndSlash_ZeroStake_NoSlashAmount() public {
        // 即使 stake = 0，超时也应让 caller 拿回 escrow（防卡死）
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Free", "d", "e", "finance", 1 * 1e6, 0, 30 minutes, 5_000
        , 4096, 8192);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), 1 * 1e6);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + 31 minutes);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(charlie);
        skillRegistry.claimTimeoutAndSlash(callId);
        assertEq(
            usdc.balanceOf(alice) - aliceBefore,
            1 * 1e6,
            "alice gets escrow refund only (no stake to slash)"
        );
    }

    function test_SlashOnRevoke_OnlyAttestation() public {
        // 直接从 EOA 调用必须 revert
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.NotAttestationContract.selector);
        skillRegistry.slashOnRevoke(1);
    }

    function test_SlashOnRevoke_ViaAttestationRevoke() public {
        // 1. 配置 attestation→registry 钩子
        vm.prank(admin);
        attestation.setSkillRegistry(address(skillRegistry));

        // 2. 用 stake 注册 + 跑完一次 settle，拿到 attestation uid
        uint256 price = 5 * 1e6;
        uint256 stake = 100 * 1e6;
        uint256 slashBps = 2_500;
        uint256 skillId = _registerWithStake(price, stake, 1 hours, slashBps);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        bytes32 uid = skillRegistry.settleCall(callId, 0, 5, "");

        uint256 expectedSlash = (stake * slashBps) / 10_000;
        uint256 aliceBefore = usdc.balanceOf(alice);

        // 3. SkillRegistry 是 attester，它 revoke 自己写的 attestation 触发 slashOnRevoke
        vm.prank(address(skillRegistry));
        attestation.revoke(uid);

        // 4. alice 应收到 slash 金额（不退还 escrow，因为 settle 已发钱）
        assertEq(
            usdc.balanceOf(alice) - aliceBefore,
            expectedSlash,
            "alice receives slash on revoke"
        );

        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertTrue(c.slashed);

        // attestation 标记为 revoked
        PneumaAttestation.Attestation memory a = attestation.getAttestation(uid);
        assertTrue(a.revoked);
    }

    function test_SlashOnRevoke_DoubleSlashReverts() public {
        // 配置钩子
        vm.prank(admin);
        attestation.setSkillRegistry(address(skillRegistry));

        uint256 price = 2 * 1e6;
        uint256 stake = 50 * 1e6;
        uint256 sla = 30 minutes;
        uint256 skillId = _registerWithStake(price, stake, sla, 1_000);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        // 先走 timeout-slash 路径
        vm.warp(block.timestamp + sla + 1);
        vm.prank(charlie);
        skillRegistry.claimTimeoutAndSlash(callId);

        // 再调用 slashOnRevoke 必须 revert（防双花）
        vm.prank(address(attestation));
        vm.expectRevert(SkillRegistry.AlreadySlashed.selector);
        skillRegistry.slashOnRevoke(callId);
    }

    function test_RevokeWithoutHook_DoesNotSlash() public {
        // 不配置 skillRegistry 钩子时，revoke 应该只 mark revoked 不 slash
        // 验证默认 skillRegistry == address(0)
        assertEq(attestation.skillRegistry(), address(0));

        uint256 price = 3 * 1e6;
        uint256 stake = 50 * 1e6;
        uint256 skillId = _registerWithStake(price, stake, 1 hours, 5_000);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        vm.prank(bob);
        bytes32 uid = skillRegistry.settleCall(callId, 0, 5, "");

        uint256 aliceBefore = usdc.balanceOf(alice);

        // revoke 不会触发 slash
        vm.prank(address(skillRegistry));
        attestation.revoke(uid);

        assertEq(usdc.balanceOf(alice), aliceBefore, "no slash without hook");

        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertFalse(c.slashed);
    }

    function test_SlashAmount_CapsAtAvailableStake() public {
        // 100% slashBps 下 slash = providerStake；后续再次 slash 必须 revert
        vm.prank(admin);
        attestation.setSkillRegistry(address(skillRegistry));

        uint256 price = 1 * 1e6;
        uint256 stake = 10 * 1e6;
        uint256 sla = 30 minutes;
        uint256 skillId = _registerWithStake(price, stake, sla, 10_000); // 100%

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("A", "");
        vm.startPrank(alice);
        usdc.approve(address(skillRegistry), price);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, bytes32(0), 1024, 0);
        vm.stopPrank();

        vm.warp(block.timestamp + sla + 1);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(charlie);
        skillRegistry.claimTimeoutAndSlash(callId);

        // alice 收到 escrow + 全部 stake
        assertEq(usdc.balanceOf(alice) - aliceBefore, price + stake);

        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.providerStake, 0, "stake fully drained");
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Track A × Track B 集成测试：BudgetController 卡 escrow 入口
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 配 budget=10、price=15 → escrow 时必须 revert BudgetExceeded
    function test_Integration_BudgetController_BlocksOverspend() public {
        // 1) 部署 BudgetController + wire 到 SkillRegistry
        BudgetController bc = new BudgetController(admin);
        vm.prank(admin);
        bc.grantSpender(address(skillRegistry));
        vm.prank(admin);
        skillRegistry.setBudgetController(address(bc));

        // 2) bob 注册 skill：price = 15 PNM，stake=0 兼容路径
        vm.startPrank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Pricey Skill", "expensive", "https://api.x", "finance", 15 * 1e6, 0, 1 hours, 0
        , 4096, 8192);
        vm.stopPrank();

        // 3) alice mint Soul → tba；给 tba 设 budget = 10 PNM
        vm.prank(alice);
        (, address tba) = soulNFT.publicMint("Alice", "");

        // budget 由 TBA 自己 setDailyBudget（msg.sender = tba）
        vm.prank(tba);
        bc.setDailyBudget(10 * 1e6);

        // 4) alice 给 SkillRegistry approve PNM
        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        // 5) escrow 必须 revert（15 > 10）
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.BudgetExceeded.selector);
        skillRegistry.escrowForCall(skillId, tba, keccak256("payment-blocked"), 1024, 0);

        // 6) 验证：spent_today 应该没增加（tryRecordSpend 失败时不写）
        assertEq(bc.getSpentToday(tba), 0, "rejected escrow must not record spend");
    }

    /// @notice 配 budget=20、price=5、连调 4 次：第 5 次必须 revert
    function test_Integration_BudgetController_ExhaustsAcrossCalls() public {
        BudgetController bc = new BudgetController(admin);
        vm.prank(admin);
        bc.grantSpender(address(skillRegistry));
        vm.prank(admin);
        skillRegistry.setBudgetController(address(bc));

        vm.startPrank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Cheap Skill", "small", "https://api.y", "text", 5 * 1e6, 0, 1 hours, 0
        , 4096, 8192);
        vm.stopPrank();

        vm.prank(alice);
        (, address tba) = soulNFT.publicMint("Alice", "");
        vm.prank(tba);
        bc.setDailyBudget(20 * 1e6);

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        // 4 次 5 PNM = 20 PNM 正好打满
        for (uint256 i; i < 4; ++i) {
            vm.prank(alice);
            skillRegistry.escrowForCall(skillId, tba, keccak256(abi.encodePacked("p", i)), 1024, 0);
        }
        assertEq(bc.getSpentToday(tba), 20 * 1e6, "exhausted to budget");

        // 第 5 次必须 revert
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.BudgetExceeded.selector);
        skillRegistry.escrowForCall(skillId, tba, keccak256("over"), 1024, 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  v4 Size-Capped Pricing Tier —— 抗中转 / 抗 raw LLM 转售
    // ─────────────────────────────────────────────────────────────────────

    /// @notice pricePerCall < MIN_PRICE_PER_CALL revert（v4 禁止 0 价 / 防羊毛党）
    function test_RegisterSkill_PriceTooLow_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.PriceTooLow.selector);
        skillRegistry.registerSkill(
            "Free", "0 price not allowed", "https://api.x", "demo",
            0, 0, 1 hours, 0, 4096, 8192
        );
    }

    /// @notice pricePerCall = MIN_PRICE_PER_CALL = 0.001 USDC 成功
    function test_RegisterSkill_MinPriceSucceeds() public {
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Cheap Echo", "lowest tier", "https://api.x/echo", "demo",
            skillRegistry.MIN_PRICE_PER_CALL(), 0, 1 hours, 0, 4096, 8192
        );
        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.pricePerCall, 1_000);
        assertEq(s.maxInputBytes, 4096);
        assertEq(s.maxOutputBytes, 8192);
        assertTrue(s.active);
    }

    /// @notice maxInputBytes > ABSOLUTE_MAX_INPUT_BYTES (1 MB) revert
    function test_RegisterSkill_MaxInputBytesTooLarge_Reverts() public {
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.MaxInputBytesTooLarge.selector);
        skillRegistry.registerSkill(
            "Huge", "10 MB input", "https://api.x", "demo",
            1_000, 0, 1 hours, 0,
            10_485_760, // 10 MB > 1 MB hard cap
            8192
        );
    }

    /// @notice maxInputBytes = 0 时用 DEFAULT_MAX_INPUT_BYTES = 4 KB（让 provider 不必填 magic number）
    function test_RegisterSkill_ZeroMaxInputUsesDefault() public {
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Default", "fallback to 4 KB", "https://api.x", "demo",
            1_000, 0, 1 hours, 0, 0, 0
        );
        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.maxInputBytes, 4096, "0 input -> DEFAULT 4 KB");
        assertEq(s.maxOutputBytes, 0, "Provider may declare 0 output (no commitment)");
    }

    /// @notice escrow 时 caller 声明 inputBytes 超过 skill.maxInputBytes -> InputTooLarge revert
    function test_EscrowForCall_OversizeInput_Reverts() public {
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Tiny", "1 KB cap", "https://api.x", "demo",
            1_000, 0, 1 hours, 0, 1024, 2048
        );
        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");
        vm.prank(alice);
        usdc.approve(address(skillRegistry), 1_000);

        vm.prank(alice);
        vm.expectRevert(SkillRegistry.InputTooLarge.selector);
        skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("oversize"), 2048, 0);
    }

    /// @notice 最低价 tier (0.001 USDC) 完整端到端：mint -> approve -> escrow -> settle -> attestation
    function test_LowestPriceTier_E2E() public {
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Cheap Echo", "0.001 USDC tier", "https://api.x/echo", "demo",
            1_000, 0, 1 hours, 0, 4096, 8192
        );

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 1_000);

        vm.prank(alice);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("cheap-1"), 1024, 0);

        vm.prank(bob);
        bytes32 uid = skillRegistry.settleCall(callId, 0, 5, "");

        PneumaAttestation.Attestation[] memory atts =
            attestation.getAttestationsByRecipient(aliceTBA);
        assertEq(atts.length, 1);
        assertEq(atts[0].uid, uid);
        assertEq(atts[0].paidAmount, 1_000, "lowest tier: 0.001 USDC paid");
        assertEq(atts[0].rating, 5);
    }

    /// @notice 未配置 BudgetController 时 escrow 完全不变（向后兼容）
    function test_Integration_BudgetController_NoControllerNoEffect() public {
        // SkillRegistry.budgetController 默认 address(0) — 不调用 BudgetController
        vm.startPrank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "Unmetered", "ok", "https://api.z", "text", 7 * 1e6, 0, 1 hours, 0
        , 4096, 8192);
        vm.stopPrank();

        vm.prank(alice);
        (, address tba) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);
        vm.prank(alice);
        uint256 callId = skillRegistry.escrowForCall(skillId, tba, keccak256("free-flow"), 1024, 0);

        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertEq(uint256(c.status), uint256(SkillRegistry.CallStatus.Pending));
    }

    // ─────────────────────────────────────────────────────────────────────
    //  V5 per-byte pricing + 多退少补 + 上游披露
    // ─────────────────────────────────────────────────────────────────────

    /// @notice V5 注册 helper —— 默认参数模拟 Claude Sonnet 中转 skill
    /// @dev base 0.001 / input 0.003/KB / output 0.015/KB / max 4KB-in 8KB-out / markup 20%
    function _registerV5Skill(address provider) internal returns (uint256 skillId) {
        SkillRegistry.RegisterParams memory p = SkillRegistry.RegisterParams({
            name: "chat-medium",
            description: "Claude Sonnet 4.5 wrapped, per-byte billed",
            endpoint: "https://api.example.com/chat",
            category: "text",
            pricePerCall: 0, // V5 模式 pricePerCall=0 合法
            providerStake: 0,
            slaTimeoutSec: 1 hours,
            slashBps: 0,
            maxInputBytes: 4096,
            maxOutputBytes: 8192,
            baseFee: 1_000, // 0.001 USDC
            inputPricePerKB: 3_000, // 0.003 USDC/KB ≈ Claude Sonnet input
            outputPricePerKB: 15_000, // 0.015 USDC/KB ≈ Claude Sonnet output
            upstreamModel: "claude-sonnet-4.5",
            markupBps: 2_000 // 20% markup 自声明
        });
        vm.prank(provider);
        skillId = skillRegistry.registerSkillFull(p);
    }

    /// @notice V5 注册成功 + 字段持久化 —— per-byte 价格 + 上游模型 + markup 全部上链
    function test_V5_RegisterFull_StoresAllFields() public {
        uint256 skillId = _registerV5Skill(bob);
        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);

        assertEq(s.baseFee, 1_000, "baseFee stored");
        assertEq(s.inputPricePerKB, 3_000, "inputPricePerKB stored");
        assertEq(s.outputPricePerKB, 15_000, "outputPricePerKB stored");
        assertEq(s.upstreamModel, "claude-sonnet-4.5", "upstreamModel stored (transparency anchor)");
        assertEq(s.markupBps, 2_000, "markupBps stored");
        assertEq(s.pricePerCall, 0, "V5 allows pricePerCall=0 (per-byte primary)");
        assertEq(s.maxOutputBytes, 8192, "maxOutputBytes required");
    }

    /// @notice V5 模式 maxOutputBytes=0 必须 revert（per-byte 计费没 output 锚定）
    function test_V5_Register_ZeroMaxOutput_Reverts() public {
        SkillRegistry.RegisterParams memory p = SkillRegistry.RegisterParams({
            name: "x",
            description: "x",
            endpoint: "x",
            category: "x",
            pricePerCall: 0,
            providerStake: 0,
            slaTimeoutSec: 1 hours,
            slashBps: 0,
            maxInputBytes: 4096,
            maxOutputBytes: 0, // ← V5 模式禁止
            baseFee: 0,
            inputPricePerKB: 3_000,
            outputPricePerKB: 0,
            upstreamModel: "",
            markupBps: 0
        });
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.InvalidOutputCap.selector);
        skillRegistry.registerSkillFull(p);
    }

    /// @notice V5 模式 pricePerCall 若 > 0 也要 ≥ MIN_PRICE_PER_CALL（混合定价合法）
    function test_V5_Register_NonZeroPriceMustMeetMin() public {
        SkillRegistry.RegisterParams memory p = SkillRegistry.RegisterParams({
            name: "x",
            description: "x",
            endpoint: "x",
            category: "x",
            pricePerCall: 500, // < MIN_PRICE_PER_CALL = 1000
            providerStake: 0,
            slaTimeoutSec: 1 hours,
            slashBps: 0,
            maxInputBytes: 4096,
            maxOutputBytes: 8192,
            baseFee: 0,
            inputPricePerKB: 3_000,
            outputPricePerKB: 15_000,
            upstreamModel: "",
            markupBps: 0
        });
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.PriceTooLow.selector);
        skillRegistry.registerSkillFull(p);
    }

    /// @notice V5 escrow 自动计算 maxCost：base + inputPrice·inputKB + outputPrice·maxOutputKB
    function test_V5_Escrow_ComputesMaxCost() public {
        uint256 skillId = _registerV5Skill(bob);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        // input 1KB + maxOut 4KB → maxCost = 1000 + 3000*1 + 15000*4 = 64_000
        vm.prank(alice);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v5-1"), 1024, 4096);

        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertEq(c.amountEscrowed, 64_000, "maxCost = 1k base + 3k in + 60k out");
        assertEq(c.inputBytes, 1024, "inputBytes recorded");
        assertEq(c.maxOutputBytes, 4096, "maxOutputBytes recorded");
    }

    /// @notice V5 escrow caller 必须显式 maxOutputBytes（V5 模式 0 = revert）
    function test_V5_Escrow_ZeroMaxOutput_Reverts() public {
        uint256 skillId = _registerV5Skill(bob);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        vm.prank(alice);
        vm.expectRevert(SkillRegistry.OutputExceedsMax.selector);
        skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v5-zero"), 1024, 0);
    }

    /// @notice V5 escrow caller 声明的 maxOutput 不能超过 skill.maxOutputBytes（Provider 注册的硬上限）
    function test_V5_Escrow_OverSkillCap_Reverts() public {
        uint256 skillId = _registerV5Skill(bob);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        // skill.maxOutputBytes = 8192，caller 要 16384 → revert
        vm.prank(alice);
        vm.expectRevert(SkillRegistry.OutputExceedsMax.selector);
        skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v5-over"), 1024, 16384);
    }

    /// @notice V5 settle 多退少补：actualOutput < maxOutput → 退余额给 caller，attest 记 actualCost
    function test_V5_Settle_RefundsExcess() public {
        uint256 skillId = _registerV5Skill(bob);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 bobBalBefore = usdc.balanceOf(bob);

        // input 1KB + maxOut 4KB → escrow 64_000
        vm.prank(alice);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v5-refund"), 1024, 4096);

        // Provider settle 时只用了 2KB output → actualCost = 1000 + 3000 + 30000 = 34_000；refund = 30_000
        vm.prank(bob);
        skillRegistry.settleCall(callId, 2048, 5, "");

        uint256 aliceBalAfter = usdc.balanceOf(alice);
        uint256 bobBalAfter = usdc.balanceOf(bob);

        // alice 净支付 = 64_000 - 30_000(refund) = 34_000
        assertEq(aliceBalBefore - aliceBalAfter, 34_000, "alice net paid 34_000 (per actual output)");
        assertEq(bobBalAfter - bobBalBefore, 34_000, "bob received 34_000 (actualCost)");

        // attestation 记的是 actualCost，不是 maxCost
        PneumaAttestation.Attestation[] memory atts = attestation.getAttestationsByRecipient(aliceTBA);
        assertEq(atts.length, 1);
        assertEq(atts[0].paidAmount, 34_000, "attestation.paidAmount = actualCost (V5)");

        // CallRecord 记下 Provider 自报的 actualOutputBytes（链上指纹，便于 dispute）
        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertEq(c.actualOutputBytes, 2048, "actualOutputBytes recorded on-chain");
    }

    /// @notice V5 settle Provider 不可虚报 actualOutput > caller 声明的 maxOutput
    function test_V5_Settle_ExceedsMax_Reverts() public {
        uint256 skillId = _registerV5Skill(bob);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        vm.prank(alice);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v5-exceed"), 1024, 2048);

        // Provider 想报 4KB 但 caller 只授权 2KB → revert
        vm.prank(bob);
        vm.expectRevert(SkillRegistry.OutputExceedsMax.selector);
        skillRegistry.settleCall(callId, 4096, 5, "");
    }

    /// @notice V5 settle actualOutput=0（Provider 没产生输出）→ caller 退到只剩 base+input 部分
    function test_V5_Settle_ZeroOutput_RefundsToBase() public {
        uint256 skillId = _registerV5Skill(bob);

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        uint256 bobBalBefore = usdc.balanceOf(bob);

        // input 1KB + maxOut 4KB → escrow 64_000
        vm.prank(alice);
        uint256 callId =
            skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v5-zero-out"), 1024, 4096);

        // Provider 设 actualOutput=0 → actualCost = 1000 + 3000 = 4_000；refund = 60_000
        vm.prank(bob);
        skillRegistry.settleCall(callId, 0, 5, "");

        assertEq(aliceBalBefore - usdc.balanceOf(alice), 4_000, "alice net paid base + input only");
        assertEq(usdc.balanceOf(bob) - bobBalBefore, 4_000, "bob received base + input");
    }

    /// @notice V4 skill 在 V5-capable 合约里完全不变（向后兼容硬保证）
    function test_V5_BackwardCompat_V4SkillStillFlatPrice() public {
        // V4 形式注册（pricePerCall flat，per-byte 字段全 0）
        vm.prank(bob);
        uint256 skillId = skillRegistry.registerSkill(
            "v4-flat", "old skill", "https://x", "text", 5 * 1e6, 0, 1 hours, 0, 4096, 8192
        );

        SkillRegistry.Skill memory s = skillRegistry.getSkill(skillId);
        assertEq(s.inputPricePerKB, 0, "V4 skill: per-byte fields zero");
        assertEq(s.outputPricePerKB, 0, "V4 skill: per-byte fields zero");

        vm.prank(alice);
        (, address aliceTBA) = soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        usdc.approve(address(skillRegistry), 100 * 1e6);

        uint256 aliceBalBefore = usdc.balanceOf(alice);

        // V4 模式：caller 传 maxOutput=0（被忽略），escrow 用 pricePerCall
        vm.prank(alice);
        uint256 callId = skillRegistry.escrowForCall(skillId, aliceTBA, keccak256("v4-compat"), 1024, 0);

        SkillRegistry.CallRecord memory c = skillRegistry.getCall(callId);
        assertEq(c.amountEscrowed, 5 * 1e6, "V4 flat: escrow = pricePerCall");

        // V4 settle 全额给 Provider，actualOutputBytes 被忽略
        vm.prank(bob);
        skillRegistry.settleCall(callId, 9999, 5, ""); // actualOutputBytes 在 V4 模式被忽略

        assertEq(aliceBalBefore - usdc.balanceOf(alice), 5 * 1e6, "V4 flat: full price paid, no refund");
    }
}
