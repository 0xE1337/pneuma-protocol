// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {SoulNFT} from "../src/SoulNFT.sol";
import {SoulAccount} from "../src/SoulAccount.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {PneumaCommons} from "../src/PneumaCommons.sol";

/// @notice PneumaCommons 端到端测试 —— 覆盖 V6.0.1 全部 invariant
contract PneumaCommonsTest is Test {
    ERC6551Registry public registry;
    SoulAccount public accountImpl;
    SoulNFT public soulNFT;
    PneumaAttestation public attestation;
    PneumaCommons public commons;

    address public admin = address(0xA11CE);
    address public alice = address(0xA11CE2);
    address public bob = address(0xB0B);
    address public charlie = address(0xC4471E);

    function setUp() public {
        registry = new ERC6551Registry();
        accountImpl = new SoulAccount();
        attestation = new PneumaAttestation(admin);

        vm.prank(admin);
        soulNFT = new SoulNFT(address(registry), address(accountImpl), address(attestation));

        commons = new PneumaCommons(address(soulNFT), admin);
    }

    // ─────────────────────── Publish ───────────────────────

    function test_Publish_RequiresSoul_RevertIfNoSoul() public {
        vm.prank(alice);
        vm.expectRevert(PneumaCommons.NotSoulHolder.selector);
        commons.publish("article", keccak256("ipfs://x"), "Hello", "Summary");
    }

    function test_Publish_SoulHolderSucceeds() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        uint256 pubId = commons.publish("article", keccak256("ipfs://x"), "Hello", "Summary");

        assertEq(pubId, 1);
        PneumaCommons.Publication memory p = commons.getPublication(pubId);
        assertEq(p.author, alice);
        assertEq(p.title, "Hello");
        assertEq(p.summary, "Summary");
        assertEq(p.contentType, "article");
        assertEq(p.citationCount, 0);
        assertFalse(p.retracted);
    }

    function test_Publish_RejectsEmptyContentType() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        vm.expectRevert(PneumaCommons.EmptyContentType.selector);
        commons.publish("", keccak256("h"), "T", "S");
    }

    function test_Publish_RejectsZeroContentHash() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        vm.prank(alice);
        vm.expectRevert(PneumaCommons.EmptyContentHash.selector);
        commons.publish("article", bytes32(0), "T", "S");
    }

    function test_Publish_RejectsTitleTooLong() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        // 81 chars (MAX = 80)
        string memory longTitle = "01234567890123456789012345678901234567890123456789012345678901234567890123456789X";
        assertEq(bytes(longTitle).length, 81);

        vm.prank(alice);
        vm.expectRevert(PneumaCommons.TitleTooLong.selector);
        commons.publish("article", keccak256("h"), longTitle, "S");
    }

    function test_Publish_RejectsSummaryTooLong() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        // construct 281 chars
        bytes memory bs = new bytes(281);
        for (uint256 i; i < 281; ++i) bs[i] = "x";
        string memory longSummary = string(bs);

        vm.prank(alice);
        vm.expectRevert(PneumaCommons.SummaryTooLong.selector);
        commons.publish("article", keccak256("h"), "T", longSummary);
    }

    function test_Publish_MultiplePubsByAuthorIndexed() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        vm.startPrank(alice);
        commons.publish("article", keccak256("a"), "P1", "");
        commons.publish("dataset", keccak256("b"), "P2", "");
        commons.publish("prompt", keccak256("c"), "P3", "");
        vm.stopPrank();

        uint256[] memory ids = commons.getPublicationsByAuthor(alice);
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
    }

    // ─────────────────────── Cite ───────────────────────

    function _setupTwoPubs() internal returns (uint256 pAlice, uint256 pBob) {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");
        vm.prank(bob);
        soulNFT.publicMint("Bob", "");

        vm.prank(alice);
        pAlice = commons.publish("article", keccak256("a-content"), "Alice's paper", "");

        vm.prank(bob);
        pBob = commons.publish("article", keccak256("b-content"), "Bob's paper", "");
    }

    function test_Cite_HappyPath_IncrementsCitationCount() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        // Bob cites Alice's paper from his own paper
        vm.prank(bob);
        uint256 citId = commons.cite(pB, pA, "useful insight");
        assertEq(citId, 1);

        PneumaCommons.Publication memory pAfterCite = commons.getPublication(pA);
        assertEq(pAfterCite.citationCount, 1, "cited pub citationCount must increment");

        PneumaCommons.Citation memory c = commons.getCitation(citId);
        assertEq(c.fromPubId, pB);
        assertEq(c.toPubId, pA);
        assertEq(c.citer, bob);
        assertEq(c.context, "useful insight");
    }

    function test_Cite_NonAuthorRejected() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        // charlie tries to cite from Bob's pub (he's not author)
        vm.prank(charlie);
        soulNFT.publicMint("Charlie", "");

        vm.prank(charlie);
        vm.expectRevert(PneumaCommons.NotAuthor.selector);
        commons.cite(pB, pA, "should fail");
    }

    function test_Cite_SelfCitationRejected() public {
        (uint256 pA, ) = _setupTwoPubs();

        vm.prank(alice);
        vm.expectRevert(PneumaCommons.SelfCitation.selector);
        commons.cite(pA, pA, "self");
    }

    function test_Cite_DuplicatePairRejected() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        vm.startPrank(bob);
        commons.cite(pB, pA, "first");
        vm.expectRevert(PneumaCommons.AlreadyCited.selector);
        commons.cite(pB, pA, "second time");
        vm.stopPrank();
    }

    function test_Cite_RetractedTargetRejected() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        vm.prank(alice);
        commons.retract(pA);

        vm.prank(bob);
        vm.expectRevert(PneumaCommons.PublicationRetracted.selector);
        commons.cite(pB, pA, "still want to cite");
    }

    function test_Cite_NonExistentPubRejected() public {
        (uint256 pA, ) = _setupTwoPubs();

        vm.prank(alice);
        vm.expectRevert(PneumaCommons.PublicationNotFound.selector);
        commons.cite(pA, 9999, "ghost");
    }

    function test_Cite_ContextTooLongRejected() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        bytes memory bs = new bytes(141);
        for (uint256 i; i < 141; ++i) bs[i] = "x";
        string memory longCtx = string(bs);

        vm.prank(bob);
        vm.expectRevert(PneumaCommons.ContextTooLong.selector);
        commons.cite(pB, pA, longCtx);
    }

    function test_Cite_BidirectionalAllowed() public {
        // A → B 引用后，B → A 也能引用（不算 self-citation）
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        vm.prank(bob);
        commons.cite(pB, pA, "B cites A");

        vm.prank(alice);
        commons.cite(pA, pB, "A cites B back");

        assertEq(commons.getPublication(pA).citationCount, 1);
        assertEq(commons.getPublication(pB).citationCount, 1);
    }

    function test_Cite_MultiplePubsCiteSameTarget() public {
        // Alice 有 1 paper, Bob 发 2 paper 都引用 Alice
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");
        vm.prank(bob);
        soulNFT.publicMint("Bob", "");

        vm.prank(alice);
        uint256 pA = commons.publish("article", keccak256("a"), "Alice", "");

        vm.startPrank(bob);
        uint256 pB1 = commons.publish("article", keccak256("b1"), "Bob1", "");
        uint256 pB2 = commons.publish("article", keccak256("b2"), "Bob2", "");
        commons.cite(pB1, pA, "ctx1");
        commons.cite(pB2, pA, "ctx2");
        vm.stopPrank();

        assertEq(commons.getPublication(pA).citationCount, 2);
        uint256[] memory citsTo = commons.getCitationsTo(pA);
        assertEq(citsTo.length, 2);
    }

    // ─────────────────────── Retract ───────────────────────

    function test_Retract_AuthorOnly() public {
        (uint256 pA, ) = _setupTwoPubs();

        vm.prank(bob);
        vm.expectRevert(PneumaCommons.NotAuthor.selector);
        commons.retract(pA);
    }

    function test_Retract_DoubleRevert() public {
        (uint256 pA, ) = _setupTwoPubs();

        vm.startPrank(alice);
        commons.retract(pA);
        vm.expectRevert(PneumaCommons.AlreadyRetracted.selector);
        commons.retract(pA);
        vm.stopPrank();
    }

    function test_Retract_PreservesHistoricalCitations() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        vm.prank(bob);
        commons.cite(pB, pA, "before retract");

        vm.prank(alice);
        commons.retract(pA);

        // 历史 citation 仍可读
        uint256[] memory cits = commons.getCitationsTo(pA);
        assertEq(cits.length, 1, "historical citation persists after retract");

        PneumaCommons.Publication memory p = commons.getPublication(pA);
        assertTrue(p.retracted);
        assertEq(p.citationCount, 1, "citationCount unchanged on retract");
    }

    // ─────────────────────── Views ───────────────────────

    function test_ListAllPublications_Pagination() public {
        vm.prank(alice);
        soulNFT.publicMint("Alice", "");

        vm.startPrank(alice);
        for (uint256 i; i < 5; ++i) {
            commons.publish("article", keccak256(abi.encodePacked("h", i)), "T", "");
        }
        vm.stopPrank();

        // first page (0..2)
        PneumaCommons.Publication[] memory page1 = commons.listAllPublications(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].pubId, 1);
        assertEq(page1[1].pubId, 2);

        // page beyond total
        PneumaCommons.Publication[] memory page3 = commons.listAllPublications(10, 2);
        assertEq(page3.length, 0);

        // total count
        assertEq(commons.publicationCount(), 5);
    }

    function test_HasCited_FlagWorks() public {
        (uint256 pA, uint256 pB) = _setupTwoPubs();

        assertFalse(commons.hasCited(pB, pA));
        vm.prank(bob);
        commons.cite(pB, pA, "ctx");
        assertTrue(commons.hasCited(pB, pA));
        // reverse direction not affected
        assertFalse(commons.hasCited(pA, pB));
    }

    function test_GetCitation_NonExistentReverts() public {
        vm.expectRevert(PneumaCommons.CitationNotFound.selector);
        commons.getCitation(9999);
    }

    function test_GetPublication_NonExistentReverts() public {
        vm.expectRevert(PneumaCommons.PublicationNotFound.selector);
        commons.getPublication(9999);
    }
}
