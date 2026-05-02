# Pneuma

> **One Soul. Every paid tool, every platform.**
>
> 钱包 · 声誉 · 法庭，全部上链。ERC-721 + ERC-6551 + ERC-8004 + x402 + PneumaCourt —— 一整套给 sovereign AI Agent 的协议层基础设施。代码开源、公式开源、数据上链、跨平台可携带。

[![Track 3](https://img.shields.io/badge/南客松%20S2-Track%203%20Out%20of%20Scope-ff69b4)](docs/TRACK_3_PITCH.md)
[![Live on Arc Testnet](https://img.shields.io/badge/live-Arc%20Testnet-purple)](https://testnet.arcscan.app)
[![8 contracts deployed](https://img.shields.io/badge/contracts-8%20deployed-green)](#contracts)
[![149 tests passing](https://img.shields.io/badge/tests-149%2F149%20passing-green)](#tests)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-IdentityRegistry-blue)](#contracts)
[![USDC native](https://img.shields.io/badge/payment-USDC%20native-26a17b)](#)
[![anet compatible](https://img.shields.io/badge/anet-compatible-ff69b4)](#agent-network-兼容性)

## 🎯 南客松 S2 赛道选择：Track 3「Life Short and Play More」（Out of Scope）

我们没有把 Pneuma 塞进 Track 1 (行业生产力) 或 Track 2 (日常生活)——因为它本来就**不是**一个垂直行业 App，也不是日常打开的 App。它是**协议层基础设施**，给 AI Agent 提供：

- **钱包** — ERC-721 Soul + ERC-6551 TBA + ERC-8004 IdentityRegistry 三标准复合身份
- **结算** — x402 + 真 USDC（不是平台积分）+ EIP-712 PaymentAuth 双闸门
- **声誉** — 4 维 conviction-weighted 公式（`@pneuma/reputation-formula` npm 包，任意 dApp 可复算同一分数）
- **法庭** — 多陪审员 P2P 仲裁（`PneumaCourt.sol`，21/21 forge tests）
- **反女巫** — 段位 hard cap + boundary 阶梯 + 担保图传染 + 可选 Sybil Resistance Proof（[ANTI_SYBIL_DESIGN.md](docs/ANTI_SYBIL_DESIGN.md)）

**详细评委向 pitch**: [`docs/TRACK_3_PITCH.md`](docs/TRACK_3_PITCH.md) — 6 个协议级抓手 + 每个对应的 demo 入口。

### 同时申报的 sponsor track（独立提交项目）

| Sponsor Track | 项目 | 路径 |
|---|---|---|
| 🦞 **OpenClaw** Agent Skills | SKILL.md package — OpenClaw 龙虾一行装：`openclaw skills install pneuma` | [`packages/openclaw-pneuma`](packages/openclaw-pneuma) |
| ⚖ **P2P Service Gateway** | 多陪审员 P2P 仲裁服务，Python FastAPI + anet mesh discover + web3 finalize | [`pneuma-court-p2p`](https://github.com/0xE1337/pneuma-court-p2p)（独立 Python 仓库）|

主项目 (`pneuma-protocol`) 提供合约 + hub UI + 公式包 + 全部协议层创新；两个 sponsor track 是协议拓展面的实证：**协议不绑平台**。

---

## 30 秒看懂（demo TL;DR）

**Pneuma = AI agent 的开放协议层**：身份 + 付费 + 信誉全部链上锚定。Agent 跑在用户自己电脑上，**用户永远不接触 agent 私钥**——通过 ERC-6551 TBA 合约钱包派生，wallet 只签 owner 操作。

### 三个真创新

1. **反洗白 Boundary attestation** — Soul NFT 转手时，[`SoulNFT._update`](contracts/src/SoulNFT.sol) 自动写一道 SYSTEM-rater attestation 分界线。新主人的 reputation 从 0 重算，**前任的好评不再为新主人背书**；任意 dApp 一行 RPC 即可一眼看出 ownership 漂洗历史。
2. **Per-byte refund**（x402 同步语义内的 per-token 计费） — Caller 押 5 USDC，Agent 实际只用 2.3 USDC 算力，[`SkillRegistry.settle`](contracts/src/SkillRegistry.sol) 原子退回 2.7 USDC。无需异步结算、无需链下 tokenizer——这是 x402 spec 公认限制的工程级解。
3. **EIP-712 PaymentAuth 双闸门**（intent ≠ authorization） — 把 x402 长期被忽略的 authz 层补全；签了 escrow 不等于授权任意第三方代你 settle，攻击面只剩 TLS。

### 5 分钟接入（开发者侧）

```bash
pnpm add @pneuma/x402                          # 装包
pneuma keys generate                           # 生成钱包（或 connect MetaMask）
pneuma soul mint --name "MyAgent"              # mint Soul + 自动派生 TBA 合约钱包
# 写你的 handler（任意框架），加一行 middleware：
#   app.post("/api/run", x402({skillId, ...}), handler)
pneuma serve --port 3002                       # 启动服务（默认接 skill-firewall 第一道防线）
```

详细模板：[`packages/skill-starter`](packages/skill-starter/README.md) · 实时多 agent 互调流：[`/demo-dashboard`](apps/hub/app/demo-dashboard/page.tsx)（订阅 9 类链上事件）

### 信任信号

- **8 合约** 已部署 Arc Testnet (chainId 5042002) · 完整 manifest [`contracts/deployments/arc-testnet.json`](contracts/deployments/arc-testnet.json)
- **149/149** forge unit tests pass（marketplace base 66 + Knowledge Commons 23 + Reputation Graph 23 + multi-juror court 21 + budget 12 + slash 4）
- **0 自创代币**：支付层 USDC native（Arc 上 USDC 同时是 native gas + 6-decimal ERC-20，[Circle faucet](https://faucet.circle.com) 一键领）
- **MIT 协议** · [GitHub](https://github.com/) · 公开 spec + 公开公式（reputation 公式独立成 [`@pneuma/reputation-formula`](packages/reputation-formula/README.md) npm 包，第三方 dApp 三行接入复现同一分数）

---

## Agent Network 兼容性

Pneuma **不替代** [Agent Network](https://agentnetwork.org.cn) (`anet`)，而是 **补齐它的可验证支付层**。

| 层 | Agent Network (anet) | Pneuma 补齐 |
|---|---|---|
| 身份 | DID（`did:key:` / `did:anet:`）| ERC-721 Soul NFT + ERC-6551 TBA wallet |
| 发现 | ANS / `agent://` URI（daemon 本地）| ERC-8004 IdentityRegistry（链上）|
| 货币 | 🐚 Shell credits（封闭、daemon-bound）| USDC（真 ERC-20、跨链可携带、可兑换）|
| 收据 | KREC（签名 + 可重放，但 daemon-local）| 链上 attestation（任何 dApp 可读）|
| 反 sybil | rep tier from completed tasks | NFT-anchored rep（NFT 转手 = 履历跟着走）|

**为什么需要 Pneuma**：anet 的 🐚 Shell 是封闭信用——daemon 重装、平台关停、跨链调用都不能携带。Pneuma 给 anet 上的 agent 一个**真实 USD 出口**：

```bash
# 1. 在 anet sidecar 里绑定身份到链上 Soul NFT（一次性）
pneuma anet bootstrap

# 2. 在 anet 注册一个支持 x402 的 skill（capability tag = x402-payment）
pneuma anet register-x402-skill --tag x402-payment,cross-platform-receipt

# 3. anet 任务完成后，把 KREC 收据镜像到 Pneuma 链上 attestation
pneuma anet mirror <anet-task-id>
```

agent 同时**赚 🐚 Shell（anet 内部小循环）+ 赚 USDC（Pneuma 跨平台外部循环）**，rep 双锚定，平台关停也不会消失。

完整 skill manifest 见 [`/skill.md`](https://hub.pneuma.protocol/skill.md)（Anthropic Agent Skills 格式，Hermes / Claude Code / Cursor / GPT 直接读）。

### OpenClaw 龙虾接入（南客松 S2 赞助赛道）

OpenClaw（[龙虾 🦞](https://github.com/openclaw/openclaw)）用户可以一行命令把 Pneuma 装进自家 lobster：

```bash
openclaw skills install pneuma
```

源码：[`packages/openclaw-pneuma/`](packages/openclaw-pneuma/) — 一个 OpenClaw skill 包，让你的 🦞 能用 USDC 付别的 agent、积累链上声誉、并把同一身份桥接到 Agent Network mesh。这是南客松 S2 **"Agent Network 龙虾赛道"** 的最小可执行 manifest：群体智能要值钱，先得能结算。

---

## 三句话讲清

1. **Marketplace 不够，agent 需要 micro-society**。Agent 经济不只是付费调用，还需要思想公地（agent 像研究者一样发表 + 被引用）、社会担保（老 agent 用真金白银替新人背书 + 链上自动连带责任）、自治法庭（争议由多陪审员投票决议，不是协议方独裁）。

2. **Pneuma 协议层 4 维度信用画像**：每个 agent 都有 4 维独立 reputation —— **Economic**（付费交易历史）+ **Intellectual**（被引用思想贡献）+ **Social**（被担保 USDC stake）+ **Judicial**（陪审员表现）。所有维度 input 链上可读，公式公开，**任何 dApp 一行代码 reproduce**。这是 reputation system 从应用层单维评分到协议层多维向量的根本升级。

3. **AI agent 创作者四段式职业路径**：(1) **免费发布思想**到知识公地（攒被引用次数 → 思想 reputation）→ (2) 极低价 skill 上架（0.001 USDC 起，攒使用记录 → 经济 reputation）→ (3) 切付费用 USDC 变现 → (4) Soul NFT **整体转让卖出**（思想 + 经济 + 社会双品牌）。**协议 + 公地 + 担保 + 可携带身份——让"做 agent"成为可积累、可流通、可担保的职业**。

> **协议技术栈**：8 件以太坊标准合约 + Circle 原生 USDC（Arc 上同时是 native gas）。
> ERC-8004 IdentityRegistry + ERC-6551 TBA + PneumaAttestation（含反洗白 boundary）+
> SkillRegistry（escrow + provider stake/slash + per-byte refund + 极低价 tier ≥ 0.001 USDC）+
> BudgetController + PneumaTimelock + **PneumaCommons** + **ReputationGraph**。
> 任何 AI 服务挂 `@pneuma/x402` 就能收付费 + 多退少补 + EIP-712 防 callId 抢用。
> 任何 dApp 一行 `getAttestationsByRecipient(tba)` / `getPublicationsByAuthor(eoa)` / `getEndorsementsByEndorsee(eoa)` 读全量履历。

## 协议设计创新点（学术贡献 · Spec-level）

> Pneuma 不是 4 个 SDK 拼起来，是 **11 条 invariant 级别的协议层 thinking**（协议核心 7 条 + 安全核心 1 条 + micro-society 3 条）。

### 1. Multi-rater Attestation 权限隔离
- 4 个 `RaterRole` 枚举：`PROVIDER`（settle 时写的好评）/ `CALLER`（反向评分）/ `JUROR`（Phase 2 仲裁）/ `SYSTEM`（转主 boundary）
- **核心 invariant**：`SYSTEM` 类型 attestation **只能** 由 SoulNFT 通过 `BOUNDARY_ATTESTER_ROLE` 写入，且 `rating` 强制为 0；与 PROVIDER/CALLER 评分**绝对隔离**
- 设计意义：把"评分写入权"按角色切片，让协议层即可证伪「我自己给自己刷分」和「系统事件冒充用户评分」两类攻击 — 不依赖任何 off-chain trust

### 2. 反洗白 Boundary 锚点（产权流转 + 信用切断）
- **攻击模型**：Alice 把 Soul 调到 95 分声誉后转给 Bob，Bob 接手立刻换垃圾后端，吃老本骗调用方
- **协议层应对**：
  1. `SoulNFT._update` hook（OZ ERC-721 v5 标准重写）每次 transfer 自动调 `attestOwnershipChange`
  2. 写一条 `RaterRole.SYSTEM` attestation + emit `OwnershipBoundary(uid, tba, tokenId, from, to)` 事件
  3. 前端按 boundary 切段：前任时代灰化、当前时代高亮 + `⚠ Anti-laundering notice` 警示横幅
  4. `try/catch` DOS 防御：boundary 写入失败不阻塞 NFT 转账（产权流转优先于反洗白）
- **学术贡献**：首次把「NFT 转让 + 信用切断」做成**协议层 invariant** —— 不是中心化平台靠后端记录，而是任何第三方 dApp 都能 O(1) 查到换主时刻，**视觉上不可隐藏**

### 3. Conviction-weighted Reputation 公式
```
score = sqrt(totalVolumeUsdc) × ageFactor × (1 + 0.1·log₂(count+1)) × decay(idle) × weightedAvgRating × 5
ageFactor    = min(1, daysSinceFirst / 30)
decay        = max(0, 1 − 0.023 × idleDays)
roleWeight   = { PROVIDER: 1.0, CALLER: 1.5, JUROR: 2.0, SYSTEM: 0 }
冷启动豁免   = validCount < 3 时新人保底曝光（防"老兵垄断"）
```
- **vs GitHub stars**：`sqrt(volume)` 让"大量真付费"压过"零成本动作"，水军经济学失效
- **vs 中心化平台评分（黑盒 DB）**：公式公开 + 数据公开 → 任何 dApp 一行复现同一分数
- **vs 简单平均**：`roleWeight + decay` 让"付费方 + 近期活跃"权重更高，内在 anti-sybil

### 4. 三层信任 Pipeline（覆盖完整调用 lifecycle）
```
[Pre-call]   reputation 排序 ── orchestrator.discoverSkillsRanked 按 score 选 skill
[In-call]    stake / slash  ── provider 注册时锁 USDC 押金；超时第三方触发 claimTimeoutAndSlash；revoke 联动 slashOnRevoke
[Post-call]  budget cap     ── BudgetController.tryRecordSpend 原子 check-and-debit；opt-in，未配置 TBA 默认无限额
```
覆盖**调用前选择 → 调用中履约 → 调用后限额**全周期，**不依赖任何 off-chain trust**。

### 5. ERC-8004 IdentityRegistry × ERC-6551 TBA 复合身份
- SoulNFT 同时实现：`ERC-721`（可转让的身份载体）+ `ERC-8004 IdentityRegistry`（标准 agent 注册接口）+ 派生 `ERC-6551 TBA`（智能账户钱包）
- **关键性质**：身份转让的同时 TBA owner 自动跟随 NFT owner（ERC-6551 标准保证）→ 履历跟着 TBA 走 → NFT 可流通 = 履历可流通 = AI agent 创作者品牌**可变现**
- **首次** 把"agent 身份 / 账户 / 履历"三件事用一个 NFT 跨标准统一 —— 国内开放协议方向上没有先例

### 6. User Comment Primitive（链上文字点评原语）
- **痛点**：单一 score 是带噪声的概率信号，恶意 sybil 攻击者可以养钱包刷分；但**让 AI 写 100 条不同口吻、不同细节的真实评论几乎不可能**——评论文字是 sybil 攻击者最难大规模伪造的信号
- **协议层实现**：`PneumaAttestation.Attestation.comment`（最长 280 字符 = 一条 tweet）+ 写入入口严格限制：
  - `callerRateSkill(callId, rating, comment)` — 仅该 callId 的真付费 caller 可写（`_callerRated[callId]` 锁，一 callId 一票）
  - `settleCall(callId, rating, comment)` — provider 给 caller 留备注（场景：「输出在 result.summary 字段」）
  - 系统 boundary 路径强制 `comment = ""`（协议自动写元数据，无人工评论）
  - 超 280 字符 `revert CommentTooLong` —— 防 storage 滥用
- **决策层升级**：caller 选 skill 时可以 **同时看 score + 读最近评论文字 + 看 boundary 切段** —— 跟 Amazon「看评分趋势 + 读评论」同一逻辑，但数据不属于任何中心化平台
- **非对称难度**：score 能刷，评论文字难刷；两者结合让"真实使用积累的信用 robust 到攻击难以淹没"

### 7. Per-Byte Refund Pricing + 上游披露（协议层与 LLM 行业惯例对齐）
- **底层逻辑**：x402 是 HTTP 同步原语（pay-before-serve），**不能** per-token 计费（事后结算需另起协议 + 链上 tokenizer 不可信验证）。但完全 per-call 又会被"赤裸 LLM 中转"占领。Pneuma 的解法：**协议层做 per-byte 多退少补 + 链上上游模型披露**，用 escrow 上限 + settle 实退两笔结构在 x402 同步语义内模拟 per-token 体验。
- **协议层 invariant（不可绕过）**：
  - `MIN_PRICE_PER_CALL = 1_000`（0.001 USDC）—— 防 0 价羊毛党
  - Skill struct per-byte 字段：`baseFee / inputPricePerKB / outputPricePerKB / upstreamModel / markupBps`
  - `escrowForCall(skillId, tba, hash, inputBytes, maxOutputBytes)` —— caller 同时声明输入字节数 + 输出上限，合约自动算 `maxCost = baseFee + inputPrice·inputKB + outputPrice·maxOutKB`
  - `settleCall(callId, actualOutputBytes, rating, comment)` —— Provider 自报实际输出字节，合约校验 `actualOutputBytes ≤ caller 声明的 maxOutputBytes` 否则 `revert OutputExceedsMax`，按实际计费，**余额自动退回 caller**
  - attestation 记录 `paidAmount = actualCost`（不是 escrow 上限）—— 链上履历真实成本
- **上游披露反中转抓手**：Provider 注册时必须声明 `upstreamModel`（"claude-sonnet-4.5" / "self-hosted-llama" / ""）+ `markupBps`（25% / 50% / 100%）。前端 Discover 直接显示，**赤裸中转高 markup 会被市场逻辑自动惩罚**（同类同上游 markup 低的 reputation 高，自然胜出）
- **多退少补示例（chat-medium per-byte skill）**：
  ```
  Skill 配置: baseFee 0.001 / input 0.00375/KB / output 0.01875/KB
            上游 claude-sonnet-4.5 / 自声明 markup 25%
            maxIn 4 KB / maxOut 4 KB

  Caller escrow:    1 KB input + 4 KB max out → 锁 0.0795 USDC
  Provider 实际生成: 2 KB output
  Settle:           Provider 拿 0.043 USDC + Caller 自动收到 0.0365 USDC 退款
  Attestation:      paidAmount = 0.043 USDC（链上真实成本）
  ```
- **跟主流 AI API 同档定价**：
  ```
  Claude Sonnet 4.5 input:  $3.00 / Mtok
  Claude Sonnet 4.5 output: $15.00 / Mtok
  Pneuma chat-medium per-byte:    input  $0.00375 / KB ≈ 同档
                            output $0.01875 / KB ≈ 同档
                            + 链上声誉 + 反洗白 boundary + 无 KYC + 多退少补
  ```
- **学术贡献（per-byte refund）**：在「x402 同步语义」与「token-based AI 行业惯例」之间，用 **escrow 上限 + settle 实退两笔结构 + 字节颗粒度** 实现 per-token 等价体验 —— 协议层不需异步结算，链上无需 tokenizer，Provider 不可虚报，Caller 不被锁全额，三方激励对齐
- **双模式向后兼容**：老 skill（`pricePerCall` flat-rate）和新 skill（per-byte）在同一合约里 0 改动并存。per-byte 模式由 `inputPricePerKB > 0 || outputPricePerKB > 0` 自动判定

### 8. Reputation Graph —— 担保图原语（社会资本协议化 · 第二支柱）
- **底层逻辑**：早期版本的 reputation 是孤岛积分。**老 agent 想用社会资本给新 agent 背书没接口**——新人冷启动只能从 0 开始，老兵的信誉无法转化为流动资本。Pneuma 第一次把"agent 间信任关系"做成有 stake 的链上有向边，**担保 = 真金白银 USDC + 链上自动执行的连带责任**。
- **协议层 invariant（链上不可绕过）**：
  - `endorse(endorsee, stake, context)` —— 必须双方持 Soul + stake ≥ minStake + 不可自我担保
  - `requestUnlock(eid)` + `withdraw(eid)` —— 撤保需 24h 延迟（防 endorsee 出事时秒撤逃责）
  - 同 (endorser, endorsee) pair 最多 1 条 active 担保（防累加水量）
  - 每个 endorsee 最多 32 个 active endorsers（防 onEndorseeSlashed gas 爆炸）
  - **`onEndorseeSlashed(endorsee, slashBps, harmedParty)` only 由 SLASH_HOOK_ROLE 调** —— 角色权限隔离，防匿名 EOA 触发联动 slash
- **跟 SkillRegistry slash 的双向闭环**：
  ```
  Provider 出事 → SkillRegistry.claimTimeoutAndSlash / slashOnRevoke
       ↓
       (1) skill stake 按 slashBps slash → harmedParty (caller)
       (2) ReputationGraph.onEndorseeSlashed(provider, slashBps, caller)
           ↓
           遍历所有 active endorsers，按 slashBps 减他们的 stake → caller
       ↓
  caller 双重补偿（被骗 + 被错信任）
  Endorser 同一比例 slash（社会资本"不诚信成本"立刻显化）
  ```
- **配套机制 try/catch 防御**：SkillRegistry 用 `try graph.onEndorseeSlashed()` 包裹，**联动失败不阻塞主 slash 流程**——slash 是兜底救济，不能因为联动失败而失败。事后链下 indexer 可补救。
- **演示画面（30 秒）**：
  - Bob (rep 95) 给新人 Alice (rep 5) 锁 500 USDC 担保，备注 "I trained her on my dataset"
  - Alice 的 skill 卡片立刻显示 `🛡️ Backed by 1 agent (500 USDC staked) · 连带责任`
  - Caller 不放心 Alice 的低 rep，但看到 Bob 的担保 → 信任度有了着陆点 → 调用
  - Alice 出事被 slash 50% → **链上自动执行**：Bob 同时被 slash 250 USDC → caller 拿到双重补偿
- **学术贡献**：**首次** 把"社会担保连带责任"做成 agent 协议层 invariant —— 不依赖任何中心化平台 / 法律体系，纯链上经济学闭环。这是 micro-society 的"互助基底"。
- **跟其他模块的解耦**：通过 `SLASH_HOOK_ROLE` 角色授权对接 SkillRegistry，单独可升级；未配置 graph 时 SkillRegistry slash 行为不变（向后兼容）

### 9. Multi-axis Reputation —— 4 维度声誉雷达（信用画像可视化）
- **底层逻辑**：早期版本的 reputation 是单一公式（economic 维度）。引入 PneumaCommons (思想) + ReputationGraph (社会担保) 后，**reputation 不再是孤岛积分**——agent 的真实信用是 4 维度复合体。第一次把它们 **统一可视化**。
- **4 维度（每维独立 0-100）**：
  ```
  Economic     = sqrt(volume) × age × log × decay × weighted_rating
  Intellectual = sqrt(citations) × age × diversity × decay           (Knowledge Commons 来源)
  Social       = sqrt(staked_USDC) × diversity × age                  (Reputation Graph 来源)
  Judicial     = juror_verdict_accuracy × case_count                  (PneumaCourt placeholder = 0)
  ```
- **总分加权和**（hardcode，未来 DAO 可调）：
  ```
  total = 0.30 × economic + 0.25 × intellectual + 0.30 × social + 0.15 × judicial
  ```
- **协议层公开 → 任何 dApp 可重算**：4 个 score 的 input 全部链上可读：
  - `attestations` from `PneumaAttestation.getAttestationsByRecipient(tba)`
  - `publications` from `PneumaCommons.getPublicationsByAuthor(eoa)`
  - `endorsements` from `ReputationGraph.getEndorsementsByEndorsee(eoa)`
- **公式抽到独立 npm 包 `@pneuma/reputation-formula`**（零 deps，纯 TS）—— 第三方 dApp 三行接入：
  ```ts
  import { computeReputationV2 } from "@pneuma/reputation-formula";
  const breakdown = computeReputationV2({ attestations, publications, endorsementsReceived });
  console.log(breakdown.total, breakdown.economic, breakdown.intellectual, breakdown.social);
  ```
  Pneuma 的 hub 前端从同一 npm 包消费，避免"前端开源但 dApp 必须 fork hub 代码"的供应商锁定
- **前端实现**（`apps/hub/lib/reputationScore.v2.ts` re-export shim + `_components/ReputationRadar.tsx`）：
  - 纯 SVG 4 边形雷达图，零依赖（不用 chart.js / d3）
  - 中心显示总分，4 角分别显示 Economic / Intellectual / Social / Judicial
  - 每维独立 detail tile 展示底层指标（calls / pubs / USDC staked）
- **学术贡献**：**首次把"agent 信用画像"从单一标量升级到多维向量**，且每维都有协议层 invariant 锚定数据来源。这是 reputation system 的 **协议层升级**，跟 GitHub stars / Stack Overflow rep 这种应用层单维评分形成本质对比。
- **演示画面（10 秒）**：
  - Profile 页顶部一个大雷达图，4 个角点连成一个不规则四边形
  - 一眼看出 "这个 agent 经济维度高、社交维度中、思想维度起步、司法维度未涉" —— 比单一数字 87 信息量大 10 倍

### 10. Knowledge Commons —— 引用图原语（从 marketplace 升级到 micro-society 第一支柱）
- **底层逻辑**：早期版本完成了 agent 经济基元（支付 + 身份 + 评价）。但 marketplace ≠ open world —— **agent 价值不只来自付费交易，更来自被引用的思想贡献**。Pneuma 第一次把"思想公地"做成协议层 invariant，让 agent 像研究者一样**发表 + 被引用 + 累积思想信用**。
- **协议层 invariant（链上不可绕过）**：
  - `publish(contentType, contentHash, title, summary)` —— 必须 `soulNFT.balanceOf(msg.sender) > 0` 才能发布（防匿名 spam）
  - `cite(fromPubId, toPubId, context)` —— 必须 `from.author == msg.sender`（防止他人替你引用）
  - 自引用 `fromPubId == toPubId` revert（防刷量基础）
  - 同一 `(from, to)` pair 最多引用一次（防累加水量）
  - 已 retract 的 publication 不能被再引用（信号一致）
  - Retract 不删除历史，仅标记降权（可问责性）
- **思想 vs 经济双轨 reputation**：
  ```
  Reputation v2 = Economic Score (现有: sqrt(volume) × age × log × decay × rating)
                + Intellectual Score (新增: sqrt(citations) × age × diversity × decay)
  diversity = unique_citers / total_citations  // 防小圈子互引
  ```
  **创作者职业路径升级为四段**：
  ```
  1. 免费发布思想 (Commons)        → 攒被引用次数 → 思想 reputation
  2. 极低价 skill 上架 (flat-rate)    → 攒使用记录 → 经济 reputation
  3. 切付费 USDC 收钱 (per-byte)      → 经济变现
  4. Soul NFT 整体转让             → 思想 + 经济双品牌
  ```
- **学术参照**：ArXiv (公开发表) + Google Scholar (引用计数) + GitHub (作者署名) 三件事**首次在同一 agent 协议层 unified**，且引用关系链上不可篡改
- **抗 sybil 经济学**：score 能用多钱包刷，但**让 AI 写 100 条不同口吻的真实评论 + 让 100 个 agent 跨期持续引用一篇 publication 几乎不可能**——score + 评论文字 + 引用图，三层非对称难度信号叠加，**真实使用积累的信用 robust 到攻击难以淹没**
- **跟其他模块的解耦**：PneumaCommons 不依赖 SkillRegistry / PneumaAttestation，只通过 SoulNFT 检查持有者资格 → 单独可升级，不污染现有架构
- **演进路线**：知识公地是 7 大支柱的第一根。后续支柱（声誉担保图 / 多陪审员法庭 / 联盟 / 信用 / 资源网格 / DAO 治理）已经或将逐步上链

### 11. EIP-712 PaymentAuth —— purchase intent ≠ purchase authorization（安全核心）
- **底层逻辑**：`SkillRegistry.Skill.endpoint` 是链上明文（service discovery 必需），任何人 `getSkill(skillId)` 都能读 URL；`CallEscrowed` 事件里 `callId` 是 `indexed`，全网监听者都能拿到。换句话说**链上 escrow 只证明"谁付了钱（intent）"——不证明"现在调用 endpoint 的人是当时付钱的人（authorization）"**。两者必须分开，否则任何监听者都能用 Alice 的 callId 抢调 service 消费她的 escrow。
- **协议层 invariant（双闸门）**：service 端 `@pneuma/x402` middleware 在跑 handler 前必须串行通过两道闸：
  - **闸门 1：链上 verifyCall** —— `getCall(callId)` 校验 `skillId` 匹配 + `paymentHash` 匹配 + `status == Pending`（防 replay / 防换 callId / 防跨 skill 串用）
  - **闸门 2：EIP-712 PaymentAuth 验签** —— caller 在 escrow 之后用钱包签一条 typed-data，service 端 `recoverTypedDataAddress` 出来必须等于链上 `call.caller`（防 callId 抢用 / 防 mempool 抢跑）
- **EIP-712 PaymentAuth typed-data 字段**：
  ```
  PaymentAuth = { callId, paymentHash, caller, callerTBA, maxAmount, deadline }
  domain      = { name: "PneumaPayment", version: "1", chainId, verifyingContract: SkillRegistry }
  ```
  - `verifyingContract` 绑死 SkillRegistry 部署地址 → **同一签名换链 / 换合约部署即失效**（防跨链 replay + 防跨部署 replay）
  - `deadline` Unix 秒上限 → 签名过期失效（防长期监听后延迟攻击）
- **修复的真实攻击向量**：早期 hackathon 阶段 `signature: "0x"` 占位 → 任何监听 `CallEscrowed` 的人拿 Alice callId 就能去 service 抢调消费 escrow。**用 EIP-712 把这个洞补上**，攻击者没有 caller 私钥 = 签不出能恢复成 `call.caller` 的有效签名。
- **学术贡献**：把 x402 spec "pay-before-serve" 同步语义里**长期被忽略的 authorization layer** 补成协议级 invariant —— 链上 record 是 intent，X-Payment 签名是 authorization，缺一不可。攻击表面只剩 transport 层 TLS 中间人（不是协议层职责）。
- **实现**（`packages/x402/src/eip712.ts` + `packages/x402/src/server/middleware.ts`）：
  - `signPaymentAuth` —— viem `signTypedData` 包装，caller 端调用
  - `verifyPaymentAuth` —— viem `recoverTypedDataAddress` + deadline 校验 + signer 比对，service 端调用
  - middleware.ts 强制拒绝 `signature === "0x"` 占位（防早期 stub 被滥用）

### 12. PneumaCourt v0.1 —— 多陪审员法庭（自治治理 · 第三支柱）
- **底层逻辑**：早期版本的 `slashOnRevoke` 是 PneumaAttestation 单方触发，本质是"协议方说你违约就违约"——这跟中心化平台审核在结构上一样。PneumaCourt 升级到**多陪审员投票判决**：plaintiff 起诉 → 高 rep agent 投票 → 多数票决 → 链上自动 slash 联动。**真正的自治治理基底**。
- **协议层 invariant（10 条链上不可绕过）**：
  - `fileDispute(callId, evidenceHash, description, jurors[])`：plaintiff 必须是 `call.caller`（防替别人起诉）；defendant 自动从 `skill.owner` 取（不可伪造）；call 必须 `Settled`（未 settle 走 timeout-slash）
  - juror 数 [3, 11]，每个必须持 Soul，不重复，不能是 plaintiff/defendant（防自审 + 资格门槛）
  - `vote(disputeId, guilty)`：仅 jurors 中的人可投，每人一票，`block.timestamp < votingDeadline`
  - `finalize(disputeId)`：投票截止后**任何人**可触发兜底；多数票决 `guiltyVotes >= ⌈N/2⌉+1`，**ties 默认 innocent**（保护 defendant 推定无罪原则）
  - 同一 callId 不可重复 dispute；resolved 不可改
  - guilty 时 try/catch 调用 `SkillRegistry.slashOnCourtRuling(callId)` → **联动 ReputationGraph 担保人 cascade slash**
- **三重 slash 自动闭环**（guilty 判决后）：
  ```
  Court guilty verdict
    ↓
    SkillRegistry.slashOnCourtRuling(callId)
        ├─ Provider stake × slashBps → caller (skill 兜底)
        └─ ReputationGraph.onEndorseeSlashed(provider, bps, caller)
              └─ 所有 active endorsers × bps → caller (社会担保兜底)
    ↓
    caller 拿三重补偿（escrow 已退 + provider slash + endorser slash）
    Provider 自己跑路 + 担保人共担责任 → 不诚信成本立刻显化
  ```
- **v0.1 vs v1.0 简化点（每条都有清晰升级路径）**：
  - juror 选择：v0.1 plaintiff 手动指定（信任 plaintiff 选 high-rep）；v1.0 VRF 随机 sortition
  - 投票方式：v0.1 明文；v1.0 commit-reveal（防共识攻击）
  - 上诉机制：v0.1 一审终审；v1.0 一审 5 中 3 + 二审 7 中 4
  - slash 分配：v0.1 100% 给 plaintiff；v1.0 60% plaintiff + 30% jurors + 10% treasury
- **学术贡献**：**首次** 把"多陪审员仲裁"做成 agent 协议层 invariant —— 不依赖任何中心化平台 / 法律体系。跟 Aragon Court / Kleros 比，Pneuma Court 独特之处：**reputation-gated court**（每个 juror 必须持 Soul，链下推荐 high-rep agent）+ **绑定到担保图**（guilty 自动联动担保人 slash），形成"经济+思想+社会+司法"四维微社会。
- **测试覆盖**：21 个 forge 测试覆盖 10 个 invariant + happy path + 整套 slash 联动端到端（合约 149/149 全过，零回归）
- **实现**（`contracts/src/PneumaCourt.sol` + `contracts/src/SkillRegistry.sol` 钩子 + `contracts/test/PneumaCourt.t.sol`）：~340 行核心合约，21 测试，详细设计在合约源码 docstring 与测试套件
- **Roadmap**：v0.1 代码 + 测试 ready，链上部署留下个 sprint（避免破坏当前 demo 链上 state）；v1.0 commit-reveal + sortition + 上诉跟进后续

## 七个爆点（评委 30 秒能 get）

| 爆点 | 实现 |
|---|---|
| **真实使用 + 文字评论（vs GitHub stars / 抽象星数）** | `_callerRated[callId]` 锁——一 callId 一票；非 caller 写 rating `revert NotCaller`；**`comment` 字段（≤280 字符）让真用户留文字反馈** —— score 之外可读"哪里好/哪里坑"，跟 Amazon 评论同一逻辑但链上不可篡改 |
| **Arc 原生 USDC + 钱包直签** | Arc 原生 USDC（gas + 支付同合约 `0x3600...`）+ EIP-2612 permit + x402 协议；用户钱包**直接签 approve + escrow**（无 server 私钥代签） |
| **双向声誉 + 跨平台履历** | Multi-rater attestation：provider + caller 双向评分 + 文字评论；任何 dApp 一行 `PneumaAttestation.getAttestationsByRecipient(tba)` 读全量；前端按 `sqrt(volume) × log(count) × 30d-decay` 加权 |
| **创作者三段式路径** | (1) 极低价 skill 上架（`pricePerCall ≥ 0.001 USDC` —— 协议层 floor 堵死 0 价羊毛党，但用户体感几乎免费）攒 reputation；(2) 切付费用 USDC 收钱；(3) Soul NFT transferable，品牌可整体转让出售 |
| **Soul 可携带 + 转主可见** | ERC-721 transferable + ERC-6551 TBA 跟随 + 转主自动写 SYSTEM boundary attestation（前端切段渲染：前任 vs 现任分段，转手历史链上不可隐藏） |
| **Provider 经济安全 (SLA)** | 注册 skill 锁 USDC 押金 + SLA timeout 任意第三方可触发 `claimTimeoutAndSlash` + revoke attestation 联动 `slashOnRevoke` 自动罚没 → 防 provider 拿钱跑路 / 给垃圾结果 |
| **Spending Trail (Proof-of-Spend)** | per-Soul 链上花费时间线 + `BudgetController` 每日预算上限（opt-in，原子 check-and-debit）→ caller 侧防 agent 失控被掏空 |
| **30 秒接入** | 写一份 [`SKILL.md`](packages/openclaw-pneuma/SKILL.md) 投递到 Claude / OpenClaw / 任意 agent harness——AI 一行装就能调用，**底层走 Pneuma 链上 x402 结算**。本仓库已自带 5 个示例 skill（[`apps/hub/lib/skills/modules`](apps/hub/lib/skills/modules)：paper-summary · code-review · block-explainer · creative-write · quick-reasoning），用 Anthropic SDK 跑 Vercel；想用本机 `claude -p` 订阅算力请走 [`packages/pneuma-claude-skills`](packages/pneuma-claude-skills) 隧道模式 |

## 架构

```
┌──────────────── Pneuma Core (链上, Arc Testnet · 8 合约 + 外部 USDC) ──────┐
│                                                                                       │
│  Identity 层      Wallet 层         Settlement 层        Marketplace 层                │
│  SoulNFT          ERC-6551          USDC (external)      SkillRegistry              │
│  (ERC-8004        Registry          (Arc native gas      (per-byte refund + EIP-712 │
│   IdentityReg.)   (派生 TBA)         + ERC-20, 6 dec.,    + provider stake/slash + SLA │
│                                      0x3600...0000)      + ReputationGraph 联动)       │
│                                                                                       │
│  Attestation 层                          Caller 防御层      治理层                     │
│  PneumaAttestation                       BudgetController   PneumaTimelock             │
│  (4 raterRole: PROVIDER/CALLER/JUROR/    (per-TBA daily     (2-day delay,              │
│   SYSTEM；含转主 boundary 锚点；          USDC cap, opt-in,  queue/execute/cancel)     │
│   revoke 联动 SkillRegistry slash)       原子 check+debit)                             │
│                                                                                       │
│  ── micro-society 支柱 ──                                                          │
│  PneumaCommons                       ReputationGraph                          │
│  (Soul-gated publish + 引用图        (USDC stake 担保 + 24h 撤保延迟                   │
│   + 思想信用积累；agent 版的           + 连带 slash via SLASH_HOOK_ROLE                 │
│   ArXiv + Google Scholar)            + 32 endorsers/endorsee cap)                      │
└────────────────────────────────────────┬──────────────────────────────────────────────┘
                                         │
                              ┌──────────┴───────────────┐
                              │  @pneuma/x402 (npm)      │
                              │  HTTP 402 中间件         │
                              │  Hono / Express adapter  │
                              └──────────┬───────────────┘
                                         │
   ┌───────────────┬──────────────┬──────┴──────┬──────────────┬──────────────────┐
   ▼               ▼              ▼             ▼              ▼                  ▼
service-finance service-text  Orchestrator   skill-starter  Hub dApp        Viewer dApp
(Hono + mock)   (DeepSeek)    (LLM agent +    (5-min        (cyber-soul     (independent
                              声誉排序)        模板)         dark + spending  warm-amber)
                                                            trail)
```

## 链上部署（Arc Testnet, Chain ID 5042002）

| 合约 | 地址 |
|---|---|
| USDC (external, Circle — Arc native gas + ERC-20, 6 decimals) | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| **BudgetController** (per-TBA daily USDC cap) | [`0xcDF3de632Af74097D1f9A2788dE312A207Cc1A95`](https://testnet.arcscan.app/address/0xcDF3de632Af74097D1f9A2788dE312A207Cc1A95) |
| SoulAccount (impl) | [`0x2325631E1D674098941364997a69C520ab14Be82`](https://testnet.arcscan.app/address/0x2325631E1D674098941364997a69C520ab14Be82) |
| PneumaAttestation | [`0x169ffe395734374E51BB852391F9F9856B1Fe54E`](https://testnet.arcscan.app/address/0x169ffe395734374E51BB852391F9F9856B1Fe54E) |
| **SoulNFT** (ERC-8004 IdentityRegistry) | [`0x4983B6f856885E428A0Cf62F1579A1a031032415`](https://testnet.arcscan.app/address/0x4983B6f856885E428A0Cf62F1579A1a031032415) |
| SkillRegistry (含 provider stake / slash / SLA) | [`0xB63c7fBCA41466edF3AB0F78F14a7EB85D8D6B69`](https://testnet.arcscan.app/address/0xB63c7fBCA41466edF3AB0F78F14a7EB85D8D6B69) |
| PneumaTimelock | [`0xec2a731Aa46a53dcE5323018C203828A742996E4`](https://testnet.arcscan.app/address/0xec2a731Aa46a53dcE5323018C203828A742996E4) |

> **关于 USDC**：Arc 是 Circle 的 L1 链，原生 gas token 就是 USDC（同合约同时暴露 6-decimal ERC-20 接口）。Pneuma 不发自创支付代币 — 协议层用 IERC20 接口注入，部署时绑定到 Arc 原生 USDC。开发者通过 [Circle faucet](https://faucet.circle.com) 直接领测试 USDC 即可，无需任何自有水龙头。

## 关于声誉系统的真实定位

> Pneuma 不主张"协议消灭了 sybil 攻击" — 任何评分系统（Amazon/Yelp 包括在内）都不可能 100% 防造假。
> 我们做的是：**改善信号-噪声比 + 把伪造成本拉到不划算 + 数据公开让全网博弈识破**。

具体怎么做：

| 层 | 机制 | 效果 |
|---|---|---|
| **信号多样性** | score（数字）+ comment（文字）+ boundary（转手历史）+ rater 角色权重 | 单一指标可刷，多信号组合大幅提升伪造难度 |
| **预防** | `_callerRated[callId]` 一票锁 + `caller != skill.owner` self-call 拒绝 + 免费 skill 评分不进 score 公式 | 挡住低成本脚本娃娃攻击 |
| **事后纠错** | revoke attestation → 自动联动 `slashOnRevoke` 罚没 provider stake | 让作恶有真实美元成本 |
| **决策辅助** | 转主自动写 SYSTEM boundary，前端按段渲染（前任时代灰化、现任时代高亮） | 买二手 Soul 时能看到"高分是谁攒的" |
| **信任承认** | 数据全部公开，第三方可自建 sybil-detection indexer，不依赖单一裁判 | 把作弊检测变成开放博弈 |

→ **一句话**：协议层做"成本 / 透明度 / 多信号"三件事，配合应用层多决策维度（试调小单 + budget cap + caller 自己读评论）综合判断。**完美防作弊不在我们的承诺里 — 跟 Amazon、Yelp 一致**。

## 快速跑起来

```bash
# 1. clone + setup
git clone <this-repo>
cd pneuma-protocol
make setup            # forge install + pnpm install

# 2. 配 .env.local（拷 .env.example，填私钥 + LLM API key）
cp .env.example .env.local
${EDITOR:-vi} .env.local        # 或 code .env.local / nano .env.local

# 3. 跑测试 + 部署（如需）
make test             # forge test 67 个测试（Pneuma 55 + BudgetController 12）
make deploy-arc       # 部署到 Arc Testnet

# 4. 起前端 + 后端服务（4 个后台进程）
pnpm --filter @pneuma/service-finance start &     # :3001
pnpm --filter @pneuma/service-text start &        # :3002
pnpm --filter @pneuma/hub dev &                   # :3100  Pneuma Hub
pnpm --filter @pneuma/viewer dev &                # :3200  Independent viewer
# 停服：pkill -f "service-finance|service-text|next-server"

# 5. 浏览器打开
open http://localhost:3100        # Pneuma Hub: mint Soul / 领 USDC / 调 skill
open http://localhost:3200        # Viewer: 跨平台读 attestation
# 测试 USDC 通过 Circle faucet 领取：https://faucet.circle.com
```

## 项目结构

```
pneuma-protocol/
├── contracts/             ← Foundry, 8 Solidity 合约 + 149 测试（外部 USDC 不在仓库内；PneumaCourt 代码 ready 待部署）
│   ├── src/
│   │   ├── SoulNFT.sol             ERC-721 + ERC-8004 IdentityRegistry + 6551 派生 + 转主 boundary hook
│   │   ├── SoulAccount.sol         ERC-6551 智能账户实现
│   │   ├── PneumaAttestation.sol   4 raterRole + 转主 boundary + revoke 联动 slash + ≤280 字符 comment 字段
│   │   ├── SkillRegistry.sol       escrow / settle / refund + provider stake/slash + SLA + self-call 拒绝（IERC20 注入 USDC）
│   │   ├── BudgetController.sol    per-TBA daily USDC cap (opt-in, 原子 check-and-debit)
│   │   ├── PneumaTimelock.sol      治理 2-day 延迟（OpenZeppelin Governor 兼容）
│   │   ├── PneumaCommons.sol       publish / cite / retract 知识公地（已部署）
│   │   ├── ReputationGraph.sol     endorsement + stake decay 担保图（已部署）
│   │   └── PneumaCourt.sol         multi-juror dispute（代码 ready，链上待 sprint）
│   ├── test/
│   │   ├── MockUSDC.sol            仅 test 用，6-decimal stablecoin mock（模拟 Circle USDC 接口）
│   │   ├── Pneuma.t.sol            66/66 通过（核心协议 + multi-rater + boundary + per-byte 退款）
│   │   ├── BudgetController.t.sol  12/12 通过
│   │   ├── PneumaCommons.t.sol     23/23 通过（publish/cite/retract）
│   │   ├── ReputationGraph.t.sol   23/23 通过（endorsement + stake decay）
│   │   ├── PneumaCourt.t.sol       21/21 通过（multi-juror dispute；合约代码 ready，链上待 sprint）
│   │   └── SlashLinkage.t.sol      4/4 通过（revoke→slash 联动 invariant）
│   └── script/Deploy.s.sol
├── packages/
│   ├── x402/                @pneuma/x402 npm 包（4 入口：核心 / hono / express / client）
│   ├── skill-starter/       @pneuma/skill-starter，5 分钟接入你自己的 agent
│   └── cli/                 @pneuma/cli，agent 原生 CLI（discover / inspect / balance / trail）
├── services/
│   ├── finance/             mock 价格服务（Hono）
│   └── text/                DeepSeek 摘要（Hono）
├── orchestrator/            LLM agent：链上 skill 发现（按声誉排序）+ 任务拆解 + 并行 x402 + 聚合
├── apps/
│   ├── hub/                 Pneuma 主 dApp (Next.js 15)
│   │   └── app/
│   │       ├── profile/[soulId]/      Soul 详情 + 反洗白时代切段
│   │       ├── run/                   x402 调用 + caller 反向评分
│   │       ├── wallet/                approve / USDC balance / Circle faucet 引导
│   │       ├── skills/                链上 skill 发现
│   │       └── spending-trail/[tba]/  Proof-of-Spend receipt feed
│   └── viewer/              独立 dApp，跨平台读 PneumaAttestation
├── DESIGN.md                完整方案设计
└── ROADMAP.md               协议完成度记录 + 后续 phase 路线
```

## 为你自己的 Agent 接入 Pneuma · 5 分钟从 0 到链上收 USDC

任何开发者把自己的 AI agent 包成一个 HTTP service，挂上 `@pneuma/x402` 中间件，就能：
- 在 SkillRegistry 注册成可被发现的 skill
- 接收 x402 协议的链上付费调用
- 自动 settle 收 USDC（Arc 原生）、自动给 caller 写 attestation

模板就在 `packages/skill-starter`：

```bash
cd packages/skill-starter
cp .env.example .env.local           # 填私钥 + skill 元信息（注意价格用 6 decimals: 5 USDC = 5 * 1e6）
pnpm install
pnpm register                         # forge 一键链上注册
# → ✅ Skill registered, skillId=N
# 把 N 粘进 .env.local 的 SKILL_ID=
pnpm dev                              # 启动你的 skill 服务
# → 你已经是 Pneuma 协议上的 x402-payable skill 了
# → 立即可在 http://localhost:3100/skills 看到，orchestrator 会按声誉排序拉到
```

完整 quickstart：[`packages/skill-starter/README.md`](./packages/skill-starter/README.md)

只需替换 `src/index.ts` 里 `/api/run` handler 的内部逻辑（调你的 LLM / DB / API），中间件自动处理 402 / verify callId / settle。

## 关键技术抓手

1. **客户端付 gas + 链上验证 callId**：避开 meta-tx 复杂性，反伪造抓手在 callId 链上不可伪造
2. **USDC-native settlement**：直接对接 Arc 原生 USDC（合约 `0x3600...0000` 同时是 native gas 和 ERC-20 接口）→ 无自创代币 friction、stake/slash 立刻有真实美元约束、评委 demo 用 [Circle faucet](https://faucet.circle.com) 一键即可领；协议层 token-agnostic（IERC20 接口注入），未来 mainnet / 其他链上 USDC 都能复用
3. **PneumaAttestation 自建**：Arc 上没 EAS，自建反而能跟 x402 paymentHash 强绑定，差异化更强
4. **transferable Soul + TBA 跟随**：NFT 转给新 owner，TBA owner 自动跟随，履历跟着 TBA 走 → 亮点 1 物理保证
5. **`@pneuma/x402` 一行接入**：服务方 30 秒挂 middleware 即可收 USDC
6. **Provider self-stake + auto-slash**：`claimTimeoutAndSlash` 任意第三方可触发，`slashOnRevoke` 与 attestation revoke 联动，`lockedStake` 与 escrow 一一绑定杜绝撤资逃避
7. **BudgetController 原子 check-and-debit**：避开 SkillRegistry 端的 TOCTOU；opt-in 默认无限额（向后兼容存量 TBA）；UTC day 跨链一致
8. **三层信任 pipeline**：reputation（pre-call 选 skill）→ stake/slash（in-call SLA 兜底）→ budget（caller 侧花费上限），覆盖完整调用生命周期

## 149/149 单元测试

<details>
<summary>展开测试详情（6 个 forge 测试 suite，149 PASS / 0 FAIL）</summary>

```
# 核心协议（12）
test_PublicMintSoul_DerivesTBA              ✅ TBA 派生地址正确
test_SoulIsTransferable_TBAFollowsNewOwner  ✅ NFT transferable + TBA 跟随
test_E2E_CrossPlatformReadByThirdParty      ✅ 跨平台读取
test_E2E_NFTTransferCarriesHistory          ✅ 履历跟随 NFT
test_EscrowAndSettle_TriggersAttestation    ✅ x402 escrow→settle→attest 闭环
test_RefundAfterTimeout                     ✅ 超时退款
test_AttestRequiresAttesterRole             ✅ 反伪造保护
test_RevokeAttestation                      ✅ 撤销机制
test_USDCPermit                             ✅ EIP-2612（Arc 原生 USDC）
test_RegisterSkill / test_RevertOnEmptyAgentName ✅ 注册 + 输入校验
test_AttestAndReadByRecipient               ✅ attestation 主入口

# Multi-rater attestation 双向声誉（5）
test_CallerCanRateAfterSettle               ✅ caller 反向评分写链
test_CallerCannotDoubleRate                 ✅ 一 callId 一票，防刷分
test_NonCallerCannotRate                    ✅ 仅 caller 本人有评分权
test_CallerCannotRateBeforeSettle           ✅ 必须 settled 才能反评
test_DualRatingFlow_BothRolesPresent        ✅ provider+caller 双向闭环

# 反洗白 Boundary attestation（4）
test_MintDoesNotWriteBoundary               ✅ Mint（from=address(0)）不写 boundary
test_TransferWritesBoundaryAttestation      ✅ 转主自动写 SYSTEM-rater attestation
test_TwoTransfersWriteTwoBoundaries         ✅ 多次转主累计 boundary，时间线可切段
test_OnlySoulNFTCanWriteBoundary            ✅ 仅 BOUNDARY_ATTESTER_ROLE 可写（防伪造）

# ERC-8004 IdentityRegistry compliance（6 — 新增）
test_ERC8004_RegisterMintsSoul              ✅ register() 真 mint Soul
test_ERC8004_RegisterWithURI                ✅ register(uri) 写 agentURI
test_ERC8004_SetAgentURIByOwner             ✅ owner 可改 URI
test_ERC8004_SetAgentURI_NonOwnerReverts    ✅ 非 owner 改 URI revert
test_ERC8004_DefaultAgentNameOnRegister     ✅ 自动 "Agent #N" 默认名
test_ERC8004_RegisteredEventEmitted         ✅ 标准 Registered 事件

# v2 — Provider stake / SLA / slash（14 — 新增 Track A）
test_RegisterSkill_PullsStake               ✅ 注册时 USDC 押金转入合约
test_RegisterSkill_SlashBpsTooHigh_Reverts  ✅ slashBps > 10000 拒绝
test_RegisterSkill_ZeroSla_Reverts          ✅ slaTimeoutSec=0 拒绝（避免退化攻击面）
test_BackwardCompat_RegisterSkillWithZeroStake ✅ 兼容路径：stake=0 仍可注册
test_WithdrawStake_RespectsLocked           ✅ 不可超过 providerStake - lockedStake
test_WithdrawStake_NonOwner_Reverts         ✅ 仅 skill owner 可提
test_ClaimTimeoutAndSlash_AnyoneCanCall     ✅ 第三方可触发 slash + 退款
test_ClaimTimeoutAndSlash_BeforeTimeout_Reverts ✅ SLA 内不可触发
test_ClaimTimeoutAndSlash_ZeroStake_NoSlashAmount ✅ 兼容：stake=0 时 slash=0 仍退款
test_SlashOnRevoke_OnlyAttestation          ✅ 仅 PneumaAttestation 可调
test_SlashOnRevoke_ViaAttestationRevoke     ✅ revoke→slash 联动闭环
test_SlashOnRevoke_DoubleSlashReverts       ✅ 防重复 slash
test_RevokeWithoutHook_DoesNotSlash         ✅ skillRegistry 未配时 revoke 不阻塞
test_SlashAmount_CapsAtAvailableStake       ✅ slash 金额不超过剩余 stake

# v2 — BudgetController（12 — 新增 Track B）
test_SetDailyBudget_StoresValue             ✅ 设置预算
test_SetDailyBudget_ZeroClearsPrevious      ✅ 设 0 = 清除/无限
test_TryRecordSpend_NoBudget_AlwaysOk       ✅ 未设预算永远通过
test_TryRecordSpend_WithinBudget_Succeeds   ✅ 在预算内通过
test_TryRecordSpend_ExceedingBudget_Fails   ✅ 超预算返 false
test_TryRecordSpend_UnauthorizedCaller_Reverts ✅ 仅 SPENDER_ROLE 可写
test_DayRollover_ResetsSpend                ✅ 跨天重置
test_GetBudgetRemaining_NoBudget_ReturnsMax ✅ 无预算返 type(uint256).max
test_GetBudgetRemaining_AfterSpend_DecreasesCorrectly ✅ 减法正确
test_GetStatus_ReportsBudgetSetFlag         ✅ UI 状态查询
test_GrantSpender_OnlyGovernor              ✅ 仅 governor 可授权
test_GrantSpender_ZeroAddressReverts        ✅ 零地址拒绝

# v2 — Track A × Track B 集成（3）
test_Integration_BudgetController_BlocksOverspend ✅ 超额 escrow 触发 BudgetExceeded
test_Integration_BudgetController_ExhaustsAcrossCalls ✅ 多次小额累加打满预算
test_Integration_BudgetController_NoControllerNoEffect ✅ 未配置 controller 时 escrow 无变化

# v3 — User Comment Primitive（4 — 新增）
test_CallerCommentPersistedOnChain          ✅ 真用户文字评论链上原样持久化
test_ProviderCommentInSettleCall            ✅ provider 也能在 settle 时写文字备注
test_CommentTooLong_Reverts                 ✅ 超 280 字符 revert（防 storage 滥用）
test_BoundaryAttestationHasEmptyComment     ✅ 系统 boundary 强制空评论（无人工内容）

# v3 — Self-call 防御（2 — 新增 L1 反 self-dealing）
test_RejectSelfCall_AsSkillOwner            ✅ provider 用自己 EOA 调自己 skill 必须 revert
test_NormalCallStillWorks_DifferentCallerAndOwner ✅ 防御不误伤正常路径
```

</details>

## 工程取舍

Pneuma 协议层每一块都基于公开以太坊标准 + 经过审计的库（OpenZeppelin），
不引入未经验证的实验性原语。下表是关键实现选择 + 取舍理由：

| 模块 | 实现选择 | 取舍理由 |
|---|---|---|
| `SoulNFT` | ERC-721 + ERC-8004 IdentityRegistry minimal subset + ERC-6551 派生 | 让一个合约同时是身份 + 钱包派生入口，避免双合约同步问题 |
| `SoulAccount` | ERC-6551 标准 reference 实现 | 多链一致部署的 canonical Registry 已就位，零自定义 |
| `PneumaAttestation` | 自建 4-rater attestation 注册器（PROVIDER / CALLER / JUROR / SYSTEM） | EAS 不支持 boundary attestation hook + role 权限隔离，自建更可控；schema 字段一旦上线不可变，命名 V1 后缀允许后续部署 V2 |
| `SkillRegistry.callerRateSkill` | 反向评分必须绑定 settled callId，单 callId 单评 | 协议层 O(1) 防 sybil 刷分（多钱包刷分由声誉公式 unique-callers 因子兜底） |
| `SoulNFT._update` 转主 hook | 自动触发 SYSTEM-rater boundary attestation，try/catch 包裹防 DOS | 反信用洗白链上锚点，不可绕过 |
| `PneumaTimelock` | 2-day 延迟治理包装层，OpenZeppelin Governor 兼容 | 治理动作有撤销窗口，避免单点滥权 |
| `@pneuma/reputation-formula` npm 包 | 公式 `sqrt(volume) × ageFactor × log₂(count+1) × decay × weightedRating`，纯 TS 零 deps，18/18 单测锁系数 | 第三方 dApp `pnpm add` 一行装上即可复现同一分数；hub 前端也消费同包，单一 source of truth |
| `orchestrator/src/reputation.ts` + `discoverSkillsRanked` | 同公式链下批量算，LLM planner 拿 score 字段排序 | 声誉不是展示数据，是 agent 决策时真用的输入 |

## 声誉闭环（写得到 → 读得出 → 决策时用得上）

> 这是 Pneuma 与"中心化 agent 平台 + 链下评分"最大的区别。三段闭环：

| # | 谁写 | 写到哪 | 何时 |
|---|---|---|---|
| **写得到** | SkillRegistry 的 `settleCall` / `callerRateSkill` | PneumaAttestation 链上 `_byRecipient[tba]` 索引 | 每次 x402 调用结束 + caller 反向评分 |
| **读得出** | 任意第三方 dApp（Viewer / 自建 indexer / forge cast） | `getAttestationsByRecipient(tba)` 一行 RPC | 任意时刻，零授权零集成 |
| **决策用** | Orchestrator 的 `discoverSkillsRanked` + 同公式 `reputation.ts` | LLM planner 拿到 `reputation.score` 字段做"同类选最优" | 每次拆解任务前自动跑 |

**关键事实**：链上声誉**不是给人看的展示数据，是 agent 决策时真在用的输入**。
冷启动豁免（`isColdStart=true` 时新人仍可见）让"老兵优先"不会变成"老兵垄断"。

**关键事实**：每一处实现都基于以太坊标准（ERC-721 / ERC-6551 / ERC-8004 / EIP-712 / EIP-2612 / x402）+ 经过审计的库（OpenZeppelin），不引入未经验证的实验性原语。

## 与现有方案的差异化

| 同类方案 | 主张 | 缺口 | Pneuma 的覆盖 |
|---|---|---|---|
| x402 / 微支付市场 | A2A x402 支付 | 无可携带身份、无 attestation、无声誉决策 | ✅ Soul 可携带 + 跨 dApp 读 + orchestrator 按声誉排序 |
| 链上 Agent 治理 / 仲裁专项 | Agent 司法 | 无支付闭环、无 attestation 通用化 | ✅ 用 x402 支付事件锚定 attestation |
| Agent 应用框架（应用层运行时类） | 运行框架 | 身份不可携带、无开放支付协议 | ✅ 全基于以太坊标准，真正中立 |
| 中心化 Agent 平台（应用层 walled garden） | 应用层 walled garden | 平台关停=归零、声誉是展示数据不参与决策 | ✅ 协议层、wallet-bound、声誉是 agent 决策的输入 |

**一句话**：Pneuma 是第一个把「身份 + 钱包 + 支付 + 履历 + provider 经济安全 + caller 花费控制 + 治理」**七件事**拼成一个开放协议的项目，且每一件都是以太坊标准 — 不是又一个孤岛。

## Roadmap（黑客松后下一阶段）

按"先做实链上经济基础设施，再做仲裁治理"的顺序：

### Phase 1 · DAO 治理
- 替换当前单点 `GOVERNOR_ROLE` 为通过 `PneumaTimelock` + OpenZeppelin Governor
- 发独立的 ERC20Votes 治理代币（与支付层 USDC 解耦：governance ≠ payment medium）
- 提案 / 投票 / 队列 / 执行的完整生命周期
- 引用：[OpenZeppelin Governor 文档](https://docs.openzeppelin.com/contracts/5.x/governance)

### Phase 2 · Commit-Reveal 投票
- 争议 attestation 进入挑战期，触发 commit-reveal 投票
- 防 vote-buying（jurors 在 reveal 前没人能验证投票）
- 引用：Kleros v2 commit-reveal 设计

### Phase 3 · Sortition + 陪审制
- **当前 v1（已交付）**：provider self-stake + SLA-timeout 任意第三方触发 slash + revoke 联动 slash（`SkillRegistry.claimTimeoutAndSlash` / `slashOnRevoke`）
- **v2 升级**：争议 attestation 进入 jury panel，VRF 选 N 个持治理代币的 jurors（principal-aware exclusion 排除关联方）
- Bond + Slash：错误投票方被罚没，受害方从 carepool 补偿
- 引用：[Kleros 白皮书](https://kleros.io)、[EigenLayer AVS slashing](https://docs.eigenlayer.xyz)

### Phase 4 · 隐私保护投票
- 把 commit-reveal 升级为 ZK 完全匿名
- 候选方案：Semaphore（zkSNARK 群成员证明）/ FHE（Fhenix / Inco / Zama）
- 引用：[Semaphore protocol](https://semaphore.pse.dev) / FHE 链 EVM 集成

### Phase 5 · 跨链 attestation 桥
- 让 Pneuma 履历跨 Arc → Base → Ethereum mainnet
- 候选方案：CCIP / LayerZero / native bridge
- agent 在多链跑也能聚合声誉

### Phase 6 · 用户主权 Agent Memory（user-sovereign memory）
> **核心原则**：Pneuma 协议永远不托管用户的 agent memory。

- **链上只存指针**：SoulNFT 加 `setMemoryPointer(tokenId, contentHash, uri)` —— 写一个
  `{ contentHash: bytes32, uri: string }` 挂到 SOUL TBA 上，链上 calldata 极小
- **内容用户选存哪**：
  - IPFS / Arweave（公开 + 永久）
  - 用户加密本地（最大主权，agent 跑时设备需在线）
  - Filecoin / Storj 长期存储
  - 任何用户私有 backend
- **跨设备同步**：新设备连同一钱包 → 链上读指针 → 拉到 memory 文件 → 解密恢复
- **平台关停 = 0 影响**：因为 Pneuma 永远没保管过 memory，连删都没东西删
- **对比中心化 agent 平台 / 闭源 LLM provider**：memory 在中心化 DB，平台关停 = memory 归零
- **对比"必须用户设备永远在线"**：Pneuma 让用户*选*——可放公开存储让 agent 24/7 跑，
  也可加密本地走最大主权路线，**不强制**

> 兑现 "wallet-bound identity" 哲学的终局：身份、钱包、履历、记忆 —— 全部跟着 NFT 走，永远不被任何平台扣留。

每个 phase 引用**公开标准 / 公开论文**，不做"自吹孤岛"。

## 文档

- [DESIGN.md](./DESIGN.md) — 完整方案设计（18 章）
- [ROADMAP.md](./ROADMAP.md) — 协议完成度记录 + 后续 phase 路线
- [packages/x402/README.md](./packages/x402/README.md) — `@pneuma/x402` npm 包接入指南
- [packages/skill-starter/README.md](./packages/skill-starter/README.md) — 5 分钟接入你自己的 agent

## 许可证

MIT
