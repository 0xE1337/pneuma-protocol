// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice SkillRegistry slash hook —— 仅暴露本合约需要的 slash 入口，避免完整 import 增加耦合
interface ISkillRegistrySlash {
    function slashOnRevoke(uint256 callId) external;
}

/// @title PneumaAttestation
/// @notice Pneuma 协议自建的链上 attestation 注册器（不依赖 EAS，因为 Arc Testnet 无 EAS 部署）。
///
///         **亮点 1（贡献档案跨平台读）的核心存储**：
///         - schema 写在合约 constant 里，公开可读，链下 dApp 可校验
///         - attestation 锚定 x402 paymentHash，反伪造抓手在链上
///         - getAttestationsByRecipient(tba) 是跨平台 dApp 读履历的主入口，零集成成本
///
///         设计理念：让 PneumaAttestation 成为 "x402 支付凭证锚定的 attestation primitive"。
contract PneumaAttestation is AccessControl {
    /// @notice attester 角色 —— 只有 SkillRegistry 应该持有，settle 时由它写入
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    /// @notice boundary attester 角色 —— 只有 SoulNFT 应该持有，transfer 时由它写入
    /// @dev 权限隔离：boundary attestation 只能写 rating=0 / raterRole=SYSTEM 的特殊条目，
    ///      不能伪造正常 PROVIDER / CALLER 评分 → 反信用洗白攻击的链上锚点
    bytes32 public constant BOUNDARY_ATTESTER_ROLE = keccak256("BOUNDARY_ATTESTER_ROLE");

    /// @notice 公开的 schema 字符串 —— dApp 可链上读拿来校验
    string public constant SCHEMA =
        "uint256 skillId, uint256 callId, bytes32 paymentHash, uint8 rating, uint256 paidAmount, string skillName, string skillCategory, uint256 timestamp, uint8 raterRole, string comment";

    /// @notice comment 字段链上长度上限（防止滥用 storage cost）
    /// @dev 280 字符 = 一条 tweet，足够表达"这个 service 漏掉了 X 字段，建议补上 Y" 类反馈
    uint256 public constant MAX_COMMENT_LENGTH = 280;

    /// @notice boundary 类型 attestation 的规范常量（前端按 skillCategory == BOUNDARY_CATEGORY 切分历史）
    string public constant BOUNDARY_CATEGORY = "system:ownership";
    string public constant BOUNDARY_SKILL_NAME = "OWNERSHIP_TRANSFER";

    /// @notice 评分来源角色（multi-rater attestation 的核心）
    ///         区分"谁给谁打分"：
    ///         - PROVIDER：skill owner 在 settle 时给 caller 打分（默认路径）
    ///         - CALLER：caller 反向给 skill provider 打分（双向声誉闭环）
    ///         - JUROR：争议陪审打分（roadmap，配合 commit-reveal 投票）
    ///         - SYSTEM：协议自身写入的元数据 attestation（如 ownership boundary）
    ///                   rating 字段无意义（恒为 0），前端用于切分历史段
    ///         前端聚合 reputation 时按 raterRole 加权（CALLER 评分通常权重更高，
    ///         因为 caller 是真正掏钱的一方，立场客观；PROVIDER 评分需要防自刷）
    enum RaterRole {
        PROVIDER,
        CALLER,
        JUROR,
        SYSTEM
    }

    /// @notice 单条 attestation 的全部字段
    struct Attestation {
        bytes32 uid;
        address recipient; // = SoulAccount address (TBA) 或 skill provider EOA
        address attester; // = SkillRegistry contract
        uint256 skillId;
        uint256 callId; // SkillRegistry call id（boundary / 旧版直接 attest 时为 0）—— revoke→slash 反查 key
        bytes32 paymentHash; // x402 EIP-712 payment hash, 反伪造锚点
        uint8 rating; // 1-5
        uint256 paidAmount; // 支付代币最小单位（USDC = 1e6）
        string skillName;
        string skillCategory;
        uint256 timestamp;
        bool revoked;
        RaterRole raterRole; // 评分来源（multi-rater attestation 区分字段）
        string comment; // 自由文本评论（最长 MAX_COMMENT_LENGTH）；boundary/无评论场景为空字符串
    }

    /// @dev uid => Attestation
    mapping(bytes32 => Attestation) public attestations;

    /// @dev recipient (TBA) => uids[]，跨平台读履历主入口
    mapping(address => bytes32[]) private _byRecipient;

    /// @dev attester => uids[]，用于追踪某个 attester 的全部记录
    mapping(address => bytes32[]) private _byAttester;

    /// @dev 自增 nonce（用于生成 uid）
    uint256 private _nonce;

    /// @notice SkillRegistry 地址 —— revoke 时回调 slashOnRevoke 触发自动罚没
    /// @dev 可以为 address(0)（hackathon 早期 / 测试场景），此时 revoke 仅打 revoked=true 不 slash
    address public skillRegistry;

    event Attested(
        bytes32 indexed uid,
        address indexed recipient,
        address indexed attester,
        uint256 skillId,
        bytes32 paymentHash
    );
    event Revoked(bytes32 indexed uid, address indexed attester);

    /// @notice SkillRegistry 钩子地址变更 —— 治理事件，方便链下追踪
    event SkillRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    /// @notice revoke→slash 钩子失败时打日志 —— 不阻塞 revoke 主流程
    /// @param uid 被 revoke 的 attestation uid
    /// @param callId 关联的 callId（0 表示无关联 call）
    event SlashOnRevokeFailed(bytes32 indexed uid, uint256 indexed callId);

    /// @notice Soul 转主时由 SoulNFT 写入的边界事件
    /// @param uid attestation uid
    /// @param tba 受影响的 TBA 地址（attestation recipient）
    /// @param tokenId Soul tokenId（编码进 attestation.skillId 字段，方便前端反查）
    /// @param from 转出地址（mint 时为 address(0)，但 mint 不写 boundary）
    /// @param to 转入地址（新主人）
    event OwnershipBoundary(
        bytes32 indexed uid,
        address indexed tba,
        uint256 indexed tokenId,
        address from,
        address to
    );

    error InvalidRating();
    error InvalidRecipient();
    error AttestationNotFound();
    error NotAttester();
    error AlreadyRevoked();
    /// @dev comment 字段超过 MAX_COMMENT_LENGTH（防止 storage 滥用）
    error CommentTooLong();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice 由 SkillRegistry 在 settle 时调用，PROVIDER 给 CALLER 打分
    /// @dev 兼容签名（不带 raterRole），内部默认填 RaterRole.PROVIDER
    /// @param recipientTBA SoulAccount 地址（履历挂在 TBA 上 → 跟随 NFT 流转）
    /// @param skillId 调用的 skill id
    /// @param callId  SkillRegistry 的 call id（revoke 钩子反查 key；0 表示无关联）
    /// @param paymentHash x402 EIP-712 payment hash（反伪造锚点）
    /// @param rating 1-5 评分
    /// @param paidAmount 实际支付金额（最小单位 — USDC 为 1e6）
    /// @param skillName 跨平台 dApp 直接展示
    /// @param skillCategory 用于分类筛选
    /// @return uid 生成的 attestation uid
    function attest(
        address recipientTBA,
        uint256 skillId,
        uint256 callId,
        bytes32 paymentHash,
        uint8 rating,
        uint256 paidAmount,
        string calldata skillName,
        string calldata skillCategory,
        string calldata comment
    ) external onlyRole(ATTESTER_ROLE) returns (bytes32 uid) {
        return _attest(
            recipientTBA,
            skillId,
            callId,
            paymentHash,
            rating,
            paidAmount,
            skillName,
            skillCategory,
            comment,
            RaterRole.PROVIDER
        );
    }

    /// @notice 由 SkillRegistry 在 callerRateSkill 时调用，CALLER 给 PROVIDER 反向打分
    /// @dev recipient 通常是 skill provider 的地址（EOA 或他们的 TBA，视前端注册决定）
    ///      跟随 NFT 流转的逻辑由 provider 自己挂 SOUL 决定，本函数不强制 TBA
    /// @param comment caller 写的文字评论（可空字符串，最长 MAX_COMMENT_LENGTH）
    ///                这是协议层的"用户点评"原语 — 让真实使用过的 AI / 真用户留下文字反馈，
    ///                后续 caller 用 score 之外可读 comment 自己判断
    function attestFromCaller(
        address recipient,
        uint256 skillId,
        uint256 callId,
        bytes32 paymentHash,
        uint8 rating,
        uint256 paidAmount,
        string calldata skillName,
        string calldata skillCategory,
        string calldata comment
    ) external onlyRole(ATTESTER_ROLE) returns (bytes32 uid) {
        return _attest(
            recipient,
            skillId,
            callId,
            paymentHash,
            rating,
            paidAmount,
            skillName,
            skillCategory,
            comment,
            RaterRole.CALLER
        );
    }

    /// @notice 内部统一入口，所有 attestation 写入路径汇聚到这里
    function _attest(
        address recipient,
        uint256 skillId,
        uint256 callId,
        bytes32 paymentHash,
        uint8 rating,
        uint256 paidAmount,
        string calldata skillName,
        string calldata skillCategory,
        string calldata comment,
        RaterRole role
    ) internal returns (bytes32 uid) {
        if (recipient == address(0)) revert InvalidRecipient();
        if (rating < 1 || rating > 5) revert InvalidRating();
        if (bytes(comment).length > MAX_COMMENT_LENGTH) revert CommentTooLong();

        unchecked {
            ++_nonce;
        }
        uid = keccak256(
            abi.encodePacked(
                block.chainid, address(this), recipient, skillId, paymentHash, _nonce, block.timestamp, uint8(role)
            )
        );

        attestations[uid] = Attestation({
            uid: uid,
            recipient: recipient,
            attester: msg.sender,
            skillId: skillId,
            callId: callId,
            paymentHash: paymentHash,
            rating: rating,
            paidAmount: paidAmount,
            skillName: skillName,
            skillCategory: skillCategory,
            timestamp: block.timestamp,
            revoked: false,
            raterRole: role,
            comment: comment
        });

        _byRecipient[recipient].push(uid);
        _byAttester[msg.sender].push(uid);

        emit Attested(uid, recipient, msg.sender, skillId, paymentHash);
    }

    /// @notice Soul ownership 转移时由 SoulNFT 调用，写入一条 SYSTEM-rater 边界 attestation
    /// @dev   - 反信用洗白攻击的链上锚点：买家 / 第三方 dApp 可识别"换主人前 vs 换主人后"
    ///        - 权限隔离：只有持 BOUNDARY_ATTESTER_ROLE 的合约（SoulNFT）能调
    ///        - rating 恒为 0，raterRole 恒为 SYSTEM → 不能伪造正常评分
    ///        - 失败必须不阻塞 NFT 转账（SoulNFT 端用 try/catch 包裹本调用）
    /// @param tba 受影响的 TBA 地址（attestation 的 recipient，与正常评分共用同一索引）
    /// @param tokenId Soul tokenId（写入 skillId 字段方便反查）
    /// @param from 转出地址
    /// @param to 转入地址
    /// @return uid 写入的 attestation uid
    function attestOwnershipChange(address tba, uint256 tokenId, address from, address to)
        external
        onlyRole(BOUNDARY_ATTESTER_ROLE)
        returns (bytes32 uid)
    {
        if (tba == address(0)) revert InvalidRecipient();

        // paymentHash 字段编码 from / to / blocknumber，让 from-to 链路可链上反查
        bytes32 boundaryHash = keccak256(abi.encode(from, to, block.number));

        unchecked {
            ++_nonce;
        }
        uid = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                tba,
                tokenId,
                boundaryHash,
                _nonce,
                block.timestamp,
                uint8(RaterRole.SYSTEM)
            )
        );

        attestations[uid] = Attestation({
            uid: uid,
            recipient: tba,
            attester: msg.sender,
            skillId: tokenId, // 复用 skillId 槽存 tokenId，节省 storage
            callId: 0, // boundary 没有关联 call
            paymentHash: boundaryHash,
            rating: 0, // SYSTEM attestation rating 无意义
            paidAmount: 0,
            skillName: BOUNDARY_SKILL_NAME,
            skillCategory: BOUNDARY_CATEGORY,
            timestamp: block.timestamp,
            revoked: false,
            raterRole: RaterRole.SYSTEM,
            comment: "" // boundary 是协议自动写的元数据，无人工评论
        });

        _byRecipient[tba].push(uid);
        _byAttester[msg.sender].push(uid);

        emit Attested(uid, tba, msg.sender, tokenId, boundaryHash);
        emit OwnershipBoundary(uid, tba, tokenId, from, to);
    }

    /// @notice 撤销 attestation —— 仅原 attester 可撤
    /// @dev 罚没 / 争议场景使用；前端读取时应该过滤 revoked == true 的记录
    ///      revoke→slash 联动：若已配置 skillRegistry 且本 attestation 关联了 callId，
    ///      触发 SkillRegistry.slashOnRevoke。失败不阻塞 revoke（仅打日志），保证主流程鲁棒。
    function revoke(bytes32 uid) external {
        Attestation storage a = attestations[uid];
        if (a.uid == bytes32(0)) revert AttestationNotFound();
        if (a.attester != msg.sender) revert NotAttester();
        if (a.revoked) revert AlreadyRevoked();
        a.revoked = true;
        emit Revoked(uid, msg.sender);

        // revoke→slash 联动：仅当配置了 skillRegistry 且 attestation 关联到具体 call 才触发
        uint256 callIdLookup = a.callId;
        address registry = skillRegistry;
        if (registry != address(0) && callIdLookup != 0) {
            try ISkillRegistrySlash(registry).slashOnRevoke(callIdLookup) {
                // ok
            } catch {
                emit SlashOnRevokeFailed(uid, callIdLookup);
            }
        }
    }

    /// @notice 治理：配置 SkillRegistry 钩子地址（revoke→slash 联动入口）
    /// @dev 需要 DEFAULT_ADMIN_ROLE（部署期为 deployer，后续可移交 timelock）
    /// @param newRegistry 新 SkillRegistry 地址（传 address(0) 关闭联动）
    function setSkillRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = skillRegistry;
        skillRegistry = newRegistry;
        emit SkillRegistryUpdated(old, newRegistry);
    }

    /// @notice 跨平台读履历主入口 —— 任何 dApp 调用此函数获取某个 Soul 的全部 attestation
    /// @param recipientTBA SoulAccount 地址
    /// @return result 全部 attestation 列表（包含 revoked 的，由前端决定是否过滤）
    function getAttestationsByRecipient(address recipientTBA)
        external
        view
        returns (Attestation[] memory result)
    {
        bytes32[] storage uids = _byRecipient[recipientTBA];
        result = new Attestation[](uids.length);
        for (uint256 i; i < uids.length; ++i) {
            result[i] = attestations[uids[i]];
        }
    }

    /// @notice 单条查询
    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        if (attestations[uid].uid == bytes32(0)) revert AttestationNotFound();
        return attestations[uid];
    }

    /// @notice 某个 recipient 的 attestation 总数
    function countByRecipient(address recipientTBA) external view returns (uint256) {
        return _byRecipient[recipientTBA].length;
    }

    /// @notice 某个 attester 的 attestation 总数（用于审计 SkillRegistry 总输出）
    function countByAttester(address attester) external view returns (uint256) {
        return _byAttester[attester].length;
    }
}
