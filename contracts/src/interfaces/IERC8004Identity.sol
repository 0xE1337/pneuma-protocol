// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IERC8004Identity
/// @notice Minimal subset of the ERC-8004 IdentityRegistry interface that
///         Pneuma SoulNFT implements. ERC-8004 Trustless Agents (draft EIP)
///         deploys an upgradeable ERC-721 minting one NFT per agent
///         (`agentId == tokenId`) with `tokenURI` pointing to an off-chain
///         registration file (the "agent card").
///
///         We adopt the canonical signatures so that any ERC-8004 explorer /
///         indexer can read Pneuma souls without bespoke ABI work.
interface IERC8004Identity {
    // ─────────────────────────── Events ───────────────────────────

    /// @notice Emitted when a new agent is registered (mint).
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    /// @notice Emitted when an agent's URI is updated.
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    // (Transfer event is provided by ERC-721; ERC-8004 reuses it.)

    // ─────────────────────── Mint / registration ───────────────────────

    /// @notice Mint a new agent identity with an empty agentURI.
    /// @return agentId The newly minted tokenId.
    function register() external returns (uint256 agentId);

    /// @notice Mint a new agent identity with an initial agentURI.
    /// @param agentURI Pointer to the off-chain registration file
    ///                  (e.g. ipfs://... or https://...).
    /// @return agentId The newly minted tokenId.
    function register(string calldata agentURI) external returns (uint256 agentId);

    /// @notice Update the agentURI of an existing agent.
    ///         Caller must be the owner or approved operator of `agentId`.
    function setAgentURI(uint256 agentId, string calldata newURI) external;

    // ─────────────────────────── Reads ───────────────────────────

    /// @notice ERC-721 owner of `tokenId`. Reverts on nonexistent token.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Returns the agentURI (registration file pointer) for `tokenId`.
    function tokenURI(uint256 tokenId) external view returns (string memory);
}
