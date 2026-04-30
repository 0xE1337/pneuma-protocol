# Pneuma — Arc Testnet Deployment Log

> Chain: **Arc Testnet** (Chain ID 5042002)
> Deploy Date: **2026-04-29**
> Version: **V6.0 (Knowledge Commons + Reputation Graph + Multi-axis Reputation)**
> Deployer: `0xadC40c12caDE96d5c47A9e986eB6557453E1d594`

---

## Deployed Contracts (8)

| 合约 | 地址 | Explorer |
|---|---|---|
| **SoulAccount** (impl) | `0xb7A7b7a57D0103DBFBCBE8d91f08E8269eA50c50` | [view](https://testnet.arcscan.app/address/0xb7A7b7a57D0103DBFBCBE8d91f08E8269eA50c50) |
| **PneumaAttestation** | `0xdCb29F9172D4BE8d26e71062b3E48C7cf528DD38` | [view](https://testnet.arcscan.app/address/0xdCb29F9172D4BE8d26e71062b3E48C7cf528DD38) |
| **SoulNFT** | `0x5b516Cdc56910C07C9b34C2d56b31422da97A959` | [view](https://testnet.arcscan.app/address/0x5b516Cdc56910C07C9b34C2d56b31422da97A959) |
| **SkillRegistry** | `0x4Ab33E9417FCb0D51ef4F9e989057BaD97587a7f` | [view](https://testnet.arcscan.app/address/0x4Ab33E9417FCb0D51ef4F9e989057BaD97587a7f) |
| **BudgetController** | `0xdCF2B4Bd90aCf81d42C163D2ce0f0e16eFcE6d8c` | [view](https://testnet.arcscan.app/address/0xdCF2B4Bd90aCf81d42C163D2ce0f0e16eFcE6d8c) |
| **PneumaTimelock** | `0x68b8790938C21950506f41Aa071705eC959C6e0B` | [view](https://testnet.arcscan.app/address/0x68b8790938C21950506f41Aa071705eC959C6e0B) |
| **PneumaCommons** (V6.0.1) | `0x201C873F3f3862e0936b026Fb618Ed06f8aA44Cb` | [view](https://testnet.arcscan.app/address/0x201C873F3f3862e0936b026Fb618Ed06f8aA44Cb) |
| **ReputationGraph** (V6.0.2) | `0x94fE0a0C2427900F9ca82875dF8f672ec2ca3330` | [view](https://testnet.arcscan.app/address/0x94fE0a0C2427900F9ca82875dF8f672ec2ca3330) |

External dependency:
| 资产 | 地址 |
|---|---|
| Arc Native USDC | `0x3600000000000000000000000000000000000000` |
| ERC-6551 Registry | `0x000000006551c19487814612e58FE06813775758` |

---

## Inter-contract Wiring (5 grants)

```
SkillRegistry        → has ATTESTER_ROLE on PneumaAttestation
SoulNFT              → has BOUNDARY_ATTESTER_ROLE on PneumaAttestation
PneumaAttestation    → knows SkillRegistry (revoke→slash hook)
SkillRegistry        → has SPENDER_ROLE on BudgetController
SkillRegistry        → has SLASH_HOOK_ROLE on ReputationGraph (V6.0.2)
SkillRegistry        → knows ReputationGraph (slash linkage)
```

链上验证：
```bash
$ cast call $SKILL_REGISTRY "reputationGraph()(address)" --rpc-url $RPC
0x94fE0a0C2427900F9ca82875dF8f672ec2ca3330  ✓
```

---

## Seeded State

### SoulNFT
```bash
$ cast call $SOUL_NFT "totalMinted()(uint256)" --rpc-url $RPC
2
```
- **Token ID 1** — "Pneuma Demo Agent" (deployer `0xadC40c...`)
  - TBA: `0xc922E4Ec9Efc974b47Fb24F6BB146cDfB8003f52`
- **Token ID 2** — "Provider Demo Bot" (TEST_SELLER `0xF31301...`)
  - 通过 E2E smoke test 创建（验证 publicMint 工作）

### PneumaCommons
```bash
$ cast call $COMMONS "publicationCount()(uint256)"
3
$ cast call $COMMONS "totalCitations()(uint256)"
1
```
- Pub #1 (article)：Agent Economics: From Rental to Society
- Pub #2 (prompt)：Code Review Prompt v3 (Solidity-focused)
- Pub #3 (case-study)：V5 Per-Byte Refund Pricing — Design Notes
- Citation #1：Pub #2 → Pub #3

### SkillRegistry
```bash
$ cast call $SKILL_REGISTRY "skillCount()(uint256)"
5
```
- #1 V4 Finance Oracle (2 USDC/call)
- #2 V4 Text Summarizer (5 USDC/call)
- #3 V5 chat-short (≤1KB / per-byte)
- #4 V5 chat-medium (≤4KB / per-byte) — recommended for demo
- #5 V5 chat-long (≤16KB / per-byte)

### ReputationGraph
```bash
$ cast call $GRAPH "endorsementCount()(uint256)"
1
$ cast call $GRAPH "totalActiveStakeTo(address)(uint256)" $DEPLOYER
1000000  # = 1.00 USDC
```
- **Endorsement #1**：TEST_SELLER (`0xF31301...`) → DEPLOYER (`0xadC40c...`)，1 USDC stake
  - context: "E2E smoke: Bob backs Pneuma Demo Agent"
  - tx: `0x9eb7f1fe5d87b745da6e867a5c653e735c91b42d1cf1cb89590e13f30ce212e7`
  - **效果**：Skills #1-5 卡片现在都显示 `🛡️ Backed by 1 agent · 1.00 USDC staked`

> 这条 endorsement 既是 E2E smoke 验证（证明 endorse 流程链上工作），也是 demo 预填数据。
> Demo 现场可让评委看到现有徽章 + LIVE 创建第二条更大额担保。

---

## Gas Consumption

| 步骤 | 估算 USDC |
|---|---|
| Deploy 8 contracts + wiring | ~0.32 |
| Register 5 skills | ~0.058 |
| Seed (mint Soul + 3 pubs + 1 citation) | ~0.025 |
| **总计 demo prep cost** | **~0.40 USDC** |

---

## Frontend Config

`apps/hub/.env.local` 已更新到 V6.0 地址：

```bash
NEXT_PUBLIC_SOUL_ACCOUNT_IMPL=0xb7A7b7a57D0103DBFBCBE8d91f08E8269eA50c50
NEXT_PUBLIC_SOUL_NFT_ADDRESS=0x5b516Cdc56910C07C9b34C2d56b31422da97A959
NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS=0xdCb29F9172D4BE8d26e71062b3E48C7cf528DD38
NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS=0xdCF2B4Bd90aCf81d42C163D2ce0f0e16eFcE6d8c
NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS=0x4Ab33E9417FCb0D51ef4F9e989057BaD97587a7f
NEXT_PUBLIC_PNEUMA_TIMELOCK_ADDRESS=0x68b8790938C21950506f41Aa071705eC959C6e0B
NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS=0x201C873F3f3862e0936b026Fb618Ed06f8aA44Cb
NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS=0x94fE0a0C2427900F9ca82875dF8f672ec2ca3330
```

启动：`cd apps/hub && pnpm dev`

---

## Post-deployment Verification Checklist

- [x] 8 contracts onchain，地址匹配
- [x] 5 inter-contract role wiring 全部成功
- [x] 5 skills registered (V4 + V5 混合)
- [x] 2 Souls minted (deployer #1 + TEST_SELLER #2)
- [x] 3 publications + 1 citation seeded
- [x] **1 active endorsement on chain** (E2E smoke: TEST_SELLER → deployer, 1 USDC)
- [x] SkillRegistry.reputationGraph 配置指向 V6.0.2 合约
- [x] apps/hub/.env.local 同步
- [x] Demo data ready for 5-min walkthrough
- [x] **E2E smoke test passed** —— mint Soul + approve USDC + endorse 三段链上行为全 success

---

## 下一步（演示当天）

1. `cd apps/hub && pnpm dev` 启动前端
2. 准备 2 个 MetaMask 钱包（Provider + Caller），各自 mint Soul + 持有 USDC
3. 按 `docs/DEMO_SCRIPT.md` 走 5 分钟流程
4. 现场创建：第 4 条 publication + 1 个 citation + 1 个 endorsement → BackedByBadge 出现 + 雷达图维度更新
