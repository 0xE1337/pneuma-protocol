// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";

interface IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address);

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address);
}

/// @notice 仅暴露 SoulNFT 需要的 boundary 写入方法，避免完整 import PneumaAttestation 增加耦合
interface IPneumaAttestationBoundary {
    function attestOwnershipChange(address tba, uint256 tokenId, address from, address to)
        external
        returns (bytes32);
}

/// @title SoulNFT
/// @notice Pneuma 协议的核心身份 NFT —— 每个 AI Agent 一张，转账自由。
///         mint 时自动通过 canonical ERC-6551 Registry 派生 TBA 智能账户钱包。
///
///         **设计取舍**：刻意采用 transferable 而非 soulbound —— 因为亮点 1（"平台关了 Soul 还在 MetaMask"）
///         的物理保证依赖 NFT 可转给新 owner、TBA 跟随转移、履历跟着 TBA 走。soulbound 会断这条链路。
///
///         **亮点 1（可携带）的物理保证**：NFT 转给谁，TBA 钱包就跟谁，履历（PneumaAttestation）也跟着走。
/// @dev 实现 ERC-8004 IdentityRegistry minimal subset（register / register(uri) / setAgentURI）
///      让 ERC-8004 explorer / indexer 能直接读 Pneuma souls，无需 bespoke ABI。
///      额外保留 `publicMint(name, uri)` 作为 Pneuma 自家"带 agentName"的便利入口。
contract SoulNFT is ERC721, AccessControl, IERC8004Identity {
    using Strings for uint256;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice ERC-8004 IdentityRegistry 的 Agent 元信息（agentName 是 Pneuma 扩展，agentURI 走 tokenURI）
    struct Soul {
        string agentName;
        string agentEndpoint;
        string metadataURI;
        address tba;
        uint256 createdAt;
    }

    /// @notice canonical ERC-6551 Registry 地址（多链一致）
    address public immutable erc6551Registry;

    /// @notice SoulAccount 合约地址（implementation，被 Registry clone 派生）
    address public immutable accountImplementation;

    /// @notice PneumaAttestation 合约（用于在 transfer 时写入 ownership boundary）
    /// @dev 反信用洗白攻击的链上锚点：每次主人变更自动写一条 SYSTEM-rater attestation，
    ///      让买家 / 第三方 dApp 能识别"换主人前 vs 换主人后"的履历断层。
    ///      可选依赖 —— 部署时若设为 address(0) 则跳过 boundary 写入（向后兼容）。
    IPneumaAttestationBoundary public immutable pneumaAttestation;

    /// @notice salt（用于 6551 派生地址，固定为 0）
    bytes32 public constant SALT = bytes32(0);

    /// @dev tokenId 自增计数，从 1 开始
    uint256 private _nextTokenId;

    /// @dev tokenId => Soul
    mapping(uint256 => Soul) public souls;

    event SoulMinted(uint256 indexed tokenId, address indexed owner, address tba, string agentName);
    event SoulMetadataUpdated(uint256 indexed tokenId, string newURI);

    /// @notice 当 boundary attestation 写入失败时发出，便于运维链下监控（不影响 transfer）
    event BoundaryAttestationFailed(uint256 indexed tokenId, address indexed from, address indexed to);

    error EmptyAgentName();
    error TokenNonexistent();
    error NotSoulOwner();

    /// @param _erc6551Registry canonical ERC-6551 Registry 地址
    /// @param _accountImplementation SoulAccount 实现合约地址
    /// @param _pneumaAttestation PneumaAttestation 地址（可传 address(0) 跳过 boundary 写入）
    constructor(address _erc6551Registry, address _accountImplementation, address _pneumaAttestation)
        ERC721("Pneuma Soul", "SOUL")
    {
        require(_erc6551Registry != address(0), "SoulNFT: zero registry");
        require(_accountImplementation != address(0), "SoulNFT: zero account impl");
        erc6551Registry = _erc6551Registry;
        accountImplementation = _accountImplementation;
        pneumaAttestation = IPneumaAttestationBoundary(_pneumaAttestation);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Transfer hook —— 反信用洗白攻击的链上锚点
    // ─────────────────────────────────────────────────────────────────────

    /// @dev OZ ERC-721 v5 的统一 transfer / mint / burn 入口。
    ///      mint:  from = address(0)
    ///      burn:  to   = address(0)
    ///      其他:  真转账
    ///
    ///      只在真转账时通知 PneumaAttestation 写一条 boundary。
    ///      用 try/catch 防御 attestation 失败导致 NFT 转账被阻塞（DOS 防御）。
    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);

        if (from != address(0) && to != address(0) && address(pneumaAttestation) != address(0)) {
            address tba = souls[tokenId].tba;
            if (tba != address(0)) {
                try pneumaAttestation.attestOwnershipChange(tba, tokenId, from, to) {
                    // boundary 写入成功 —— 静默
                } catch {
                    // 失败不阻塞 transfer（链上信用反洗白做不成不该牵连产权流转）
                    emit BoundaryAttestationFailed(tokenId, from, to);
                }
            }
        }
    }

    /// @notice mint 一个新的 Soul，并自动派生 ERC-6551 TBA 钱包
    /// @dev hackathon 阶段：任何持 MINTER_ROLE 的地址可 mint 给任何 to。
    ///      生产阶段：可改为开放 mint（任何人 mint 给自己）+ paywall
    function mint(address to, string calldata agentName, string calldata metadataURI)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId, address tba)
    {
        if (bytes(agentName).length == 0) revert EmptyAgentName();
        return _registerInternal(to, agentName, metadataURI);
    }

    /// @notice 公开 mint 给自己 —— hackathon demo 用，无 MINTER_ROLE 限制
    /// @dev 生产部署时应该删掉或加 paywall
    function publicMint(string calldata agentName, string calldata metadataURI)
        external
        returns (uint256 tokenId, address tba)
    {
        if (bytes(agentName).length == 0) revert EmptyAgentName();
        return _registerInternal(msg.sender, agentName, metadataURI);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  ERC-8004 IdentityRegistry compliance
    //  让 ERC-8004 explorer / indexer 直接读 Pneuma souls，无需 bespoke ABI
    // ─────────────────────────────────────────────────────────────────────

    /// @inheritdoc IERC8004Identity
    function register() external returns (uint256 agentId) {
        (agentId,) = _registerInternal(msg.sender, _defaultAgentName(), "");
    }

    /// @inheritdoc IERC8004Identity
    function register(string calldata agentURI) external returns (uint256 agentId) {
        (agentId,) = _registerInternal(msg.sender, _defaultAgentName(), agentURI);
    }

    /// @inheritdoc IERC8004Identity
    /// @dev 与 updateMetadata 等价，但发出 ERC-8004 标准 URIUpdated 事件以便 indexer 识别
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (_ownerOf(agentId) == address(0)) revert TokenNonexistent();
        if (ownerOf(agentId) != msg.sender) revert NotSoulOwner();
        souls[agentId].metadataURI = newURI;
        emit SoulMetadataUpdated(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    /// @dev mint + 派生 TBA + 写 souls + emit 事件的统一内部入口
    ///      被 publicMint / register / register(uri) 共用
    function _registerInternal(address to, string memory agentName, string memory agentURI)
        internal
        returns (uint256 tokenId, address tba)
    {
        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);

        tba = IERC6551Registry(erc6551Registry).createAccount(
            accountImplementation, SALT, block.chainid, address(this), tokenId
        );

        souls[tokenId] = Soul({
            agentName: agentName,
            agentEndpoint: "",
            metadataURI: agentURI,
            tba: tba,
            createdAt: block.timestamp
        });

        emit SoulMinted(tokenId, to, tba, agentName);
        emit Registered(tokenId, agentURI, to); // ERC-8004 标准事件
    }

    /// @dev 给"无名 register()"生成默认 agentName: "Agent #N"
    function _defaultAgentName() internal view returns (string memory) {
        return string.concat("Agent #", (_nextTokenId + 1).toString());
    }

    /// @notice 更新 Soul 的 metadata URI（仅 owner 或被授权地址）
    function updateMetadata(uint256 tokenId, string calldata newURI) external {
        if (_ownerOf(tokenId) == address(0)) revert TokenNonexistent();
        if (ownerOf(tokenId) != msg.sender) revert NotSoulOwner();
        souls[tokenId].metadataURI = newURI;
        emit SoulMetadataUpdated(tokenId, newURI);
    }

    /// @notice 更新 agent endpoint（用于 ERC-8004 服务发现）
    function updateEndpoint(uint256 tokenId, string calldata endpoint) external {
        if (_ownerOf(tokenId) == address(0)) revert TokenNonexistent();
        if (ownerOf(tokenId) != msg.sender) revert NotSoulOwner();
        souls[tokenId].agentEndpoint = endpoint;
    }

    /// @notice 给定 tokenId 直接返回 TBA 地址（不经过 Registry 二次调用）
    function tbaOf(uint256 tokenId) external view returns (address) {
        if (_ownerOf(tokenId) == address(0)) revert TokenNonexistent();
        return souls[tokenId].tba;
    }

    /// @notice 当前已 mint 的 Soul 总数
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @notice tokenURI 直接返回 souls[tokenId].metadataURI
    /// @dev 同时实现 ERC-721 + IERC8004Identity 的 tokenURI 函数（接口签名一致）
    function tokenURI(uint256 tokenId)
        public
        view
        virtual
        override(ERC721, IERC8004Identity)
        returns (string memory)
    {
        if (_ownerOf(tokenId) == address(0)) revert TokenNonexistent();
        return souls[tokenId].metadataURI;
    }

    /// @notice ERC-721 ownerOf —— IERC8004Identity 同签名复用同一实现
    function ownerOf(uint256 tokenId)
        public
        view
        virtual
        override(ERC721, IERC8004Identity)
        returns (address)
    {
        return super.ownerOf(tokenId);
    }

    /// @notice 同时支持 ERC-721 和 AccessControl 两边的 supportsInterface
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
