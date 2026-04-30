// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title BudgetController
/// @notice 每个 Soul（通过其 TBA 地址识别）可选配置每日支付代币（USDC）花费上限。
///         SkillRegistry 在 escrow 前调用 `tryRecordSpend` 做"原子检查 + 记账"。
///         未配置预算的 TBA 默认无限额（向后兼容现存 TBA）。
///
///         **设计取舍**：
///         - **opt-in**：`dailyBudget[tba] == 0` 视为"未设置 = 无限额"。这避免破坏现有 TBA 的调用流。
///         - **原子化**：`tryRecordSpend` 同时检查并记账，避免 SkillRegistry 端的 TOCTOU 漏洞。
///         - **零预算 = 无限额（不写入 _spent）**：节省 gas，且与未设置语义保持一致；
///           需要"硬限额 0"的场景未来可加 `lock(tba)` 单独管理。
///         - **UTC day**：`block.timestamp / 1 days` 取整。简单、跨链一致。
///           未来若要按业主时区对齐，可加 `setTimezoneOffset(tba, secondsOffset)`。
///         - **TBA 自管**：v1 简化为只允许 TBA 自己（通过 SoulAccount.execute）调 `setDailyBudget`，
///           因此只有 NFT owner 才能间接改预算（ERC-6551 钱包语义自动覆盖）。
contract BudgetController is AccessControl {
    /// @notice 被 SkillRegistry（或其他扣费合约）持有的角色
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    /// @notice 治理者，可授予 SPENDER_ROLE
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    /// @notice 每个 TBA 的每日预算（USDC 6 decimals）。0 表示未设置 = 无限额。
    mapping(address tba => uint256 dailyBudgetUsdc) public dailyBudget;

    /// @dev tba => day(UTC) => 已花费金额
    mapping(address tba => mapping(uint256 day => uint256 spent)) private _spent;

    event BudgetSet(address indexed tba, uint256 newBudgetPnm);
    event BudgetCleared(address indexed tba);
    event SpendRecorded(address indexed tba, uint256 indexed day, uint256 amount, uint256 spentTodayAfter);
    event SpenderGranted(address indexed spender);

    error ZeroAddress();

    /// @param governor 默认治理者地址（拥有 DEFAULT_ADMIN_ROLE 与 GOVERNOR_ROLE）
    constructor(address governor) {
        if (governor == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  TBA 自管预算
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 设置 / 更新调用方（msg.sender）的每日预算。
    /// @dev v1：caller 即 TBA。SoulAccount 通过 `execute` 调本函数即可代表其 owner 设置。
    ///      传 `0` 表示清除预算（回到无限额状态），并 emit `BudgetCleared`。
    /// @param newBudgetUsdc 新的每日预算（USDC 6 decimals）。0 = 清除。
    function setDailyBudget(uint256 newBudgetUsdc) external {
        uint256 prev = dailyBudget[msg.sender];
        dailyBudget[msg.sender] = newBudgetUsdc;

        if (newBudgetUsdc == 0) {
            // 之前有预算才发 cleared，避免重复噪音
            if (prev != 0) emit BudgetCleared(msg.sender);
        } else {
            emit BudgetSet(msg.sender, newBudgetUsdc);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  SkillRegistry 调用入口
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 原子化"检查 + 记账"。SkillRegistry 在 escrow 前调用此函数。
    /// @dev 设计要点：
    ///      - 若 `dailyBudget[tba] == 0`（未设置 = 无限额），直接返回 `true` 且不写 `_spent`，节省 gas。
    ///      - 若 `spentToday + amount > budget`，返回 `false` 且**不**写入（拒绝同时不消耗状态）。
    ///      - 否则：累加 `_spent[tba][today]` 并返回 `true`。
    ///      - 限制 `SPENDER_ROLE` 防止任意合约清空他人额度。
    /// @param tba 调用方 TBA 地址（attestation recipient）
    /// @param amount 本次 escrow 金额（USDC 6 decimals）
    /// @return ok true = 通过且已记账；false = 超限，调用方应 revert / 选择其他路径。
    function tryRecordSpend(address tba, uint256 amount)
        external
        onlyRole(SPENDER_ROLE)
        returns (bool ok)
    {
        uint256 budget = dailyBudget[tba];
        if (budget == 0) {
            // 无限额：不记账（与 setDailyBudget(0) 的清除语义一致）
            return true;
        }

        uint256 day = _today();
        uint256 spent = _spent[tba][day];
        unchecked {
            // 防御性检查：amount 来自上层（USDC 价格），实际不会触发；保持显式判断
            if (spent + amount > budget) return false;
        }

        _spent[tba][day] = spent + amount;
        emit SpendRecorded(tba, day, amount, spent + amount);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 今天 TBA 已经花了多少（UTC day）
    function getSpentToday(address tba) external view returns (uint256) {
        return _spent[tba][_today()];
    }

    /// @notice 今日剩余额度。未设置预算 → `type(uint256).max`（语义上无限额）。
    function getBudgetRemaining(address tba) external view returns (uint256) {
        uint256 budget = dailyBudget[tba];
        if (budget == 0) return type(uint256).max;

        uint256 spent = _spent[tba][_today()];
        if (spent >= budget) return 0;
        return budget - spent;
    }

    /// @notice 一次性返回 UI 所需的全量状态。`budgetSet=false` 时 `dailyBudget` 与 `spentToday` 仍按字段语义返回。
    function getStatus(address tba)
        external
        view
        returns (uint256 dailyBudget_, uint256 spentToday, uint256 remaining, bool budgetSet)
    {
        dailyBudget_ = dailyBudget[tba];
        spentToday = _spent[tba][_today()];
        budgetSet = dailyBudget_ != 0;
        if (!budgetSet) {
            remaining = type(uint256).max;
        } else if (spentToday >= dailyBudget_) {
            remaining = 0;
        } else {
            remaining = dailyBudget_ - spentToday;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Governance
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Governor 把 SPENDER_ROLE 授予 SkillRegistry（或其他扣费合约）。
    /// @dev 走专用 setter 是为了在事件层面留下"谁被授权了"的清晰记录。
    function grantSpender(address spender) external onlyRole(GOVERNOR_ROLE) {
        if (spender == address(0)) revert ZeroAddress();
        _grantRole(SPENDER_ROLE, spender);
        emit SpenderGranted(spender);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────────────

    /// @dev 当前 UTC 日索引。`block.timestamp / 1 days` —— 单调递增，跨实现一致。
    ///      未来若需按 TBA 时区对齐，可加 mapping 偏移参数。
    function _today() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
