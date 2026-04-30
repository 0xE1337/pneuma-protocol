// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title PneumaTimelock — 给 governor 操作加 2-day 延迟
/// @notice OpenZeppelin Governor 兼容的 queue/execute/cancel timelock 包装层。
///
///         设计：
///         - 所有非紧急 governor 调用必须先 queueAction，等 MIN_DELAY 后才能 executeAction
///         - 给 GRACE_PERIOD 防止 action 永远悬挂（过期则失效）
///         - 紧急 pause 例外（emergencyPause），仅作用于实现了 `pause()` 的合约
///
///         在 Pneuma 中典型应用：
///         - 调用 SkillRegistry.setCallTimeout(...)
///         - 调用 SkillRegistry.emergencyDeactivate(skillId)（如改造为支持 pause 模式）
///         - 调用 PneumaAttestation.grantRole / revokeRole
///
///         Hackathon 阶段 guardian = deployer 单点；roadmap 接 OpenZeppelin Governor
///         + 独立 ERC20Votes 治理代币实现完整 DAO（与支付层 USDC 解耦；见 README "Roadmap"）。
contract PneumaTimelock {
    // ───────────────────────── Constants ─────────────────────────

    uint256 public constant MIN_DELAY = 2 days;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant GRACE_PERIOD = 7 days;

    // ───────────────────────── State ─────────────────────────

    /// @notice Guardian address — Safe/multisig 或单点 EOA（hackathon 默认）
    address public guardian;

    struct QueuedAction {
        address target;
        bytes data;
        uint256 eta; // earliest execution time
        bool executed;
        bool cancelled;
    }

    mapping(bytes32 => QueuedAction) public actions;

    // ───────────────────────── Events ─────────────────────────

    event ActionQueued(bytes32 indexed actionId, address target, bytes data, uint256 eta);
    event ActionExecuted(bytes32 indexed actionId);
    event ActionCancelled(bytes32 indexed actionId);

    // ───────────────────────── Errors ─────────────────────────

    error ErrNotGuardian();
    error ErrDelayTooShort(uint256 delay, uint256 minimum);
    error ErrDelayTooLong(uint256 delay, uint256 maximum);
    error ErrNotReady(bytes32 actionId, uint256 eta, uint256 currentTime);
    error ErrExpired(bytes32 actionId);
    error ErrAlreadyExecuted(bytes32 actionId);
    error ErrAlreadyCancelled(bytes32 actionId);
    error ErrExecutionFailed(bytes32 actionId);

    // ───────────────────────── Modifiers ─────────────────────────

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert ErrNotGuardian();
        _;
    }

    // ───────────────────────── Constructor ─────────────────────────

    constructor(address _guardian) {
        guardian = _guardian;
    }

    // ───────────────────────── Core ─────────────────────────

    /// @notice Queue an action with a specified delay (must be within bounds).
    function queueAction(address target, bytes calldata data, uint256 delay)
        external
        onlyGuardian
        returns (bytes32 actionId)
    {
        if (delay < MIN_DELAY) revert ErrDelayTooShort(delay, MIN_DELAY);
        if (delay > MAX_DELAY) revert ErrDelayTooLong(delay, MAX_DELAY);

        uint256 eta = block.timestamp + delay;
        actionId = keccak256(abi.encode(target, data, eta));

        actions[actionId] = QueuedAction({
            target: target,
            data: data,
            eta: eta,
            executed: false,
            cancelled: false
        });

        emit ActionQueued(actionId, target, data, eta);
    }

    /// @notice Execute a queued action after its delay has passed and before
    ///         the grace period expires.
    function executeAction(bytes32 actionId) external onlyGuardian {
        QueuedAction storage action = actions[actionId];
        if (action.executed) revert ErrAlreadyExecuted(actionId);
        if (action.cancelled) revert ErrAlreadyCancelled(actionId);
        if (block.timestamp < action.eta) revert ErrNotReady(actionId, action.eta, block.timestamp);
        if (block.timestamp > action.eta + GRACE_PERIOD) revert ErrExpired(actionId);

        action.executed = true;

        (bool success,) = action.target.call(action.data);
        if (!success) revert ErrExecutionFailed(actionId);

        emit ActionExecuted(actionId);
    }

    /// @notice Cancel a queued action that has not yet been executed.
    function cancelAction(bytes32 actionId) external onlyGuardian {
        QueuedAction storage action = actions[actionId];
        if (action.executed) revert ErrAlreadyExecuted(actionId);
        if (action.cancelled) revert ErrAlreadyCancelled(actionId);

        action.cancelled = true;
        emit ActionCancelled(actionId);
    }

    /// @notice Emergency pause bypass — no timelock for pause operations.
    ///         Only works if the target has a `pause()` function.
    function emergencyPause(address target) external onlyGuardian {
        (bool success,) = target.call(abi.encodeWithSignature("pause()"));
        if (!success) revert ErrExecutionFailed(bytes32(0));
    }
}
