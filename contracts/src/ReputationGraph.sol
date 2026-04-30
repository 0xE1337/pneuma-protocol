// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ReputationGraph
/// @notice Pneuma 声誉担保图 —— 老 agent 锁 USDC 给新 agent 背书 + 连带责任链上自动执行
///
/// 设计原则（V6.0.2 协议层 invariant）：
///   1. endorser / endorsee 必须持 Soul（balanceOf > 0）—— 防匿名担保
///   2. stake ≥ MIN_STAKE —— 防 0 值担保刷量
///   3. 不可自我担保（endorser != endorsee）
///   4. 同一 (endorser, endorsee) pair 最多 1 条 active 担保 —— 防累加水量
///   5. 撤保需 UNLOCK_DELAY (24h) 延迟 —— 防 endorsee 出事时秒撤
///   6. endorsee 被 slash 时，所有 active endorsers 按 slashBps 比例联动 slash → harmedParty
///   7. 已 requestUnlock 的担保仍然 active for slash purposes（直到真正 withdraw 才豁免）
///
/// 跟现有合约的关系：
///   - paymentToken 同 SkillRegistry（USDC）
///   - 通过 SoulNFT 检查持有者资格
///   - SkillRegistry.slashOnRevoke / claimTimeoutAndSlash 调 onEndorseeSlashed 触发联动
///   - V6 终极架构：所有 agent 间关系汇总到 SocialGraph，担保是 EdgeType.ENDORSEMENT
contract ReputationGraph is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    /// @notice SkillRegistry 钩子调用权 —— 只有它能触发 onEndorseeSlashed
    bytes32 public constant SLASH_HOOK_ROLE = keccak256("SLASH_HOOK_ROLE");

    /// @notice slashBps 上限（10000 = 100%）
    uint256 public constant MAX_SLASH_BPS = 10_000;

    /// @notice 撤保延迟（24h）—— 防 endorsee 出事时秒撤逃避连带责任
    uint256 public constant UNLOCK_DELAY = 24 hours;

    /// @notice context 最大长度
    uint256 public constant MAX_CONTEXT_LENGTH = 280;

    /// @notice 每个 endorsee 最多 active endorser 数（防 onEndorseeSlashed 时 gas 爆炸）
    uint256 public constant MAX_ENDORSERS_PER_ENDORSEE = 32;

    /// @notice 最低 stake（governor 可调）—— anti-spam 经济下限，默认 1 USDC = 1_000_000
    uint256 public minStake;

    struct Endorsement {
        uint256 endorsementId;
        address endorser;          // 担保人 EOA
        address endorsee;          // 被担保人 EOA
        uint256 stakedAmount;      // 锁的 USDC（active 时不可动）
        uint256 startedAt;
        uint256 unlockRequestedAt; // 0 = 未撤销请求；> 0 = 时间戳
        bool active;               // 撤保 withdraw 后置 false（slash 不改 active，只减 stakedAmount）
        string context;            // ≤ 280 char "为什么担保"
    }

    /// @notice 支付代币（同 SkillRegistry 的 USDC）
    IERC20 public immutable paymentToken;

    /// @notice SoulNFT —— 用于检查持有者资格
    IERC721 public immutable soulNFT;

    uint256 private _endorsementCount;

    mapping(uint256 => Endorsement) private _endorsements;

    /// @dev endorser => list of endorsementIds 该 endorser 发起的所有担保
    mapping(address => uint256[]) private _byEndorser;

    /// @dev endorsee => list of endorsementIds 该 endorsee 收到的所有担保
    mapping(address => uint256[]) private _byEndorsee;

    /// @dev endorser => endorsee => endorsementId（0 = 无 active）—— 防同 pair 重复担保
    mapping(address => mapping(address => uint256)) private _activeByPair;

    /// @dev endorsee => list of *active* endorsementIds（slash 时遍历用，cap MAX_ENDORSERS_PER_ENDORSEE）
    mapping(address => uint256[]) private _activeEndorsementsTo;

    /// @dev endorsementId => 在 _activeEndorsementsTo[endorsee] 数组中的 index（用于 swap-and-pop O(1) 删除）
    mapping(uint256 => uint256) private _activeIndexInList;

    /// @dev endorsee => 累计当前 active 担保金额（聚合视图，前端展示用）
    mapping(address => uint256) private _totalActiveStakeTo;

    event Endorsed(
        uint256 indexed endorsementId,
        address indexed endorser,
        address indexed endorsee,
        uint256 stakedAmount,
        string context
    );
    event UnlockRequested(uint256 indexed endorsementId, uint256 unlockAt);
    event Withdrawn(uint256 indexed endorsementId, address indexed endorser, uint256 amount);
    event EndorserSlashed(
        uint256 indexed endorsementId,
        address indexed endorser,
        address indexed endorsee,
        uint256 slashAmount,
        address harmedParty
    );
    event MinStakeUpdated(uint256 oldMin, uint256 newMin);

    error NotSoulHolder();
    error EndorsementNotFound();
    error NotEndorser();
    error CannotEndorseSelf();
    error StakeTooLow();
    error AlreadyEndorsing();
    error UnlockNotRequested();
    error UnlockStillPending();
    error NotActive();
    error TooManyEndorsers();
    error ContextTooLong();
    error InvalidSlashBps();

    constructor(address paymentTokenAddress, address soulNFTAddress, address governor) {
        require(paymentTokenAddress != address(0), "ReputationGraph: zero paymentToken");
        require(soulNFTAddress != address(0), "ReputationGraph: zero soulNFT");
        require(governor != address(0), "ReputationGraph: zero governor");
        paymentToken = IERC20(paymentTokenAddress);
        soulNFT = IERC721(soulNFTAddress);
        minStake = 1_000_000; // 1 USDC default
        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Endorse
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 给某个 agent 锁 USDC 担保
    /// @dev Invariants:
    ///   - msg.sender 必须持 Soul
    ///   - endorsee 必须持 Soul
    ///   - endorser != endorsee
    ///   - stake ≥ minStake
    ///   - 同 (endorser, endorsee) pair 没有 active 担保
    ///   - endorsee 的 active endorser 数未达 MAX_ENDORSERS_PER_ENDORSEE
    ///   - context.length ≤ MAX_CONTEXT_LENGTH
    ///   - msg.sender 必须先 approve(this, stake) 给 paymentToken
    function endorse(address endorsee, uint256 stake, string calldata context)
        external
        returns (uint256 endorsementId)
    {
        if (soulNFT.balanceOf(msg.sender) == 0) revert NotSoulHolder();
        if (soulNFT.balanceOf(endorsee) == 0) revert NotSoulHolder();
        if (msg.sender == endorsee) revert CannotEndorseSelf();
        if (stake < minStake) revert StakeTooLow();
        if (_activeByPair[msg.sender][endorsee] != 0) revert AlreadyEndorsing();
        if (_activeEndorsementsTo[endorsee].length >= MAX_ENDORSERS_PER_ENDORSEE) {
            revert TooManyEndorsers();
        }
        if (bytes(context).length > MAX_CONTEXT_LENGTH) revert ContextTooLong();

        endorsementId = ++_endorsementCount;
        _endorsements[endorsementId] = Endorsement({
            endorsementId: endorsementId,
            endorser: msg.sender,
            endorsee: endorsee,
            stakedAmount: stake,
            startedAt: block.timestamp,
            unlockRequestedAt: 0,
            active: true,
            context: context
        });

        _byEndorser[msg.sender].push(endorsementId);
        _byEndorsee[endorsee].push(endorsementId);
        _activeByPair[msg.sender][endorsee] = endorsementId;

        // 加入 active 列表 + 记 index
        uint256 idx = _activeEndorsementsTo[endorsee].length;
        _activeEndorsementsTo[endorsee].push(endorsementId);
        _activeIndexInList[endorsementId] = idx;

        _totalActiveStakeTo[endorsee] += stake;

        // 拉 USDC 到合约
        paymentToken.safeTransferFrom(msg.sender, address(this), stake);

        emit Endorsed(endorsementId, msg.sender, endorsee, stake, context);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Request Unlock + Withdraw
    // ─────────────────────────────────────────────────────────────────────

    /// @notice endorser 请求撤保（启动 24h 倒计时）
    /// @dev Invariants:
    ///   - msg.sender 是 endorser
    ///   - 担保仍 active
    ///   - 未请求过撤保
    ///
    /// 重要：requestUnlock 之后到 withdraw 之前，担保**仍受 slash 约束**（防恶意秒撤）
    function requestUnlock(uint256 endorsementId) external {
        Endorsement storage e = _endorsements[endorsementId];
        if (e.endorsementId == 0) revert EndorsementNotFound();
        if (e.endorser != msg.sender) revert NotEndorser();
        if (!e.active) revert NotActive();
        if (e.unlockRequestedAt != 0) revert UnlockStillPending();

        e.unlockRequestedAt = block.timestamp;
        emit UnlockRequested(endorsementId, block.timestamp + UNLOCK_DELAY);
    }

    /// @notice endorser 提取担保金（必须在 requestUnlock 后等满 UNLOCK_DELAY）
    /// @dev Invariants:
    ///   - msg.sender 是 endorser
    ///   - 担保仍 active（未被 slash 全额）
    ///   - 已 requestUnlock
    ///   - 已过 UNLOCK_DELAY
    function withdraw(uint256 endorsementId) external {
        Endorsement storage e = _endorsements[endorsementId];
        if (e.endorsementId == 0) revert EndorsementNotFound();
        if (e.endorser != msg.sender) revert NotEndorser();
        if (!e.active) revert NotActive();
        if (e.unlockRequestedAt == 0) revert UnlockNotRequested();
        if (block.timestamp < e.unlockRequestedAt + UNLOCK_DELAY) revert UnlockStillPending();

        uint256 amount = e.stakedAmount;
        e.active = false;
        e.stakedAmount = 0;

        // 从 active 列表移除（swap-and-pop）
        _removeFromActiveList(e.endorsee, endorsementId);

        // 清 pair 锁（允许重新担保）
        _activeByPair[e.endorser][e.endorsee] = 0;

        // 减聚合 stake
        if (amount > 0) {
            _totalActiveStakeTo[e.endorsee] -= amount;
            paymentToken.safeTransfer(e.endorser, amount);
        }

        emit Withdrawn(endorsementId, e.endorser, amount);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Slash Hook (called by SkillRegistry)
    // ─────────────────────────────────────────────────────────────────────

    /// @notice **SkillRegistry slash 联动钩子**：endorsee 被 slash 时所有 active endorsers 按 bps 联动 slash
    /// @dev 仅 SLASH_HOOK_ROLE 可调（治理授权 SkillRegistry 持此角色）
    ///      遍历所有 active endorsers，按 slashBps 减他们的 stake，slash 资金给 harmedParty
    ///      gas 上限：MAX_ENDORSERS_PER_ENDORSEE = 32（注册时已限制）
    /// @param endorsee     被 slash 的 agent
    /// @param slashBps     slash 比例（同原 skill slash bps；上限 10000）
    /// @param harmedParty  受害者（接收 slash 资金；通常 = 原 caller）
    function onEndorseeSlashed(address endorsee, uint256 slashBps, address harmedParty)
        external
        onlyRole(SLASH_HOOK_ROLE)
    {
        if (slashBps > MAX_SLASH_BPS) revert InvalidSlashBps();
        if (slashBps == 0) return; // no-op
        if (harmedParty == address(0)) return; // 无害方时不能转账，跳过

        uint256[] storage list = _activeEndorsementsTo[endorsee];
        uint256 len = list.length;

        for (uint256 i = 0; i < len; i++) {
            uint256 eid = list[i];
            Endorsement storage e = _endorsements[eid];
            if (!e.active) continue;
            if (e.stakedAmount == 0) continue;

            uint256 slashAmt = (e.stakedAmount * slashBps) / MAX_SLASH_BPS;
            if (slashAmt > e.stakedAmount) slashAmt = e.stakedAmount;
            if (slashAmt == 0) continue;

            unchecked {
                e.stakedAmount -= slashAmt;
                _totalActiveStakeTo[endorsee] -= slashAmt;
            }

            paymentToken.safeTransfer(harmedParty, slashAmt);

            emit EndorserSlashed(eid, e.endorser, endorsee, slashAmt, harmedParty);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ─────────────────────────────────────────────────────────────────────

    function _removeFromActiveList(address endorsee, uint256 endorsementId) internal {
        uint256[] storage list = _activeEndorsementsTo[endorsee];
        uint256 idx = _activeIndexInList[endorsementId];
        uint256 lastIdx = list.length - 1;

        if (idx != lastIdx) {
            uint256 lastId = list[lastIdx];
            list[idx] = lastId;
            _activeIndexInList[lastId] = idx;
        }
        list.pop();
        delete _activeIndexInList[endorsementId];
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Governance
    // ─────────────────────────────────────────────────────────────────────

    function setMinStake(uint256 newMin) external onlyRole(GOVERNOR_ROLE) {
        emit MinStakeUpdated(minStake, newMin);
        minStake = newMin;
    }

    /// @notice 治理：授予 SkillRegistry 触发 onEndorseeSlashed 的角色
    function grantSlashHook(address skillRegistry) external onlyRole(GOVERNOR_ROLE) {
        _grantRole(SLASH_HOOK_ROLE, skillRegistry);
    }

    function revokeSlashHook(address skillRegistry) external onlyRole(GOVERNOR_ROLE) {
        _revokeRole(SLASH_HOOK_ROLE, skillRegistry);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    function getEndorsement(uint256 endorsementId) external view returns (Endorsement memory) {
        if (_endorsements[endorsementId].endorsementId == 0) revert EndorsementNotFound();
        return _endorsements[endorsementId];
    }

    function getEndorsementsByEndorser(address endorser) external view returns (uint256[] memory) {
        return _byEndorser[endorser];
    }

    function getEndorsementsByEndorsee(address endorsee) external view returns (uint256[] memory) {
        return _byEndorsee[endorsee];
    }

    function getActiveEndorsementsTo(address endorsee) external view returns (uint256[] memory) {
        return _activeEndorsementsTo[endorsee];
    }

    function getActiveEndorsementId(address endorser, address endorsee) external view returns (uint256) {
        return _activeByPair[endorser][endorsee];
    }

    function totalActiveStakeTo(address endorsee) external view returns (uint256) {
        return _totalActiveStakeTo[endorsee];
    }

    function endorsementCount() external view returns (uint256) {
        return _endorsementCount;
    }
}
