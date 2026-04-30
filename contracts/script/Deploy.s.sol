// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {SoulNFT} from "../src/SoulNFT.sol";
import {SoulAccount} from "../src/SoulAccount.sol";
import {PneumaAttestation} from "../src/PneumaAttestation.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {PneumaTimelock} from "../src/PneumaTimelock.sol";
import {BudgetController} from "../src/BudgetController.sol";
import {PneumaCommons} from "../src/PneumaCommons.sol";
import {ReputationGraph} from "../src/ReputationGraph.sol";
import {PneumaCourt} from "../src/PneumaCourt.sol";

/// @notice Pneuma 主部署脚本
/// @dev 使用方式：
///      forge script script/Deploy.s.sol \
///          --rpc-url $ARC_TESTNET_RPC_URL \
///          --private-key $DEPLOYER_PRIVATE_KEY \
///          --broadcast
///
///      默认目标：Arc Testnet（chain id 5042002）
///      其他链请改 ERC6551_REGISTRY 地址（如果该链没有 canonical 部署）
contract Deploy is Script {
    /// @notice canonical ERC-6551 Registry —— 多链一致部署
    address constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== Pneuma Deploy ===");
        console2.log("Chain ID:        ", block.chainid);
        console2.log("Deployer:        ", deployer);
        console2.log("ERC-6551 Reg:    ", ERC6551_REGISTRY);
        console2.log("");

        // 1. 读 USDC 地址（Arc Testnet 真 USDC 系统合约：0x3600000000000000000000000000000000000000）
        //    本协议不发自创 stablecoin，直接对接 Arc 原生 gas + ERC-20 接口（6 decimals）
        address paymentToken = vm.envAddress("USDC_ADDRESS");
        require(paymentToken != address(0), "Deploy: USDC_ADDRESS env not set");
        console2.log("PaymentToken (USDC, external):", paymentToken);

        vm.startBroadcast(deployerPrivateKey);

        // 1b. BudgetController —— 每日 USDC 花费上限（opt-in，对未配置 TBA 默认无限额）
        BudgetController budgetController = new BudgetController(deployer);
        console2.log("BudgetController: ", address(budgetController));

        // 2. SoulAccount implementation
        SoulAccount accountImpl = new SoulAccount();
        console2.log("SoulAccount:     ", address(accountImpl));

        // 3. PneumaAttestation —— 部署顺序提前到 SoulNFT 之前，因为 SoulNFT 构造函数依赖它（boundary hook）
        PneumaAttestation attestation = new PneumaAttestation(deployer);
        console2.log("PneumaAttest:    ", address(attestation));

        // 4. SoulNFT —— 构造函数注入 attestation 地址，启用 transfer hook 写 ownership boundary
        SoulNFT soulNFT = new SoulNFT(ERC6551_REGISTRY, address(accountImpl), address(attestation));
        console2.log("SoulNFT:         ", address(soulNFT));

        // 5. SkillRegistry
        SkillRegistry skillRegistry = new SkillRegistry(paymentToken, address(attestation), deployer);
        console2.log("SkillRegistry:   ", address(skillRegistry));

        // 6a. 反向授权：SkillRegistry 持 ATTESTER_ROLE（写正常评分）
        attestation.grantRole(attestation.ATTESTER_ROLE(), address(skillRegistry));
        console2.log("");
        console2.log("Wired SkillRegistry -> PneumaAttestation (ATTESTER_ROLE)");

        // 6b. 反向授权：SoulNFT 持 BOUNDARY_ATTESTER_ROLE（transfer 时写 SYSTEM-rater boundary）
        attestation.grantRole(attestation.BOUNDARY_ATTESTER_ROLE(), address(soulNFT));
        console2.log("Wired SoulNFT      -> PneumaAttestation (BOUNDARY_ATTESTER_ROLE)");

        // 6c. revoke→slash 联动：把 SkillRegistry 地址注入 PneumaAttestation
        //     这样 attestation.revoke(uid) 能反向触发 SkillRegistry.slashOnRevoke(callId)
        attestation.setSkillRegistry(address(skillRegistry));
        console2.log("Wired PneumaAttestation -> SkillRegistry (revoke->slash hook)");

        // 6d. BudgetController 联动：SkillRegistry 在 escrow 前调 tryRecordSpend
        //     - SkillRegistry 持 SPENDER_ROLE 才能写 budget 状态
        //     - SkillRegistry 知道 BudgetController 地址才能调用
        budgetController.grantSpender(address(skillRegistry));
        skillRegistry.setBudgetController(address(budgetController));
        console2.log("Wired SkillRegistry <-> BudgetController (per-day spending cap)");

        // 7. PneumaTimelock (governor 操作的 2-day 延迟包装层)
        //    Hackathon 阶段：部署但不立刻把 GOVERNOR_ROLE 转给它（保留 deployer 紧急控制）
        //    Roadmap 阶段：通过 SkillRegistry.grantRole(GOVERNOR_ROLE, timelock) 把治理移交
        PneumaTimelock timelock = new PneumaTimelock(deployer);
        console2.log("PneumaTimelock:  ", address(timelock));

        // 8. PneumaCommons (V6.0.1) —— 知识公地：Soul 持有者免费发布 + 引用图
        //    依赖 SoulNFT 检查发布者持 Soul（balanceOf > 0），不依赖 SkillRegistry
        //    跟其他合约解耦，可独立升级
        PneumaCommons commons = new PneumaCommons(address(soulNFT), deployer);
        console2.log("PneumaCommons:   ", address(commons));

        // 9. ReputationGraph (V6.0.2) —— 担保图：endorser 锁 USDC + 连带责任
        //    依赖 USDC + SoulNFT；跟 SkillRegistry 通过 SLASH_HOOK_ROLE 单向联动
        ReputationGraph repGraph = new ReputationGraph(paymentToken, address(soulNFT), deployer);
        console2.log("ReputationGraph: ", address(repGraph));

        // 9a. 反向授权：SkillRegistry 持 ReputationGraph.SLASH_HOOK_ROLE
        //     → SkillRegistry slash 时可触发 graph 联动 slash 担保人
        repGraph.grantSlashHook(address(skillRegistry));
        // 9b. 配置：SkillRegistry 知道 ReputationGraph 地址才能调用
        skillRegistry.setReputationGraph(address(repGraph));
        console2.log("Wired SkillRegistry <-> ReputationGraph (slash linkage)");

        // 10. PneumaCourt (V6.1) —— 多陪审员法庭：升级 revoke→slash 到社区共投决
        //     依赖 SkillRegistry (查 call) + SoulNFT (juror 资格)
        //     guilty 判决触发 SkillRegistry.slashOnCourtRuling → 联动 ReputationGraph
        PneumaCourt court = new PneumaCourt(address(skillRegistry), address(soulNFT), deployer);
        console2.log("PneumaCourt:     ", address(court));
        // 10a. SkillRegistry 知道 court 地址（防匿名 EOA 触发 slashOnCourtRuling）
        skillRegistry.setPneumaCourt(address(court));
        console2.log("Wired SkillRegistry <- PneumaCourt (court ruling slash hook)");

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deploy Complete ===");
        console2.log("");
        console2.log("Copy these into .env.local:");
        console2.log("");
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=", paymentToken);
        console2.log("NEXT_PUBLIC_SOUL_ACCOUNT_IMPL=", address(accountImpl));
        console2.log("NEXT_PUBLIC_SOUL_NFT_ADDRESS=", address(soulNFT));
        console2.log("NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS=", address(attestation));
        console2.log("NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS=", address(budgetController));
        console2.log("NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS=", address(skillRegistry));
        console2.log("NEXT_PUBLIC_PNEUMA_TIMELOCK_ADDRESS=", address(timelock));
        console2.log("NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS=", address(commons));
        console2.log("NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS=", address(repGraph));
        console2.log("NEXT_PUBLIC_PNEUMA_COURT_ADDRESS=", address(court));
    }
}
