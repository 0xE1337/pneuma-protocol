// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IPneumaAttestation {
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
    ) external returns (bytes32 uid);

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
    ) external returns (bytes32 uid);
}

/// @notice BudgetController hook —— 仅暴露 escrow 前置检查所需入口
/// @dev caller-side per-day 预算硬上限（防 agent 失控被掏空）
interface IBudgetController {
    function tryRecordSpend(address tba, uint256 amount) external returns (bool ok);
}

/// @notice ReputationGraph hook —— 担保图联动 slash
/// @dev 当 SkillRegistry 触发 slash 时，所有 active endorsers 按相同 bps 联动 slash → harmedParty
///      合约层把"社会担保"做成 invariant —— 担保人不能"出事时秒撤逃责"
interface IReputationGraph {
    function onEndorseeSlashed(address endorsee, uint256 slashBps, address harmedParty) external;
}

/// @title SkillRegistry
/// @notice Pneuma 协议的技能市场 + x402 支付托管 + provider 经济安全层。
///         任何持 Soul 的 Agent 可注册技能；任何调用方可 escrow USDC 调用，settle 时 attest 给 caller TBA。
///
///         架构亮点：
///         - escrow 模式：调用方先 escrow 资金，服务方完成后 settle，超时可 refund
///         - settle 触发 attest：每次成功调用都自动生成跨平台可读的链上履历
///         - 与 PneumaAttestation 解耦：通过 ATTESTER_ROLE 授权，可单独升级
///         - 支付层用 USDC（Arc 原生 gas + 标准 ERC-20 接口，6 decimals）—— 不发自创代币
///         - **provider stake + auto-slash**：注册时锁 USDC 押金，超时第三方可 claim 并罚没押金给调用方；
///           revoke attestation 联动 slash，反信用洗白 + SLA 经济兜底
contract SkillRegistry is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    /// @notice slashBps 上限（10000 = 100%）—— 防止误填超过 100%
    uint256 public constant MAX_SLASH_BPS = 10_000;

    /// @notice 价格 floor（0.001 USDC，6 decimals = 1_000）
    /// @dev 协议层的 anti-spam 下限，不是建议价 — provider 实际定价应按成本 + 利润，参考主流 LLM API 价目
    uint256 public constant MIN_PRICE_PER_CALL = 1_000;

    /// @notice 默认 input 字节上限（4 KB ≈ 1k tokens）— Provider 注册时若传 0 则用此默认
    uint32 public constant DEFAULT_MAX_INPUT_BYTES = 4_096;

    /// @notice 输入字节硬上限（1 MB）— 防 Provider 设异常大让 caller 灌 GB 级 DDoS
    uint32 public constant ABSOLUTE_MAX_INPUT_BYTES = 1_048_576;

    struct Skill {
        uint256 skillId;
        address owner; // 服务方收款地址（一般是 SoulAccount 或 EOA）
        string name;
        string description;
        string endpoint; // HTTPS API
        string category; // 用于 attestation 分类
        uint256 pricePerCall; // 支付代币最小单位（USDC = 1e6）—— flat-rate 模式 (per-byte = 0 时 fallback)
        uint256 totalCalls;
        bool active;
        uint256 createdAt;
        // ── provider stake / SLA 经济安全字段（向后追加，避免破坏旧 ABI 顺序）──
        uint256 providerStake; // provider 注册时锁的 USDC 押金（含已 slash 后的剩余）
        uint256 slaTimeoutSec; // SLA 上限（escrow → settle）；超过此时间允许任何人触发 claimTimeoutAndSlash
        uint256 slashBps; // 单次 slash 比例（基点，1e4 = 100%），上限 MAX_SLASH_BPS
        uint256 lockedStake; // 当前被 active call 占用的 stake（不可 withdraw）—— 与 escrow 一一对应
        // ── v4 size-capped pricing tier（抗中转 / 抗 raw LLM 转售）──
        uint32 maxInputBytes;  // input 字节上限：caller escrow 时 inputBytes 必须 ≤ 此值，否则 revert
        uint32 maxOutputBytes; // Provider 承诺的 output 上限（per-byte 模式下为合约层硬约束）
        // ── v5 per-byte pricing + 上游披露（多退少补 + 中转透明度）──
        // 定价模式判定：inputPricePerKB > 0 || outputPricePerKB > 0 → per-byte；否则用 pricePerCall (flat-rate)
        uint256 baseFee;            // per-byte: 固定开销（建立连接 / 路由 / 最小成本）
        uint256 inputPricePerKB;    // per-byte: 输入每 KB 价格（USDC 6 decimals）
        uint256 outputPricePerKB;   // per-byte: 输出每 KB 价格（USDC 6 decimals）
        string upstreamModel;       // 上游模型自声明（"claude-sonnet-4.5" / "self-hosted-llama" / ""）
        uint16 markupBps;           // 自声明 markup 基点（10000 = 100%）—— 透明度抓手
    }

    enum CallStatus {
        Pending, // 0 escrow 中
        Settled, // 1 已结算
        Refunded // 2 已退款 / 已 slash 退还

    }

    struct CallRecord {
        uint256 callId;
        uint256 skillId;
        address caller; // 调用方 EOA / TBA
        address callerTBA; // attestation recipient（跨平台履历挂在 TBA 上）
        uint256 amountEscrowed; // per-byte: maxCost（escrow 上限，settle 时多退少补）；flat-rate: 等于 pricePerCall
        bytes32 paymentHash; // x402 EIP-712 hash
        CallStatus status;
        uint256 startedAt;
        bool slashed; // 是否已被 slash（防止 timeout-slash 与 revoke-slash 双花）
        // ── v5 per-byte 多退少补 ──
        uint32 inputBytes;        // escrow 时 caller 声明的输入字节数（计费基准）
        uint32 maxOutputBytes;    // escrow 时 caller 声明的输出上限（计费上限）
        uint32 actualOutputBytes; // settle 时 Provider 自报的实际输出字节数（≤ maxOutputBytes）
    }

    /// @notice 支付代币（escrow + stake + settle 用） —— 部署时注入 Arc 上的真 USDC 地址（0x3600...）
    IERC20 public immutable paymentToken;

    /// @notice BudgetController hook（可选）—— 已配置时 escrowForCall 调用前会做 caller per-day 预算检查
    /// @dev 默认 address(0) = 不启用预算检查（向后兼容）。Governor 可通过 setBudgetController 配置。
    IBudgetController public budgetController;

    /// @notice ReputationGraph hook（可选）—— 已配置时 slash 联动担保图
    /// @dev 默认 address(0) = 不启用担保联动（向后兼容）。Governor 可通过 setReputationGraph 配置。
    IReputationGraph public reputationGraph;

    /// @notice PneumaCourt（可选）—— 已配置时 court 多陪审员判决 guilty 可触发 slash
    /// @dev 默认 address(0) = 不启用 court 路径（向后兼容）。Governor 可通过 setPneumaCourt 配置。
    address public pneumaCourt;

    /// @notice attestation 注册器
    IPneumaAttestation public immutable pneumaAttestation;

    /// @notice escrow 超时（默认 1 小时，超时后调用方可主动 refund，无 slash）
    uint256 public callTimeout = 1 hours;

    uint256 private _skillCount;
    uint256 private _callCount;

    mapping(uint256 => Skill) private _skills;
    mapping(uint256 => CallRecord) private _calls;

    /// @dev callId => 是否已被 caller 反向评分（一个 callId 只能反评一次，防刷分）
    mapping(uint256 => bool) private _callerRated;

    event SkillRegistered(uint256 indexed skillId, address indexed owner, string name, uint256 pricePerCall);
    event SkillRegisteredWithStake(
        uint256 indexed skillId,
        address indexed owner,
        uint256 providerStake,
        uint256 slaTimeoutSec,
        uint256 slashBps
    );
    event SkillUpdated(uint256 indexed skillId, uint256 newPrice, bool active);
    event StakeWithdrawn(uint256 indexed skillId, address indexed owner, uint256 amount);
    event CallEscrowed(
        uint256 indexed callId,
        uint256 indexed skillId,
        address indexed caller,
        address callerTBA,
        uint256 amount,
        bytes32 paymentHash
    );
    event CallSettled(uint256 indexed callId, uint8 rating, bytes32 attestationUid);
    event CallRefunded(uint256 indexed callId, address indexed caller);
    event CallSlashed(
        uint256 indexed callId,
        uint256 indexed skillId,
        uint256 slashAmount,
        address slashedTo,
        SlashReason reason
    );
    event CallerRatedSkill(
        uint256 indexed callId,
        uint256 indexed skillId,
        address indexed caller,
        uint8 rating,
        bytes32 attestationUid
    );

    /// @notice slash 触发原因 —— 链下 indexer / 前端按原因分类展示
    enum SlashReason {
        Timeout, // 第三方在 SLA 过期后调用 claimTimeoutAndSlash
        Revoke, // PneumaAttestation.revoke 联动 slashOnRevoke
        CourtRuling // PneumaCourt 多陪审员判决 guilty

    }

    error SkillNotFound();
    error SkillInactive();
    error NotSkillOwner();
    error InvalidRating();
    error CallNotFound();
    error CallNotPending();
    error CallNotTimedOut();
    error InvalidAmount();
    error InvalidTBA();
    error CallNotSettled();
    error NotCaller();
    error AlreadyCallerRated();
    error SlashBpsTooHigh();
    error InsufficientWithdrawableStake();
    error SlaNotExpired();
    error AlreadySlashed();
    error NotAttestationContract();
    error InvalidSlaTimeout();
    error BudgetExceeded();
    /// @dev court: msg.sender 不是已配置的 PneumaCourt 地址
    error NotCourtContract();
    /// @dev provider 不能作为自己 skill 的 caller —— 防最低门槛 self-dealing 刷分（同地址版本）
    /// 注意：这一层只挡同 EOA 自调，多钱包刷分需要靠声誉公式 unique-callers 因子 + 链下 sybil detection 兜底
    error SelfCallForbidden();
    /// @dev v4: pricePerCall 低于 MIN_PRICE_PER_CALL — 协议层 anti-spam 下限
    error PriceTooLow();
    /// @dev v4: maxInputBytes 超过 ABSOLUTE_MAX_INPUT_BYTES — 防 Provider 设异常大让 caller 灌 GB
    error MaxInputBytesTooLarge();
    /// @dev v4: caller escrow 时声明的 inputBytes 超过 skill.maxInputBytes — 防 DDoS 灌输入
    error InputTooLarge();
    /// @dev v5: settle 时 actualOutputBytes 超过 escrow 时 caller 声明的 maxOutputBytes — Provider 不可虚报
    error OutputExceedsMax();
    /// @dev per-byte: skill 必须显式 maxOutputBytes > 0（per-byte 计费需要 output 上限作为 escrow 锚点）
    error InvalidOutputCap();

    /// @notice 注册参数 —— 用 struct 避免 stack-too-deep
    struct RegisterParams {
        string name;
        string description;
        string endpoint;
        string category;
        uint256 pricePerCall;        // flat-rate 模式：> 0；per-byte 模式：可为 0
        uint256 providerStake;
        uint256 slaTimeoutSec;
        uint256 slashBps;
        uint32 maxInputBytes;
        uint32 maxOutputBytes;
        // per-byte 字段（flat-rate 注册可全部传 0 / ""）
        uint256 baseFee;
        uint256 inputPricePerKB;
        uint256 outputPricePerKB;
        string upstreamModel;
        uint16 markupBps;
    }

    /// @notice BudgetController 地址变更（治理事件）
    event BudgetControllerUpdated(address indexed oldController, address indexed newController);

    /// @notice ReputationGraph 地址变更（治理事件）
    event ReputationGraphUpdated(address indexed oldGraph, address indexed newGraph);

    /// @notice PneumaCourt 地址变更（治理事件）
    event PneumaCourtUpdated(address indexed oldCourt, address indexed newCourt);

    constructor(address paymentTokenAddress, address attestation, address governor) {
        require(paymentTokenAddress != address(0), "SkillRegistry: zero paymentToken");
        require(attestation != address(0), "SkillRegistry: zero attestation");
        paymentToken = IERC20(paymentTokenAddress);
        pneumaAttestation = IPneumaAttestation(attestation);

        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  注册 / 管理
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 注册一个新 skill —— 任何地址都能注册
    /// @dev provider 必须先 approve `providerStake` 数量 USDC；本函数会 transferFrom 到合约托管。
    ///      v4 起：pricePerCall ≥ MIN_PRICE_PER_CALL（防 0 价羊毛党）；
    ///             maxInputBytes 必须 ≤ ABSOLUTE_MAX_INPUT_BYTES（防 DDoS 灌输入）。
    ///             Provider 通过设不同 maxInputBytes 拆 tier（如 translate-tiny / -small / -medium / -large）
    ///             模拟 per-token 体验，协议层保持 per-call 简单。
    ///      slashBps 上限 MAX_SLASH_BPS（10000 = 100%）；slaTimeoutSec 不能为 0。
    /// @param name 技能名
    /// @param description 描述
    /// @param endpoint HTTPS 端点
    /// @param category 分类（用于 attestation）
    /// @param pricePerCall 每次调用价格（USDC 6 decimals），必须 ≥ MIN_PRICE_PER_CALL
    /// @param providerStake 注册押金（可为 0）
    /// @param slaTimeoutSec SLA 上限秒数（必须 > 0）
    /// @param slashBps 单次 slash 比例基点（0 - 10000）
    /// @param maxInputBytes 输入字节上限（0 = 用 DEFAULT_MAX_INPUT_BYTES = 4 KB）
    /// @param maxOutputBytes Provider 承诺的输出字节上限（链下行为参考，可为 0）
    /// @return skillId 新生成的 skill id
    function registerSkill(
        string calldata name,
        string calldata description,
        string calldata endpoint,
        string calldata category,
        uint256 pricePerCall,
        uint256 providerStake,
        uint256 slaTimeoutSec,
        uint256 slashBps,
        uint32 maxInputBytes,
        uint32 maxOutputBytes
    ) external returns (uint256 skillId) {
        // 委派给 per-byte 全量入口，per-byte 字段全部置 0 / "" → flat-rate 模式
        return _registerSkillImpl(
            RegisterParams({
                name: name,
                description: description,
                endpoint: endpoint,
                category: category,
                pricePerCall: pricePerCall,
                providerStake: providerStake,
                slaTimeoutSec: slaTimeoutSec,
                slashBps: slashBps,
                maxInputBytes: maxInputBytes,
                maxOutputBytes: maxOutputBytes,
                baseFee: 0,
                inputPricePerKB: 0,
                outputPricePerKB: 0,
                upstreamModel: "",
                markupBps: 0
            })
        );
    }

    /// @notice per-byte 注册入口 —— per-byte 计费 + 上游披露 + 多退少补
    /// @dev per-byte 模式判定：`p.inputPricePerKB > 0 || p.outputPricePerKB > 0`。
    ///      per-byte 模式下 `maxOutputBytes` 必须 > 0（escrow 计算需要 output 上限锚定）；
    ///      per-byte 模式下 `pricePerCall` 可为 0（per-byte 是主计费路径），但若 > 0 则需 ≥ MIN_PRICE_PER_CALL；
    ///      per-byte 模式下 escrow 时 `maxCost = baseFee + inputPricePerKB*inputBytes/1024 + outputPricePerKB*maxOutputBytes/1024`
    ///      必须 ≥ MIN_PRICE_PER_CALL（防 0 价羊毛党，由 escrowForCall 校验）
    function registerSkillFull(RegisterParams calldata p) external returns (uint256 skillId) {
        return _registerSkillImpl(p);
    }

    function _registerSkillImpl(RegisterParams memory p) internal returns (uint256 skillId) {
        bool isV5 = p.inputPricePerKB > 0 || p.outputPricePerKB > 0;

        // flat-rate 模式：pricePerCall 必须 ≥ MIN_PRICE_PER_CALL；per-byte 模式：若声明 pricePerCall 也要 ≥ MIN（或为 0）
        if (!isV5) {
            if (p.pricePerCall < MIN_PRICE_PER_CALL) revert PriceTooLow();
        } else {
            if (p.pricePerCall != 0 && p.pricePerCall < MIN_PRICE_PER_CALL) revert PriceTooLow();
            // per-byte 必须显式 maxOutputBytes，否则 escrow 计算的 maxCost 没上限
            if (p.maxOutputBytes == 0) revert InvalidOutputCap();
        }
        if (p.slashBps > MAX_SLASH_BPS) revert SlashBpsTooHigh();
        if (p.slaTimeoutSec == 0) revert InvalidSlaTimeout();
        if (p.maxInputBytes > ABSOLUTE_MAX_INPUT_BYTES) revert MaxInputBytesTooLarge();

        // 0 = 用 default，让 provider 不必每次写一个 magic number
        uint32 effectiveMaxInput = p.maxInputBytes == 0 ? DEFAULT_MAX_INPUT_BYTES : p.maxInputBytes;

        skillId = ++_skillCount;
        _skills[skillId] = Skill({
            skillId: skillId,
            owner: msg.sender,
            name: p.name,
            description: p.description,
            endpoint: p.endpoint,
            category: p.category,
            pricePerCall: p.pricePerCall,
            totalCalls: 0,
            active: true,
            createdAt: block.timestamp,
            providerStake: p.providerStake,
            slaTimeoutSec: p.slaTimeoutSec,
            slashBps: p.slashBps,
            lockedStake: 0,
            maxInputBytes: effectiveMaxInput,
            maxOutputBytes: p.maxOutputBytes,
            baseFee: p.baseFee,
            inputPricePerKB: p.inputPricePerKB,
            outputPricePerKB: p.outputPricePerKB,
            upstreamModel: p.upstreamModel,
            markupBps: p.markupBps
        });

        if (p.providerStake > 0) {
            paymentToken.safeTransferFrom(msg.sender, address(this), p.providerStake);
        }

        emit SkillRegistered(skillId, msg.sender, p.name, p.pricePerCall);
        emit SkillRegisteredWithStake(skillId, msg.sender, p.providerStake, p.slaTimeoutSec, p.slashBps);
    }

    /// @notice 计算 escrow maxCost —— per-byte 计费 + baseFee
    /// @dev 使用 KB 颗粒度：bytes/1024 + 1（向上取整避免 0），保证 1B 也至少计 1 KB
    function _computeMaxCostV5(Skill memory s, uint32 inputBytes, uint32 maxOutputBytes)
        internal
        pure
        returns (uint256 maxCost)
    {
        uint256 inputKB = (uint256(inputBytes) + 1023) / 1024; // 向上取整
        uint256 outputKB = (uint256(maxOutputBytes) + 1023) / 1024;
        maxCost = s.baseFee + s.inputPricePerKB * inputKB + s.outputPricePerKB * outputKB;
    }

    /// @notice 计算 settle actualCost —— 用 Provider 自报的实际输出字节
    function _computeActualCostV5(Skill memory s, uint32 inputBytes, uint32 actualOutputBytes)
        internal
        pure
        returns (uint256 actualCost)
    {
        uint256 inputKB = (uint256(inputBytes) + 1023) / 1024;
        uint256 outputKB = (uint256(actualOutputBytes) + 1023) / 1024;
        actualCost = s.baseFee + s.inputPricePerKB * inputKB + s.outputPricePerKB * outputKB;
    }

    /// @notice 判定 skill 是否启用 per-byte 模式
    function _isV5Mode(Skill memory s) internal pure returns (bool) {
        return s.inputPricePerKB > 0 || s.outputPricePerKB > 0;
    }

    /// @notice 更新自己 skill 的价格 / 启停状态
    function updateSkill(uint256 skillId, uint256 newPrice, bool active) external {
        Skill storage s = _skills[skillId];
        if (s.skillId == 0) revert SkillNotFound();
        if (s.owner != msg.sender) revert NotSkillOwner();
        s.pricePerCall = newPrice;
        s.active = active;
        emit SkillUpdated(skillId, newPrice, active);
    }

    /// @notice Provider 提取剩余可用押金
    /// @dev 不可超过 `providerStake - lockedStake`；不影响 active call 的 SLA 兜底
    /// @param skillId 目标 skill
    /// @param amount 提取数量
    function withdrawStake(uint256 skillId, uint256 amount) external {
        Skill storage s = _skills[skillId];
        if (s.skillId == 0) revert SkillNotFound();
        if (s.owner != msg.sender) revert NotSkillOwner();
        if (amount == 0) revert InvalidAmount();

        uint256 available = s.providerStake - s.lockedStake;
        if (amount > available) revert InsufficientWithdrawableStake();

        unchecked {
            s.providerStake -= amount;
        }

        paymentToken.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(skillId, msg.sender, amount);
    }

    /// @notice Governor 紧急关闭某个 skill（争议 / 滥用场景）
    function emergencyDeactivate(uint256 skillId) external onlyRole(GOVERNOR_ROLE) {
        Skill storage s = _skills[skillId];
        if (s.skillId == 0) revert SkillNotFound();
        s.active = false;
        emit SkillUpdated(skillId, s.pricePerCall, false);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Escrow / Settle / Refund
    // ─────────────────────────────────────────────────────────────────────

    /// @notice 调用方 escrow USDC 锁仓 —— x402 middleware 在 verify 签名后调用此函数
    /// @dev 设计选择：lockedStake += amount —— stake 锁定量与 escrow 一一对应，
    ///      保证 slash 必能覆盖 escrow 退款（slashAmount 来自 stake，escrow 本身原路退给 caller）。
    ///      若 stake 不足以覆盖 lockedStake 增量？目前不强制 —— provider 选低 stake 是自损（slash 上限受 stake 限制）
    ///
    ///      **v4 size cap**：caller 必须声明 inputBytes（即将发送的请求体字节数），
    ///      合约比对 `skill.maxInputBytes` 守住 DDoS（灌 GB 级输入薅 Provider 是 0 利润）。
    ///      Provider 自拆 tier（small/medium/large skill）让 caller 按需选 → 模拟 per-token 体验，
    ///      协议层保持 per-call 简单（兼容 x402 的 pay-before-serve 同步语义）。
    ///
    ///      **per-byte 多退少补**：当 skill 启用 per-byte 模式（inputPricePerKB / outputPricePerKB > 0）时：
    ///      - escrow 锁定 = baseFee + inputPricePerKB·inputKB + outputPricePerKB·maxOutputBytesKB（上限）
    ///      - settle 时 Provider 自报 actualOutputBytes，按实际计费，余额自动退还 caller（多退少补）
    ///      - 兼容 x402 同步语义：单次 escrow 锁定 maxCost，无需事后追账
    /// @param skillId 要调用的 skill
    /// @param callerTBA 调用方的 SoulAccount 地址（attestation 挂在这里 → 跟随 NFT 流转）
    /// @param paymentHash x402 EIP-712 payment hash（反伪造锚点）
    /// @param inputBytes caller 即将发往 service 的请求体字节数（off-chain middleware 应再次校验确保一致）
    /// @param maxOutputBytes per-byte 模式下 caller 声明的输出上限（flat-rate 模式忽略，传 0 即可）
    /// @return callId 生成的 call id
    function escrowForCall(
        uint256 skillId,
        address callerTBA,
        bytes32 paymentHash,
        uint32 inputBytes,
        uint32 maxOutputBytes
    ) external returns (uint256 callId) {
        Skill storage s = _skills[skillId];
        if (s.skillId == 0) revert SkillNotFound();
        if (!s.active) revert SkillInactive();
        if (callerTBA == address(0)) revert InvalidTBA();
        if (inputBytes > s.maxInputBytes) revert InputTooLarge();

        // L1 反 self-dealing：provider 不能用自己的 EOA 作为 caller 调自己 skill
        // 这一层只挡"同地址"自调（攻击者 5 行代码可绕：换钱包 + mint 新 Soul）
        // 真正的多钱包 sybil 防御靠：(a) reputation 公式的 unique-callers 因子
        //                            (b) revoke→slash 事后纠错回路
        //                            (c) 链下 sybil detection indexer
        if (msg.sender == s.owner) revert SelfCallForbidden();

        // 双模式 amount 计算（per-byte vs flat-rate）
        bool v5 = _isV5Mode(s);
        uint256 amount;
        uint32 effectiveMaxOutput;
        if (v5) {
            // per-byte 模式：caller 必须声明 maxOutputBytes 且 ≤ skill.maxOutputBytes（Provider 注册的上限）
            if (maxOutputBytes == 0 || maxOutputBytes > s.maxOutputBytes) revert OutputExceedsMax();
            effectiveMaxOutput = maxOutputBytes;
            amount = _computeMaxCostV5(s, inputBytes, maxOutputBytes);
            // per-byte 模式 escrow 锁定金额仍要 ≥ MIN_PRICE_PER_CALL（运行时 anti-spam）
            if (amount < MIN_PRICE_PER_CALL) revert PriceTooLow();
        } else {
            // flat-rate 模式：忽略 caller 传的 maxOutputBytes，用 pricePerCall
            effectiveMaxOutput = 0;
            amount = s.pricePerCall;
        }

        // BudgetController 前置检查（可选，opt-in）：caller 的 TBA 当日花费上限硬约束
        // 对未配置 budget 的 TBA 该函数返回 true 不阻塞；超额则 revert，由 caller 决定换 skill 或停止
        // per-byte 时 budget 用 maxCost（escrow 上限）记账，多退后超额额度可在事后调整 indexer
        IBudgetController bc = budgetController;
        if (address(bc) != address(0)) {
            if (!bc.tryRecordSpend(callerTBA, amount)) revert BudgetExceeded();
        }

        callId = ++_callCount;
        _calls[callId] = CallRecord({
            callId: callId,
            skillId: skillId,
            caller: msg.sender,
            callerTBA: callerTBA,
            amountEscrowed: amount,
            paymentHash: paymentHash,
            status: CallStatus.Pending,
            startedAt: block.timestamp,
            slashed: false,
            inputBytes: inputBytes,
            maxOutputBytes: effectiveMaxOutput,
            actualOutputBytes: 0
        });

        if (amount > 0) {
            // 锁定 provider stake：避免 escrow 期间 provider 撤资逃避 SLA
            s.lockedStake += amount;
            // 把 USDC 从调用方拉到合约托管（调用方应先 approve）
            paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        }

        emit CallEscrowed(callId, skillId, msg.sender, callerTBA, amount, paymentHash);
    }

    /// @notice 治理：配置 / 更换 BudgetController（传 address(0) 关闭预算检查）
    /// @dev 切换后立即对后续 escrow 生效；已 escrow 的 active call 不受影响
    function setBudgetController(address newController) external onlyRole(GOVERNOR_ROLE) {
        address old = address(budgetController);
        budgetController = IBudgetController(newController);
        emit BudgetControllerUpdated(old, newController);
    }

    /// @notice 治理：配置 / 更换 ReputationGraph（传 address(0) 关闭担保联动 slash）
    /// @dev slash 时如果 graph 已配置，会调用其 onEndorseeSlashed 联动 slash 担保人
    ///      未配置时 slash 行为跟 v5 完全一致（向后兼容）
    function setReputationGraph(address newGraph) external onlyRole(GOVERNOR_ROLE) {
        address old = address(reputationGraph);
        reputationGraph = IReputationGraph(newGraph);
        emit ReputationGraphUpdated(old, newGraph);
    }

    /// @notice 治理：配置 / 更换 PneumaCourt
    /// @dev 配置后，PneumaCourt 在 guilty 判决时可调 slashOnCourtRuling 触发 slash
    ///      未配置时 court 路径不可用（向后兼容）
    function setPneumaCourt(address newCourt) external onlyRole(GOVERNOR_ROLE) {
        address old = pneumaCourt;
        pneumaCourt = newCourt;
        emit PneumaCourtUpdated(old, newCourt);
    }

    /// @notice 内部辅助：调用 ReputationGraph slash 钩子（如果已配置）
    /// @dev try/catch 防止 graph 内部 revert 阻塞 slash 主流程（slash 是兜底救济，不能因为联动失败而失败）
    function _maybeNotifyReputationGraph(address endorsee, uint256 slashBps, address harmedParty)
        internal
    {
        IReputationGraph graph = reputationGraph;
        if (address(graph) == address(0)) return;
        if (slashBps == 0) return;
        if (harmedParty == address(0)) return;
        try graph.onEndorseeSlashed(endorsee, slashBps, harmedParty) {
            // success
        } catch {
            // 联动失败不阻塞主 slash 流程（事后链下 indexer 可补救）
        }
    }

    /// @notice 服务方 settle —— 把 escrow 的 USDC 发给 skill owner，并触发 attestation
    /// @dev 仅 skill owner 可以 settle 自己 skill 的 call（信任最小化的简化设计）
    ///
    ///      **v5 多退少补（per-byte 模式）**：
    ///      - Provider 自报 `actualOutputBytes`（必须 ≤ caller escrow 时声明的 maxOutputBytes，否则 revert）
    ///      - actualCost = baseFee + inputPricePerKB·inputKB + outputPricePerKB·actualOutputKB
    ///      - Provider 拿走 actualCost，escrow 余额（maxCost - actualCost）原路退回 caller
    ///      - attestation.paidAmount = actualCost（链上履历记录真实成本，不是 escrow 上限）
    ///      - Provider 虚报多收 → caller 自验响应字节数 → JUROR dispute → revoke + slash
    ///
    ///      flat-rate 模式忽略 `actualOutputBytes`（传 0 即可）。
    /// @param callId 要 settle 的 callId
    /// @param actualOutputBytes per-byte 模式下 Provider 自报的实际输出字节数（flat-rate 模式传 0）
    /// @param rating provider 给 caller 的评分（1-5）
    /// @param comment provider 写给 caller 的备注（可空字符串），写入 attestation
    function settleCall(uint256 callId, uint32 actualOutputBytes, uint8 rating, string calldata comment)
        external
        returns (bytes32 attestationUid)
    {
        CallRecord storage c = _calls[callId];
        if (c.callId == 0) revert CallNotFound();
        if (c.status != CallStatus.Pending) revert CallNotPending();
        if (rating < 1 || rating > 5) revert InvalidRating();

        Skill storage s = _skills[c.skillId];
        if (s.owner != msg.sender) revert NotSkillOwner();

        c.status = CallStatus.Settled;
        s.totalCalls += 1;

        // 释放对应的 stake 锁定 —— provider 完成 SLA，stake 重新可 withdraw
        // amount = 0 时 lockedStake 不变（没锁过），decrement 0 是 no-op 但保留 unchecked 块语义清晰
        unchecked {
            s.lockedStake -= c.amountEscrowed;
        }

        // 双模式 actualCost 计算 + 多退少补
        bool v5 = _isV5Mode(s);
        uint256 actualCost;
        if (v5) {
            // Provider 不可虚报：actualOutputBytes 必须 ≤ caller 声明的 maxOutputBytes
            if (actualOutputBytes > c.maxOutputBytes) revert OutputExceedsMax();
            c.actualOutputBytes = actualOutputBytes;
            actualCost = _computeActualCostV5(s, c.inputBytes, actualOutputBytes);
            // 安全检查：实际成本不可超过 escrow（理论上不会，但防溢出 / 浮点漂移）
            if (actualCost > c.amountEscrowed) {
                actualCost = c.amountEscrowed;
            }

            // 退还多余 escrow 给 caller（多退少补的"多退"）
            uint256 refund = c.amountEscrowed - actualCost;
            if (refund > 0) {
                paymentToken.safeTransfer(c.caller, refund);
            }
        } else {
            // flat-rate 模式：actualCost = escrow 全额
            actualCost = c.amountEscrowed;
        }

        // 把 actualCost 转给 skill owner（per-byte 模式可能小于 escrow；flat-rate = 全额）
        if (actualCost > 0) {
            paymentToken.safeTransfer(s.owner, actualCost);
        }

        // 触发 attestation —— 履历挂在 callerTBA 上，记录真实 paidAmount（actualCost），并把 callId 作为 revoke→slash 反查 key
        attestationUid = pneumaAttestation.attest(
            c.callerTBA,
            c.skillId,
            callId,
            c.paymentHash,
            rating,
            actualCost,
            s.name,
            s.category,
            comment
        );

        emit CallSettled(callId, rating, attestationUid);
    }

    /// @notice 调用方 refund —— escrow 超时后可主动退款（无 slash，向后兼容路径）
    /// @dev SLA 内 caller 主动撤回；若希望 SLA 触发后惩罚 provider，请用 claimTimeoutAndSlash
    function refundCall(uint256 callId) external {
        CallRecord storage c = _calls[callId];
        if (c.callId == 0) revert CallNotFound();
        if (c.status != CallStatus.Pending) revert CallNotPending();
        if (c.caller != msg.sender) revert NotCaller();
        if (block.timestamp < c.startedAt + callTimeout) revert CallNotTimedOut();

        Skill storage s = _skills[c.skillId];

        c.status = CallStatus.Refunded;

        // 释放 stake 锁定 —— call 不再 active（amount=0 时为 no-op）
        unchecked {
            s.lockedStake -= c.amountEscrowed;
        }

        if (c.amountEscrowed > 0) {
            paymentToken.safeTransfer(c.caller, c.amountEscrowed);
        }

        emit CallRefunded(callId, c.caller);
    }

    /// @notice **任何人** 都可以触发：SLA 过期未 settle → 退款 caller + slash provider 押金给 caller
    /// @dev 开放 keeper 接口，让协议外的 watchdog 也能主动惩罚不守 SLA 的 provider。
    ///      slashAmount = (skill.providerStake * slashBps) / 1e4，受可用 stake 上限保护。
    ///      v1 简化：100% slash 给 caller（同时也是退款触发者）；未来可拆 keeper 奖励 + caller 补偿。
    /// @param callId 目标 call
    function claimTimeoutAndSlash(uint256 callId) external {
        CallRecord storage c = _calls[callId];
        if (c.callId == 0) revert CallNotFound();
        if (c.status != CallStatus.Pending) revert CallNotPending();
        if (c.slashed) revert AlreadySlashed();

        Skill storage s = _skills[c.skillId];
        if (block.timestamp < c.startedAt + s.slaTimeoutSec) revert SlaNotExpired();

        // 标记状态：先记 slashed + Refunded，后转账（CEI 风格）
        c.slashed = true;
        c.status = CallStatus.Refunded;

        // 计算 slash 量：上限 = providerStake（不能负数）
        uint256 slashAmount;
        unchecked {
            slashAmount = (s.providerStake * s.slashBps) / MAX_SLASH_BPS;
        }
        if (slashAmount > s.providerStake) {
            slashAmount = s.providerStake;
        }

        // 释放 stake 锁定 + 扣减 stake
        unchecked {
            s.lockedStake -= c.amountEscrowed;
            s.providerStake -= slashAmount;
        }

        // 1) 原路退还 escrow 给 caller（amount=0 跳过）
        if (c.amountEscrowed > 0) {
            paymentToken.safeTransfer(c.caller, c.amountEscrowed);
        }
        // 2) 把 slash 转给 caller（v1：caller 同时是 keeper）
        if (slashAmount > 0) {
            paymentToken.safeTransfer(c.caller, slashAmount);
        }

        emit CallRefunded(callId, c.caller);
        emit CallSlashed(callId, c.skillId, slashAmount, c.caller, SlashReason.Timeout);

        // V6.0.2: 担保图联动 slash —— provider 的所有 active endorsers 按相同 bps 联动 slash
        _maybeNotifyReputationGraph(s.owner, s.slashBps, c.caller);
    }

    /// @notice **PneumaAttestation 专用钩子**：revoke attestation 时联动 slash provider 押金
    /// @dev 安全约束：
    ///      - 仅 PneumaAttestation 合约可调（防止任意 EOA 触发 slash）
    ///      - 单 callId 只能 slash 一次（防 timeout-slash + revoke-slash 双花）
    ///      - call 必须存在且 Settled（revoke 是对已结算 call 的事后惩罚）
    ///      slash 资金转给原 caller（被欺骗的一方），与 timeout 路径一致
    /// @param callId 被 revoke 的 attestation 关联的 callId
    function slashOnRevoke(uint256 callId) external {
        if (msg.sender != address(pneumaAttestation)) revert NotAttestationContract();

        CallRecord storage c = _calls[callId];
        if (c.callId == 0) revert CallNotFound();
        if (c.slashed) revert AlreadySlashed();

        Skill storage s = _skills[c.skillId];

        c.slashed = true;

        uint256 slashAmount;
        unchecked {
            slashAmount = (s.providerStake * s.slashBps) / MAX_SLASH_BPS;
        }
        if (slashAmount > s.providerStake) {
            slashAmount = s.providerStake;
        }

        unchecked {
            s.providerStake -= slashAmount;
        }

        if (slashAmount > 0) {
            paymentToken.safeTransfer(c.caller, slashAmount);
        }

        emit CallSlashed(callId, c.skillId, slashAmount, c.caller, SlashReason.Revoke);

        // V6.0.2: 担保图联动 slash —— 跟 timeout 路径一致
        _maybeNotifyReputationGraph(s.owner, s.slashBps, c.caller);
    }

    /// @notice **PneumaCourt 专用钩子**（V6.1）：多陪审员 guilty 判决时联动 slash
    /// @dev 安全约束：
    ///      - 仅已配置的 PneumaCourt 地址可调
    ///      - 单 callId 只能 slash 一次（防 timeout / revoke / court 三路双花）
    ///      slash 资金转给原 caller（被欺骗的一方），与 timeout / revoke 路径一致
    /// @param callId 被 court 判 guilty 的 callId
    function slashOnCourtRuling(uint256 callId) external {
        if (msg.sender != pneumaCourt) revert NotCourtContract();

        CallRecord storage c = _calls[callId];
        if (c.callId == 0) revert CallNotFound();
        if (c.slashed) revert AlreadySlashed();

        Skill storage s = _skills[c.skillId];

        c.slashed = true;

        uint256 slashAmount;
        unchecked {
            slashAmount = (s.providerStake * s.slashBps) / MAX_SLASH_BPS;
        }
        if (slashAmount > s.providerStake) {
            slashAmount = s.providerStake;
        }

        unchecked {
            s.providerStake -= slashAmount;
        }

        if (slashAmount > 0) {
            paymentToken.safeTransfer(c.caller, slashAmount);
        }

        emit CallSlashed(callId, c.skillId, slashAmount, c.caller, SlashReason.CourtRuling);

        // V6.0.2: 担保图联动 slash —— 跟 timeout / revoke 路径一致
        _maybeNotifyReputationGraph(s.owner, s.slashBps, c.caller);
    }

    /// @notice V6.1 Court 用：根据 skillId 拿 owner（Court 验证 defendant 身份）
    /// @dev 单字段 view 比 getSkill 返回完整 struct 便宜很多
    function getSkillOwner(uint256 skillId) external view returns (address) {
        if (_skills[skillId].skillId == 0) revert SkillNotFound();
        return _skills[skillId].owner;
    }

    /// @notice Governor 调整超时时间
    function setCallTimeout(uint256 newTimeout) external onlyRole(GOVERNOR_ROLE) {
        callTimeout = newTimeout;
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Caller 反向评分（multi-rater attestation）
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Caller 在 settle 完成后给 skill provider 反向打分 + 写文字评论
    /// @dev 防刷分核心策略：必须是该 callId 的 caller 本人，并且 callId 已 Settled
    ///      一个 callId 只能反评一次（_callerRated[callId] 锁），杜绝累计刷分
    ///      写入 attestation 时 raterRole = CALLER（前端按角色权重聚合 reputation）
    ///
    ///      **comment 字段是协议层"用户点评"原语**：让真实付费方留下文字反馈，
    ///      其他 caller 在选 skill 时除了看 score，还能读真用户的评价文字 —
    ///      跟 Amazon 评论一样靠"读评论文字 + 看评分趋势" 综合判断，而不是单看星数。
    ///      链上 280 字符上限（一条 tweet 长度），足够表达"哪里好/哪里坑/建议改进"。
    /// @param callId  原 escrow 调用 id
    /// @param rating  1-5 评分
    /// @param comment 用户文字评论（可空字符串）
    /// @return attestationUid 写入的 attestation uid
    function callerRateSkill(uint256 callId, uint8 rating, string calldata comment)
        external
        returns (bytes32 attestationUid)
    {
        CallRecord storage c = _calls[callId];
        if (c.callId == 0) revert CallNotFound();
        if (c.status != CallStatus.Settled) revert CallNotSettled();
        if (c.caller != msg.sender) revert NotCaller();
        if (rating < 1 || rating > 5) revert InvalidRating();
        if (_callerRated[callId]) revert AlreadyCallerRated();

        _callerRated[callId] = true;

        Skill storage s = _skills[c.skillId];
        // recipient = skill owner 直接收 EOA 评分
        // hackathon 简化：未来可改为"如果 owner 持 SOUL 则用其 TBA"以让评分跟随 NFT
        attestationUid = pneumaAttestation.attestFromCaller(
            s.owner, c.skillId, callId, c.paymentHash, rating, c.amountEscrowed, s.name, s.category, comment
        );

        emit CallerRatedSkill(callId, c.skillId, msg.sender, rating, attestationUid);
    }

    /// @notice 查询某 callId 是否已被 caller 反向评分（前端 UX 用）
    function callerHasRated(uint256 callId) external view returns (bool) {
        return _callerRated[callId];
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────

    function getSkill(uint256 skillId) external view returns (Skill memory) {
        if (_skills[skillId].skillId == 0) revert SkillNotFound();
        return _skills[skillId];
    }

    function getCall(uint256 callId) external view returns (CallRecord memory) {
        if (_calls[callId].callId == 0) revert CallNotFound();
        return _calls[callId];
    }

    function skillCount() external view returns (uint256) {
        return _skillCount;
    }

    function callCount() external view returns (uint256) {
        return _callCount;
    }

    /// @notice 列出所有 active skills（Orchestrator 用于发现）
    function listActiveSkills() external view returns (Skill[] memory result) {
        uint256 active;
        for (uint256 i = 1; i <= _skillCount; ++i) {
            if (_skills[i].active) ++active;
        }
        result = new Skill[](active);
        uint256 idx;
        for (uint256 i = 1; i <= _skillCount; ++i) {
            if (_skills[i].active) {
                result[idx++] = _skills[i];
            }
        }
    }
}
