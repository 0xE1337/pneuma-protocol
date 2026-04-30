// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {BudgetController} from "../src/BudgetController.sol";

/// @notice BudgetController 单元测试 —— 覆盖每日预算 opt-in 模型 + 原子记账 + UTC 日翻转。
contract BudgetControllerTest is Test {
    BudgetController public budget;

    address public governor = address(0x6011E);
    address public spender = address(0x5DEFE); // 模拟 SkillRegistry
    address public outsider = address(0xFA15E);
    address public tba = address(0xB051);

    function setUp() public {
        budget = new BudgetController(governor);

        vm.prank(governor);
        budget.grantSpender(spender);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  setDailyBudget
    // ─────────────────────────────────────────────────────────────────────

    function test_SetDailyBudget_StoresValue() public {
        vm.prank(tba);
        budget.setDailyBudget(50 * 1e6);

        assertEq(budget.dailyBudget(tba), 50 * 1e6);
    }

    function test_SetDailyBudget_ZeroClearsPrevious() public {
        vm.prank(tba);
        budget.setDailyBudget(50 * 1e6);

        vm.prank(tba);
        budget.setDailyBudget(0);

        assertEq(budget.dailyBudget(tba), 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  tryRecordSpend
    // ─────────────────────────────────────────────────────────────────────

    function test_TryRecordSpend_NoBudget_AlwaysOk() public {
        // 没设预算 → 视为无限额，永远 ok 且不记账
        vm.prank(spender);
        bool ok = budget.tryRecordSpend(tba, 1_000_000 * 1e6);
        assertTrue(ok);
        assertEq(budget.getSpentToday(tba), 0, "no spend recorded under unlimited mode");
    }

    function test_TryRecordSpend_WithinBudget_Succeeds() public {
        vm.prank(tba);
        budget.setDailyBudget(100 * 1e6);

        vm.prank(spender);
        bool ok = budget.tryRecordSpend(tba, 30 * 1e6);
        assertTrue(ok);
        assertEq(budget.getSpentToday(tba), 30 * 1e6);

        vm.prank(spender);
        ok = budget.tryRecordSpend(tba, 40 * 1e6);
        assertTrue(ok);
        assertEq(budget.getSpentToday(tba), 70 * 1e6);
    }

    function test_TryRecordSpend_ExceedingBudget_Fails() public {
        vm.prank(tba);
        budget.setDailyBudget(100 * 1e6);

        vm.prank(spender);
        budget.tryRecordSpend(tba, 80 * 1e6);

        // 80 + 30 > 100 → 拒绝且不记账
        vm.prank(spender);
        bool ok = budget.tryRecordSpend(tba, 30 * 1e6);
        assertFalse(ok);
        assertEq(budget.getSpentToday(tba), 80 * 1e6, "rejected spend must NOT be recorded");
    }

    function test_TryRecordSpend_UnauthorizedCaller_Reverts() public {
        vm.prank(tba);
        budget.setDailyBudget(100 * 1e6);

        // outsider 没有 SPENDER_ROLE，必须 revert（OZ AccessControl）
        // 先缓存 selector 与 role，避免 vm.prank 只对下一笔有效的限制
        bytes4 sel = IAccessControl.AccessControlUnauthorizedAccount.selector;
        bytes32 role = budget.SPENDER_ROLE();
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(sel, outsider, role));
        budget.tryRecordSpend(tba, 10 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Day rollover
    // ─────────────────────────────────────────────────────────────────────

    function test_DayRollover_ResetsSpend() public {
        vm.prank(tba);
        budget.setDailyBudget(50 * 1e6);

        vm.prank(spender);
        budget.tryRecordSpend(tba, 50 * 1e6);
        assertEq(budget.getSpentToday(tba), 50 * 1e6);
        assertEq(budget.getBudgetRemaining(tba), 0);

        // 跨过 UTC 日界
        vm.warp(block.timestamp + 1 days + 1);

        assertEq(budget.getSpentToday(tba), 0, "new UTC day must reset spent counter");
        assertEq(budget.getBudgetRemaining(tba), 50 * 1e6);

        // 新一天能再花满
        vm.prank(spender);
        bool ok = budget.tryRecordSpend(tba, 50 * 1e6);
        assertTrue(ok);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    function test_GetBudgetRemaining_NoBudget_ReturnsMax() public view {
        assertEq(budget.getBudgetRemaining(tba), type(uint256).max);
    }

    function test_GetBudgetRemaining_AfterSpend_DecreasesCorrectly() public {
        vm.prank(tba);
        budget.setDailyBudget(100 * 1e6);
        assertEq(budget.getBudgetRemaining(tba), 100 * 1e6);

        vm.prank(spender);
        budget.tryRecordSpend(tba, 25 * 1e6);
        assertEq(budget.getBudgetRemaining(tba), 75 * 1e6);

        vm.prank(spender);
        budget.tryRecordSpend(tba, 75 * 1e6);
        assertEq(budget.getBudgetRemaining(tba), 0);
    }

    function test_GetStatus_ReportsBudgetSetFlag() public {
        // 未设置：budgetSet=false, remaining=max
        (uint256 daily, uint256 spent, uint256 remaining, bool set) = budget.getStatus(tba);
        assertEq(daily, 0);
        assertEq(spent, 0);
        assertEq(remaining, type(uint256).max);
        assertFalse(set);

        // 设置后：budgetSet=true, remaining=daily
        vm.prank(tba);
        budget.setDailyBudget(40 * 1e6);

        (daily, spent, remaining, set) = budget.getStatus(tba);
        assertEq(daily, 40 * 1e6);
        assertEq(spent, 0);
        assertEq(remaining, 40 * 1e6);
        assertTrue(set);

        // 花掉一些后
        vm.prank(spender);
        budget.tryRecordSpend(tba, 15 * 1e6);
        (daily, spent, remaining, set) = budget.getStatus(tba);
        assertEq(spent, 15 * 1e6);
        assertEq(remaining, 25 * 1e6);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Governance
    // ─────────────────────────────────────────────────────────────────────

    function test_GrantSpender_OnlyGovernor() public {
        address newSpender = address(0xBEEF);

        // outsider 无权
        vm.prank(outsider);
        vm.expectRevert();
        budget.grantSpender(newSpender);

        // governor OK
        vm.prank(governor);
        budget.grantSpender(newSpender);
        assertTrue(budget.hasRole(budget.SPENDER_ROLE(), newSpender));
    }

    function test_GrantSpender_ZeroAddressReverts() public {
        vm.prank(governor);
        vm.expectRevert(BudgetController.ZeroAddress.selector);
        budget.grantSpender(address(0));
    }
}
