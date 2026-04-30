// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

interface IERC6551Account {
    receive() external payable;

    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);

    function state() external view returns (uint256);

    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4 magicValue);
}

interface IERC6551Executable {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}

/// @title SoulAccount
/// @notice Pneuma Soul 的 ERC-6551 智能账户钱包实现。
///         每个 SoulNFT.tokenId 通过 canonical ERC-6551 Registry 派生唯一 TBA 地址。
///         此合约作为 implementation，被 Registry clone 部署到每个派生地址。
/// @dev 基于 erc6551/reference 标准 simple example，删除了升级机制以保证 hackathon 阶段的可审计性。
contract SoulAccount is IERC165, IERC1271, IERC6551Account, IERC6551Executable {
    /// @notice 状态计数器：每次 execute 自增，用于检测账户活跃度
    uint256 public state;

    receive() external payable {}

    /// @notice 由 owner（NFT 持有者）调用，让 TBA 钱包执行任意调用
    /// @dev hackathon 阶段只支持 CALL（operation == 0），不支持 DELEGATECALL / CREATE / CREATE2
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        virtual
        returns (bytes memory result)
    {
        require(_isValidSigner(msg.sender), "SoulAccount: invalid signer");
        require(operation == 0, "SoulAccount: only CALL supported");

        ++state;

        bool success;
        (success, result) = to.call{value: value}(data);

        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /// @notice ERC-6551 标准接口：判断 signer 是否是合法 owner
    function isValidSigner(address signer, bytes calldata) external view virtual returns (bytes4) {
        if (_isValidSigner(signer)) {
            return IERC6551Account.isValidSigner.selector;
        }
        return bytes4(0);
    }

    /// @notice ERC-1271 接口：让 TBA 通过 owner 签名间接验证签名（contract wallet 兼容）
    function isValidSignature(bytes32 hash, bytes memory signature)
        external
        view
        virtual
        returns (bytes4 magicValue)
    {
        bool isValid = SignatureChecker.isValidSignatureNow(owner(), hash, signature);
        if (isValid) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }

    function supportsInterface(bytes4 interfaceId) external pure virtual returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId || interfaceId == type(IERC1271).interfaceId;
    }

    /// @notice 从合约 footer 解析出绑定的 NFT 三元组（chainId, tokenContract, tokenId）
    /// @dev ERC-6551 Registry clone 部署时把这三个值写入合约 bytecode footer
    function token() public view virtual returns (uint256, address, uint256) {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @notice 当前 NFT 的 owner（即 TBA 的最终控制人）
    function owner() public view virtual returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function _isValidSigner(address signer) internal view virtual returns (bool) {
        return signer == owner();
    }
}
