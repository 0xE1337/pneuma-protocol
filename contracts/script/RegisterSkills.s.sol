// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";

/// @notice 在已部署的 SkillRegistry 上注册 demo skills —— V4 flat + V5 per-byte tier 混合
/// @dev 使用方式：
///      forge script script/RegisterSkills.s.sol \
///          --rpc-url $ARC_TESTNET_RPC_URL \
///          --private-key $DEPLOYER_PRIVATE_KEY \
///          --broadcast --legacy
///
///      Skill 1-2: V4 flat-price（向后兼容演示，证明老 skill 在 V5 合约里完全不变）
///      Skill 3-5: V5 per-byte tier（chat-short / chat-medium / chat-long），
///                 共享同一 endpoint 但 max-output / 价格各异 →
///                 caller 拿到一个"OpenAI-Playground 等价的 tier ladder"
contract RegisterSkills is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address skillRegistryAddr = vm.envAddress("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS");

        SkillRegistry registry = SkillRegistry(skillRegistryAddr);

        vm.startBroadcast(deployerPrivateKey);

        // 默认押金参数（demo 环境）：0 stake、1 小时 SLA、0 slashBps
        // 部署完成后 provider 可通过 updateSkill / 单独的 stake-deposit 流程升级到带押金 skill
        uint256 demoStake = 0;
        uint256 demoSla = 1 hours;
        uint256 demoSlashBps = 0;

        // ───────────────────────── V4 flat-price skills ─────────────────────────

        // Skill 1: Finance Oracle (mock price feed) — input 极小（symbol 字符串）
        uint256 financeId = registry.registerSkill(
            "Finance Oracle",
            "Real-time crypto price feed (mocked for demo)",
            "http://localhost:3001/api/price",
            "finance",
            2 * 1e6, // 2 USDC per call (V4 flat)
            demoStake,
            demoSla,
            demoSlashBps,
            1024,    // maxInputBytes — symbol 查询 < 1KB 足够
            2048     // maxOutputBytes — 价格 + meta < 2KB
        );
        console2.log("V4 Skill registered: Finance Oracle, id =", financeId);

        // Skill 2: Text Summarizer (DeepSeek-powered) — 文本摘要 input 较长
        uint256 textId = registry.registerSkill(
            "Text Summarizer",
            "AI-powered text summarization using DeepSeek",
            "http://localhost:3002/api/summarize",
            "text",
            5 * 1e6, // 5 USDC per call (V4 flat)
            demoStake,
            demoSla,
            demoSlashBps,
            16384,   // maxInputBytes — 16 KB ≈ 4k tokens 上限
            8192     // maxOutputBytes — 8 KB ≈ 2k tokens 摘要
        );
        console2.log("V4 Skill registered: Text Summarizer, id =", textId);

        // ───────────────────────── V5 per-byte tier skills ─────────────────────────
        //
        // 价格策略：参考 Claude Sonnet 4.5 上游（input $3/Mtok ≈ $0.003/KB 假设 4 byte/token）
        //          markup 25%（自声明，链上披露，反中转透明度抓手）
        //          → input  3_750 micro-USDC/KB
        //          → output 18_750 micro-USDC/KB
        //          baseFee 0.001 USDC = 1_000（建立连接 / 路由）
        //
        // 三档 tier 共享同一 endpoint（chat-medium 在生产里就是单一 service），
        // 仅 maxInputBytes / maxOutputBytes 不同，让 caller 在 UI 里像 OpenAI Playground 那样选档

        // Skill 3: chat-short — 1 KB in / 1 KB out → 适合短问答 / 翻译片段
        uint256 chatShortId = registry.registerSkillFull(
            SkillRegistry.RegisterParams({
                name: "chat-short",
                description: "Claude Sonnet 4.5 short-context chat (per-byte billed)",
                endpoint: "http://localhost:3003/api/chat",
                category: "text",
                pricePerCall: 0,            // V5 mode pricePerCall=0 OK
                providerStake: demoStake,
                slaTimeoutSec: demoSla,
                slashBps: demoSlashBps,
                maxInputBytes: 1024,        // 1 KB ~ 250 tokens
                maxOutputBytes: 1024,       // 1 KB ~ 250 tokens
                baseFee: 1_000,             // 0.001 USDC
                inputPricePerKB: 3_750,
                outputPricePerKB: 18_750,
                upstreamModel: "claude-sonnet-4.5",
                markupBps: 2_500            // 25% self-declared markup
            })
        );
        console2.log("V5 Skill registered: chat-short, id =", chatShortId);

        // Skill 4: chat-medium — 4 KB in / 4 KB out → 默认推荐 tier
        uint256 chatMediumId = registry.registerSkillFull(
            SkillRegistry.RegisterParams({
                name: "chat-medium",
                description: "Claude Sonnet 4.5 medium-context chat (per-byte billed) - recommended",
                endpoint: "http://localhost:3003/api/chat",
                category: "text",
                pricePerCall: 0,
                providerStake: demoStake,
                slaTimeoutSec: demoSla,
                slashBps: demoSlashBps,
                maxInputBytes: 4096,        // 4 KB ~ 1k tokens
                maxOutputBytes: 4096,
                baseFee: 1_000,
                inputPricePerKB: 3_750,
                outputPricePerKB: 18_750,
                upstreamModel: "claude-sonnet-4.5",
                markupBps: 2_500
            })
        );
        console2.log("V5 Skill registered: chat-medium, id =", chatMediumId);

        // Skill 5: chat-long — 16 KB in / 16 KB out → 长文档分析 / 代码生成
        uint256 chatLongId = registry.registerSkillFull(
            SkillRegistry.RegisterParams({
                name: "chat-long",
                description: "Claude Sonnet 4.5 long-context chat (per-byte billed)",
                endpoint: "http://localhost:3003/api/chat",
                category: "text",
                pricePerCall: 0,
                providerStake: demoStake,
                slaTimeoutSec: demoSla,
                slashBps: demoSlashBps,
                maxInputBytes: 16384,       // 16 KB ~ 4k tokens
                maxOutputBytes: 16384,
                baseFee: 1_000,
                inputPricePerKB: 3_750,
                outputPricePerKB: 18_750,
                upstreamModel: "claude-sonnet-4.5",
                markupBps: 2_500
            })
        );
        console2.log("V5 Skill registered: chat-long, id =", chatLongId);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Skills registered (V4 + V5 mixed) ===");
        console2.log("V4 Finance Oracle:     skillId =", financeId);
        console2.log("V4 Text Summarizer:    skillId =", textId);
        console2.log("V5 chat-short:         skillId =", chatShortId);
        console2.log("V5 chat-medium:        skillId =", chatMediumId, "(recommended)");
        console2.log("V5 chat-long:          skillId =", chatLongId);
    }
}
