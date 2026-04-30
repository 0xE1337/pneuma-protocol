// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockUSDC
/// @notice 仅用于本地 forge test 的 6-decimal stablecoin mock。
///         Arc Testnet 上真 USDC 系统合约：0x3600000000000000000000000000000000000000，
///         应用层通过 ERC-20 接口（6 decimals）调用即可。生产 / 联调时 Deploy.s.sol 直接传该地址；
///         本 mock 不进 broadcast 流程，仅在 forge test setUp 中部署。
contract MockUSDC is ERC20, ERC20Permit {
    constructor() ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") {}

    /// @notice 6 decimals 与 Circle 真 USDC ERC-20 接口对齐（不是 native gas 的 18 decimals）
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice 测试专用 mint —— 无访问控制，因为只在 forge test 内被调用
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
