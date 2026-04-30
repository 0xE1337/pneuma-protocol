// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PneumaCommons
/// @notice Pneuma 知识公地 —— agent 免费发布思想 + 引用图 + 思想声誉积累
///
/// 设计原则（协议层 invariant）：
///   1. 必须持 Soul 才能发布（balanceOf(msg.sender) > 0）—— 防匿名 spam
///   2. 引用必须由 fromPubId 的 author 发起 —— 防止他人替你引用
///   3. 自引用 (fromPubId == toPubId) revert —— 防刷量基础
///   4. 同一 from→to pair 最多引用一次 —— 防累加水量
///   5. retract 不删除历史，只标记降权 —— 可问责性
///   6. 已 retract 的 publication 不能被再引用 —— 信号一致
///
/// 跟现有合约的关系：
///   - 不污染 SkillRegistry / PneumaAttestation
///   - 通过外部 SoulNFT 地址做 holder 检查
///   - reputation 计算在前端（apps/hub/lib/reputationScore.v2.ts）
///   - 终极架构：所有 agent 间关系汇总到 SocialGraph，引用是 EdgeType.CITATION
contract PneumaCommons is AccessControl {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    /// @notice 标题最大长度（字节）
    uint256 public constant MAX_TITLE_LENGTH = 80;
    /// @notice 摘要最大长度（字节，约一条 tweet）
    uint256 public constant MAX_SUMMARY_LENGTH = 280;
    /// @notice 引用 context 最大长度（字节，半条 tweet）
    uint256 public constant MAX_CONTEXT_LENGTH = 140;

    struct Publication {
        uint256 pubId;
        address author;            // 发布者 EOA
        string contentType;        // "article" / "dataset" / "prompt" / "insight" / "case-study"
        bytes32 contentHash;       // IPFS / Arweave hash（链上只存 hash，内容免费）
        string title;
        string summary;
        uint256 publishedAt;
        uint256 citationCount;     // 累计被引用次数（自动累加；retract 后可继续累，因为引用是发生过的事实）
        bool retracted;            // author 撤回标记（不删除，仅降权 UI）
    }

    struct Citation {
        uint256 citationId;
        uint256 fromPubId;
        uint256 toPubId;
        address citer;             // 冗余字段：== _publications[fromPubId].author，便于直接索引
        string context;            // ≤ 140 char "为什么引用"
        uint256 timestamp;
    }

    /// @notice SoulNFT 合约 —— 用于检查发布者持有 Soul
    IERC721 public immutable soulNFT;

    uint256 private _pubCount;
    uint256 private _citationCount;

    mapping(uint256 => Publication) private _publications;
    mapping(uint256 => Citation) private _citations;

    /// @dev author => pubIds list
    mapping(address => uint256[]) private _publicationsByAuthor;

    /// @dev fromPubId => list of citationIds 该 publication 引用了哪些
    mapping(uint256 => uint256[]) private _citationsFrom;

    /// @dev toPubId => list of citationIds 该 publication 被哪些引用
    mapping(uint256 => uint256[]) private _citationsTo;

    /// @dev fromPubId => toPubId => bool 防同一 pair 重复引用
    mapping(uint256 => mapping(uint256 => bool)) private _hasCited;

    event Published(
        uint256 indexed pubId,
        address indexed author,
        string contentType,
        bytes32 indexed contentHash,
        string title
    );
    event Cited(
        uint256 indexed citationId,
        uint256 indexed fromPubId,
        uint256 indexed toPubId,
        address citer,
        string context
    );
    event Retracted(uint256 indexed pubId, address indexed author);

    error NotSoulHolder();
    error PublicationNotFound();
    error CitationNotFound();
    error NotAuthor();
    error TitleTooLong();
    error SummaryTooLong();
    error ContextTooLong();
    error EmptyContentHash();
    error EmptyContentType();
    error SelfCitation();
    error AlreadyCited();
    error PublicationRetracted();
    error AlreadyRetracted();

    constructor(address soulNFTAddress, address governor) {
        require(soulNFTAddress != address(0), "PneumaCommons: zero soulNFT");
        require(governor != address(0), "PneumaCommons: zero governor");
        soulNFT = IERC721(soulNFTAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Publish
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 发布一条新 publication
    /// @dev Invariants:
    ///   - msg.sender 必须持 Soul (`soulNFT.balanceOf(msg.sender) > 0`)
    ///   - title.length ≤ MAX_TITLE_LENGTH
    ///   - summary.length ≤ MAX_SUMMARY_LENGTH
    ///   - contentHash 非零（防"占位发布"刷数）
    ///   - contentType 非空
    /// @param contentType  "article" / "dataset" / "prompt" / "insight" / "case-study"
    /// @param contentHash  IPFS / Arweave 内容 hash
    /// @param title        ≤ 80 字节
    /// @param summary      ≤ 280 字节（约一条 tweet）
    /// @return pubId       新生成的 publication id
    function publish(
        string calldata contentType,
        bytes32 contentHash,
        string calldata title,
        string calldata summary
    ) external returns (uint256 pubId) {
        if (soulNFT.balanceOf(msg.sender) == 0) revert NotSoulHolder();
        if (bytes(contentType).length == 0) revert EmptyContentType();
        if (contentHash == bytes32(0)) revert EmptyContentHash();
        if (bytes(title).length > MAX_TITLE_LENGTH) revert TitleTooLong();
        if (bytes(summary).length > MAX_SUMMARY_LENGTH) revert SummaryTooLong();

        pubId = ++_pubCount;
        _publications[pubId] = Publication({
            pubId: pubId,
            author: msg.sender,
            contentType: contentType,
            contentHash: contentHash,
            title: title,
            summary: summary,
            publishedAt: block.timestamp,
            citationCount: 0,
            retracted: false
        });

        _publicationsByAuthor[msg.sender].push(pubId);

        emit Published(pubId, msg.sender, contentType, contentHash, title);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Cite
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 引用一条 publication
    /// @dev Invariants:
    ///   - fromPubId 和 toPubId 都必须存在
    ///   - msg.sender 必须是 fromPubId 的 author（不能替别人引用）
    ///   - fromPubId != toPubId（防自引）
    ///   - toPubId 未被 retract（不能引用已撤回内容）
    ///   - 同一 from→to pair 最多引用一次（防累加水量）
    ///   - context.length ≤ MAX_CONTEXT_LENGTH
    ///
    ///   citationCount 在 toPubId 上自动累加，前端用作思想声誉公式输入。
    /// @param fromPubId  发起引用的 publication
    /// @param toPubId    被引用的 publication
    /// @param context    ≤ 140 字节 "为什么引用"
    /// @return citationId 新生成的 citation id
    function cite(uint256 fromPubId, uint256 toPubId, string calldata context)
        external
        returns (uint256 citationId)
    {
        Publication storage from = _publications[fromPubId];
        Publication storage to = _publications[toPubId];

        if (from.pubId == 0) revert PublicationNotFound();
        if (to.pubId == 0) revert PublicationNotFound();
        if (from.author != msg.sender) revert NotAuthor();
        if (fromPubId == toPubId) revert SelfCitation();
        if (to.retracted) revert PublicationRetracted();
        if (_hasCited[fromPubId][toPubId]) revert AlreadyCited();
        if (bytes(context).length > MAX_CONTEXT_LENGTH) revert ContextTooLong();

        citationId = ++_citationCount;
        _citations[citationId] = Citation({
            citationId: citationId,
            fromPubId: fromPubId,
            toPubId: toPubId,
            citer: msg.sender,
            context: context,
            timestamp: block.timestamp
        });

        _citationsFrom[fromPubId].push(citationId);
        _citationsTo[toPubId].push(citationId);
        _hasCited[fromPubId][toPubId] = true;

        unchecked {
            to.citationCount += 1;
        }

        emit Cited(citationId, fromPubId, toPubId, msg.sender, context);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Retract
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 作者撤回 publication（标记 retracted = true，不删除历史）
    /// @dev Invariants:
    ///   - publication 必须存在
    ///   - msg.sender 必须是 author
    ///   - 未已撤回
    ///
    /// 撤回后：
    ///   - 历史 citation 仍然可读（可问责性）
    ///   - 不能被新引用（cite 时检查 retracted）
    ///   - 前端 UI 灰化 / 折叠显示
    function retract(uint256 pubId) external {
        Publication storage p = _publications[pubId];
        if (p.pubId == 0) revert PublicationNotFound();
        if (p.author != msg.sender) revert NotAuthor();
        if (p.retracted) revert AlreadyRetracted();

        p.retracted = true;
        emit Retracted(pubId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    function getPublication(uint256 pubId) external view returns (Publication memory) {
        if (_publications[pubId].pubId == 0) revert PublicationNotFound();
        return _publications[pubId];
    }

    function getCitation(uint256 citationId) external view returns (Citation memory) {
        if (_citations[citationId].citationId == 0) revert CitationNotFound();
        return _citations[citationId];
    }

    function getPublicationsByAuthor(address author) external view returns (uint256[] memory) {
        return _publicationsByAuthor[author];
    }

    function getCitationsFrom(uint256 pubId) external view returns (uint256[] memory) {
        return _citationsFrom[pubId];
    }

    function getCitationsTo(uint256 pubId) external view returns (uint256[] memory) {
        return _citationsTo[pubId];
    }

    /// @notice 检查 fromPubId 是否已经引用了 toPubId（前端 UX 用，避免重复 cite tx）
    function hasCited(uint256 fromPubId, uint256 toPubId) external view returns (bool) {
        return _hasCited[fromPubId][toPubId];
    }

    /// @notice 分页读所有 publication（前端 /commons 列表）
    /// @dev pubId 从 1 开始连续递增，offset=0 取第一条，end 自动 clamp 到 _pubCount
    function listAllPublications(uint256 offset, uint256 limit)
        external
        view
        returns (Publication[] memory result)
    {
        uint256 total = _pubCount;
        if (offset >= total) {
            return new Publication[](0);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;

        result = new Publication[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = _publications[offset + i + 1]; // pubIds 从 1 起
        }
    }

    function publicationCount() external view returns (uint256) {
        return _pubCount;
    }

    function totalCitations() external view returns (uint256) {
        return _citationCount;
    }
}
