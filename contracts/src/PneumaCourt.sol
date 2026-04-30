// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice SkillRegistry 暴露给 Court 的最小接口 —— Court 只能查 call 元数据 + 触发 slash
interface ISkillRegistryForCourt {
    struct CallRecordView {
        uint256 callId;
        uint256 skillId;
        address caller;
        address callerTBA;
        uint256 amountEscrowed;
        bytes32 paymentHash;
        uint8 status;
        uint256 startedAt;
        bool slashed;
        uint32 inputBytes;
        uint32 maxOutputBytes;
        uint32 actualOutputBytes;
    }

    struct SkillView {
        uint256 skillId;
        address owner;
        // ... 其余字段对 Court 不重要，省略以避免 ABI 耦合
    }

    function getCall(uint256 callId) external view returns (CallRecordView memory);
    function getSkillOwner(uint256 skillId) external view returns (address);
    function slashOnCourtRuling(uint256 callId) external;
}

/// @title PneumaCourt
/// @notice V6.1 多陪审员法庭 —— 把"协议方单方 revoke→slash"升级到"agent 社区共投决"
///
/// 设计原则（v0.1 协议层 invariant）：
///   1. plaintiff 必须是 callId 的真 caller（不能替别人发起 dispute）
///   2. defendant 必须是 skill owner（court 自己查 SkillRegistry 验证）
///   3. 至少 MIN_JURORS 个 juror，每个必须持 Soul（v0.1 简化：reputation gate 不上链，
///      实际看 Soul 持有，链下 indexer 推荐 high-rep agent 给 plaintiff 选）
///   4. 同 juror 一个 dispute 只能投一次
///   5. 多数票决（N 中 ⌈N/2⌉+1）—— ties 默认 innocent（保护 defendant）
///   6. 一旦 finalized 不可改
///   7. 同一 callId 已 dispute 后不可再 dispute（防 spam + 重复审判）
///   8. finalize 仅 plaintiff / defendant / juror 可触发（防匿名 spam）
///   9. 投票截止后任何人可触发兜底 finalize
///  10. guilty 时联动 SkillRegistry.slashOnCourtRuling → ReputationGraph 联动 slash
///
/// v0.1 vs v1.0 简化点：
///   - juror 选择：v0.1 plaintiff 手动指定（defendant 没否决权 — 简化）；v1.0 VRF sortition
///   - 投票方式：v0.1 明文；v1.0 commit-reveal
///   - 上诉：v0.1 一审终审；v1.0 一审 5 中 3 + 二审 7 中 4
///   - slash 分配：v0.1 100% 给 plaintiff；v1.0 60% plaintiff + 30% jurors + 10% treasury
///
/// 跟其他模块的联动：
///   - 依赖 SoulNFT 检查 juror 资格
///   - 依赖 SkillRegistry 查 call.caller / skill.owner
///   - guilty 判决时调 SkillRegistry.slashOnCourtRuling → 联动 ReputationGraph
contract PneumaCourt is AccessControl {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    /// @notice 投票期（24 小时）
    uint256 public constant VOTING_PERIOD = 24 hours;
    /// @notice 最少陪审员数
    uint256 public constant MIN_JURORS = 3;
    /// @notice 最多陪审员数（gas 上限保护）
    uint256 public constant MAX_JURORS = 11;
    /// @notice evidence hash + 描述长度上限
    uint256 public constant MAX_DESCRIPTION_LENGTH = 280;

    enum DisputeStatus {
        None, // 0 - 占位（未存在）
        Voting, // 1 - 正在投票
        Resolved // 2 - 已判决

    } // forge-fmt-skip

    enum Verdict {
        Pending, // 0 - 未判决
        GuiltyForPlaintiff, // 1 - 多数判 guilty，slash 联动触发
        InnocentForDefendant // 2 - 多数判 innocent，无 slash

    }

    struct Dispute {
        uint256 disputeId;
        uint256 callId;
        address plaintiff;
        address defendant;
        bytes32 evidenceHash; // IPFS hash 指向 plaintiff 的证据
        string description; // ≤ 280 char 案情简述
        address[] jurors;
        uint256 guiltyVotes;
        uint256 innocentVotes;
        uint256 votingDeadline;
        DisputeStatus status;
        Verdict verdict;
    }

    /// @notice SkillRegistry 引用（Court 通过它查 call + 触发 slash）
    ISkillRegistryForCourt public immutable skillRegistry;

    /// @notice SoulNFT —— 用于检查 juror 资格
    IERC721 public immutable soulNFT;

    uint256 private _disputeCount;

    mapping(uint256 => Dispute) private _disputes;

    /// @dev disputeId => juror => has voted（防同 juror 重复投票）
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    /// @dev disputeId => juror => verdict (true = guilty)
    mapping(uint256 => mapping(address => bool)) private _juryVerdict;

    /// @dev callId => bool（防同 callId 重复发起 dispute）
    mapping(uint256 => bool) private _disputedCallIds;

    event DisputeFiled(
        uint256 indexed disputeId,
        uint256 indexed callId,
        address indexed plaintiff,
        address defendant,
        bytes32 evidenceHash,
        address[] jurors,
        uint256 votingDeadline
    );
    event Voted(
        uint256 indexed disputeId,
        address indexed juror,
        bool guilty,
        uint256 guiltyVotes,
        uint256 innocentVotes
    );
    event DisputeResolved(uint256 indexed disputeId, Verdict verdict, uint256 callId);

    error DisputeNotFound();
    error CallAlreadyDisputed();
    error NotPlaintiff();
    error NotJuror();
    error AlreadyVoted();
    error TooFewJurors();
    error TooManyJurors();
    error JurorMustHoldSoul();
    error DuplicateJuror();
    error PlaintiffCannotBeJuror();
    error DefendantCannotBeJuror();
    error VotingNotStarted();
    error VotingEnded();
    error VotingStillActive();
    error AlreadyResolved();
    error CannotFinalize();
    error DescriptionTooLong();
    error EmptyEvidenceHash();
    error InvalidCallState();

    constructor(address skillRegistryAddr, address soulNFTAddr, address governor) {
        require(skillRegistryAddr != address(0), "PneumaCourt: zero skillRegistry");
        require(soulNFTAddr != address(0), "PneumaCourt: zero soulNFT");
        require(governor != address(0), "PneumaCourt: zero governor");
        skillRegistry = ISkillRegistryForCourt(skillRegistryAddr);
        soulNFT = IERC721(soulNFTAddr);

        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  fileDispute
    // ─────────────────────────────────────────────────────────────────────

    /// @notice plaintiff 发起 dispute
    /// @dev Invariants:
    ///   - msg.sender 必须是 callId 的 caller
    ///   - call 必须 settled (status == 1) —— 只能对已 settle 的 call 起诉
    ///   - 同一 callId 不可重复 dispute
    ///   - jurors 数量在 [MIN_JURORS, MAX_JURORS]
    ///   - 每个 juror 必须持 Soul 且不重复
    ///   - plaintiff / defendant 不能当 juror（防自审）
    ///   - evidenceHash 非零
    ///   - description ≤ MAX_DESCRIPTION_LENGTH
    function fileDispute(
        uint256 callId,
        bytes32 evidenceHash,
        string calldata description,
        address[] calldata jurors
    ) external returns (uint256 disputeId) {
        if (_disputedCallIds[callId]) revert CallAlreadyDisputed();
        if (evidenceHash == bytes32(0)) revert EmptyEvidenceHash();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        if (jurors.length < MIN_JURORS) revert TooFewJurors();
        if (jurors.length > MAX_JURORS) revert TooManyJurors();

        // 查 call —— 验证 plaintiff 是真 caller
        ISkillRegistryForCourt.CallRecordView memory c = skillRegistry.getCall(callId);
        if (c.caller != msg.sender) revert NotPlaintiff();
        // 只接受已 settled 的 call（status == 1）—— 未 settle 的走 timeout-slash
        if (c.status != 1) revert InvalidCallState();

        address defendant = skillRegistry.getSkillOwner(c.skillId);

        // 验证 jurors（持 Soul / 不重 / 不含 plaintiff/defendant）
        for (uint256 i = 0; i < jurors.length; i++) {
            address j = jurors[i];
            if (soulNFT.balanceOf(j) == 0) revert JurorMustHoldSoul();
            if (j == msg.sender) revert PlaintiffCannotBeJuror();
            if (j == defendant) revert DefendantCannotBeJuror();
            // 检查重复：跟前面所有的比对
            for (uint256 k = 0; k < i; k++) {
                if (jurors[k] == j) revert DuplicateJuror();
            }
        }

        disputeId = ++_disputeCount;
        _disputes[disputeId] = Dispute({
            disputeId: disputeId,
            callId: callId,
            plaintiff: msg.sender,
            defendant: defendant,
            evidenceHash: evidenceHash,
            description: description,
            jurors: jurors,
            guiltyVotes: 0,
            innocentVotes: 0,
            votingDeadline: block.timestamp + VOTING_PERIOD,
            status: DisputeStatus.Voting,
            verdict: Verdict.Pending
        });

        _disputedCallIds[callId] = true;

        emit DisputeFiled(
            disputeId, callId, msg.sender, defendant, evidenceHash, jurors, block.timestamp + VOTING_PERIOD
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    //  vote
    // ─────────────────────────────────────────────────────────────────────

    /// @notice juror 投票
    /// @dev Invariants:
    ///   - dispute 存在且在 Voting 状态
    ///   - 未到 voting deadline
    ///   - msg.sender 是 jurors 之一
    ///   - 同 juror 一个 dispute 只能投一次
    function vote(uint256 disputeId, bool guilty) external {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == 0) revert DisputeNotFound();
        if (d.status != DisputeStatus.Voting) revert AlreadyResolved();
        if (block.timestamp >= d.votingDeadline) revert VotingEnded();

        if (!_isJuror(d, msg.sender)) revert NotJuror();
        if (_hasVoted[disputeId][msg.sender]) revert AlreadyVoted();

        _hasVoted[disputeId][msg.sender] = true;
        _juryVerdict[disputeId][msg.sender] = guilty;

        if (guilty) {
            d.guiltyVotes += 1;
        } else {
            d.innocentVotes += 1;
        }

        emit Voted(disputeId, msg.sender, guilty, d.guiltyVotes, d.innocentVotes);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  finalize
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 任何 plaintiff / defendant / juror 可触发 finalize（投票截止后任何人可触发兜底）
    /// @dev Invariants:
    ///   - dispute 存在且在 Voting 状态
    ///   - 投票期已过
    ///   - 多数票决（guiltyVotes > jurors.length / 2 → Guilty；否则 Innocent）
    ///   - guilty 时调 SkillRegistry.slashOnCourtRuling 联动 slash + endorser 联动
    function finalize(uint256 disputeId) external {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == 0) revert DisputeNotFound();
        if (d.status != DisputeStatus.Voting) revert AlreadyResolved();
        if (block.timestamp < d.votingDeadline) revert VotingStillActive();

        // 兜底权限：投票截止后任何人都可触发；截止前不在此函数（VotingStillActive 已挡）
        // 这里不再做 onlyJurorOrParty 检查，因为兜底语义就是"截止后开放"

        // 计票：多数决（ties 默认 innocent —— 保护 defendant）
        uint256 majority = d.jurors.length / 2 + 1;
        if (d.guiltyVotes >= majority) {
            d.verdict = Verdict.GuiltyForPlaintiff;
            d.status = DisputeStatus.Resolved;

            // 联动 slash：SkillRegistry → ReputationGraph
            // try/catch 防御：若 SkillRegistry 内部 revert（e.g., already slashed via timeout/revoke）
            // 不阻塞 dispute resolved 状态变更（事后 indexer 可补救）
            try skillRegistry.slashOnCourtRuling(d.callId) {
                // success
            } catch {
                // 已被 slash / 其他原因；判决仍标 Guilty 保留链上记录
            }
        } else {
            d.verdict = Verdict.InnocentForDefendant;
            d.status = DisputeStatus.Resolved;
        }

        emit DisputeResolved(disputeId, d.verdict, d.callId);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 读 dispute 完整信息（不含 mapping —— 用 hasVoted/jurorVerdict 查具体 juror）
    function getDispute(uint256 disputeId)
        external
        view
        returns (
            uint256 callId,
            address plaintiff,
            address defendant,
            bytes32 evidenceHash,
            string memory description,
            address[] memory jurors,
            uint256 guiltyVotes,
            uint256 innocentVotes,
            uint256 votingDeadline,
            DisputeStatus status,
            Verdict verdict
        )
    {
        Dispute storage d = _disputes[disputeId];
        if (d.disputeId == 0) revert DisputeNotFound();
        return (
            d.callId,
            d.plaintiff,
            d.defendant,
            d.evidenceHash,
            d.description,
            d.jurors,
            d.guiltyVotes,
            d.innocentVotes,
            d.votingDeadline,
            d.status,
            d.verdict
        );
    }

    function hasVoted(uint256 disputeId, address juror) external view returns (bool) {
        return _hasVoted[disputeId][juror];
    }

    function jurorVerdict(uint256 disputeId, address juror) external view returns (bool guilty) {
        return _juryVerdict[disputeId][juror];
    }

    function isCallDisputed(uint256 callId) external view returns (bool) {
        return _disputedCallIds[callId];
    }

    function disputeCount() external view returns (uint256) {
        return _disputeCount;
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Internals
    // ─────────────────────────────────────────────────────────────────────

    function _isJuror(Dispute storage d, address candidate) internal view returns (bool) {
        for (uint256 i = 0; i < d.jurors.length; i++) {
            if (d.jurors[i] == candidate) return true;
        }
        return false;
    }
}
