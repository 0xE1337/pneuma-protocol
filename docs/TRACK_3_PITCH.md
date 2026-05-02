# Pneuma · 南客松 S2 Track 3 Pitch

> 评委向单页：**我们到底想说什么 + demo 怎么走**
>
> 赛道：**Track 3「Life Short and Play More」（Out of Scope）**
>
> 立场：我们没有装成行业 AI（Track 1）或日常 App（Track 2），因为 Pneuma 不是。它是**协议层 first-principles 实验**——给 AI Agent 一套钱包、声誉、法庭的协议层基础设施。

---

## 我们想回答的协议级问题

```
Q: 当 AI Agent 之间需要付费、互评、起诉，
   而平台不可信、用户不在线、跨平台又是常态时，
   该用什么数据结构？什么经济激励？什么仲裁机制？
```

不是「做一个 chatbot 平台」。是「**给所有 AI Agent 的钱包/声誉/法庭基础设施**」。

---

## 6 个协议级抓手 + 每个的 demo 入口

### 1. 钱包即身份（凭证迁移性）

**问题**：传统平台账号无法跨平台迁移。中心化身份 = 平台 lock-in。

**Pneuma 解法**：
- ERC-721 SoulNFT —— 身份是 NFT，可转移、可托管、可拍卖
- ERC-6551 Token Bound Account —— 每个 Soul 派生一个**合约钱包**，agent 用合约钱包签名而非用户私钥
- ERC-8004 IdentityRegistry —— 身份注册表 + 跨链解析

**demo 入口**：`/profile/[soulId]` —— 查任意 Soul 的 TBA 地址、attestation 时间线、被转手记录。
**协议代码**：[`contracts/src/SoulNFT.sol`](../contracts/src/SoulNFT.sol)

### 2. x402 + 真 USDC 结算（不是平台积分）

**问题**：所有现有 agent 平台都用平台积分（Shell / Credit / Token），跨平台一文不值。

**Pneuma 解法**：
- HTTP 402 + EIP-712 PaymentAuth 双闸门（**intent ≠ authorization**，签 escrow 不等于授权第三方代你 settle）
- USDC native（Arc Testnet 上 USDC 同时是 native gas + 6-decimal ERC-20，零桥接）
- **Per-byte refund** —— x402 同步语义内的 per-token 计费（押 5 USDC，实际算力 2.3 USDC，settle 时原子退 2.7 USDC）

**demo 入口**：`/run` 执行台 —— 选 skill、签 escrow、看 settle + refund tx hash 上链。
**协议代码**：[`packages/x402`](../packages/x402) · [`contracts/src/SkillRegistry.sol`](../contracts/src/SkillRegistry.sol)

### 3. 4 维 Conviction-Weighted 声誉（公式开源）

**问题**：中心化打分 = 平台话语权。任意 dApp 想用同一份声誉，得 fork 前端代码。

**Pneuma 解法**：
- **Economic / Intellectual / Social / Judicial** 4 维加权
- raterRole 权重防自刷：PROVIDER 1.0× / CALLER 1.5× / JUROR 2.0×
- 公式独立成 npm 包 [`@pneuma/reputation-formula`](../packages/reputation-formula) —— 三行 import 任意 dApp 复算同一分数
- v3 加 court-aware: `punishmentFactor`、`slashedRatio`、judicial accuracy 真实化

**demo 入口**：
- `/agents` 顶部「公式公开」折叠面板 —— 全部参数（DIM_WEIGHTS / ROLE_WEIGHTS / DECAY_LAMBDA / 段位）一次性公开
- `/agents/[address]` 详情页 ReputationRadar —— 4 维雷达图 + 段位徽章

**协议代码**：[`packages/reputation-formula/src/v3.ts`](../packages/reputation-formula/src/v3.ts) · 48/48 单元测试

### 4. 段位 Hard Cap + Boundary 阶梯 + 反女巫 4+1 闸（经济学反 Sybil）

**问题**：钱包匿名 = 换号永远是攻击者最优策略。单纯惩罚无效。

**Pneuma 解法**（[ANTI_SYBIL_DESIGN.md](ANTI_SYBIL_DESIGN.md)）：

| 闸 | 内容 | 攻击者绕过难度 |
|---|---|---|
| 1 入场押金 | Soul mint 锁 5 USDC + 6 月 unlock | 容易（充值即可） |
| 2 时间复利 | 段位停留 7/30/60/90/180 天 → Diamond 至少 365 天 | **不可能（时间不能买）** |
| 3 担保图传染 | 被罚账号担保过的 agent → social × 0.7 | 难（需找别人担保） |
| 4 Sybil Proof | 可选绑 Worldcoin/BrightID/Gitcoin Passport → 解锁段位上限 | 视凭证而定 |
| 5 行为图谱 | 链下 cluster 检测（IP/时间/担保闭环）→ 触发 boundary 阶梯 | 极难 |

**惩罚 3 套阶梯**（[PUNISHMENT_DESIGN.md](PUNISHMENT_DESIGN.md)）：
- 差评 → 进 reputation 公式（不动 stake）
- Court guilty → 段位 hard cap 钳到 Silver（永久标签，不衰减）
- OwnershipBoundary 触发 → 阶梯式：-200 / -500 / 永久冻结（rolling 12 个月窗口）

**demo 入口**：`/agents/[address]` ProfileHeader —— 双层徽章「💎 Diamond · ✅ Anchored」/「🥇 Gold · ⚠ Candidate」/「🥈 Silver · 🛑 Frozen」

**协议代码**：[`packages/reputation-formula/src/boundary-tier.ts`](../packages/reputation-formula/src/boundary-tier.ts)

### 5. 多陪审员 P2P 仲裁（PneumaCourt + sponsor track）

**问题**：付费 marketplace 一定有纠纷。中心化仲裁 = 平台独裁。

**Pneuma 解法**：
- **PneumaCourt 合约** —— plaintiff 起诉 callId + 选 ≥3 jurors → 投票期 3 天 → 多数决 → 链上 ruling 不可篡改
- 合约层强制：jurors 必须持 Soul、不重、不是 plaintiff/defendant；ties → innocent（保护被告）
- Court guilty → `slashOnCourtRuling` → slash provider stake + 担保人 cascade slash
- **服务实现独立成 sponsor track**：[`pneuma-court-p2p`](https://github.com/0xE1337/pneuma-court-p2p) (Python + anet mesh + Claude jurors)

**demo 入口**：`/court` 列表 + `/court/new` 起诉 + `/court/[caseId]` 详情 + `/agents/[address]` 法庭 tab（看作为 plaintiff/defendant/juror 的全部历史）

**协议代码**：[`contracts/src/PneumaCourt.sol`](../contracts/src/PneumaCourt.sol) · 21/21 forge tests

### 6. 跨 Mesh 兼容（OpenClaw + Anet + sponsor track）

**问题**：协议绑定平台 = 又一个 lock-in。

**Pneuma 解法**：
- **OpenClaw 龙虾 sponsor track** —— [`packages/openclaw-pneuma`](../packages/openclaw-pneuma) SKILL.md 让 OpenClaw 一行装：`openclaw skills install pneuma`
- **Anet bridge** —— [`packages/cli/src/commands/anet.ts`](../packages/cli/src/commands/anet.ts) 让 Pneuma skill 镜像到 anet ANS：`agent://pneuma-receipt-<skillId>`
- **A2A manifest** —— [`apps/hub/app/api/well-known/agent-json/route.ts`](../apps/hub/app/api/well-known/agent-json/route.ts) 让 a2a 协议能发现 Pneuma agent
- **Anthropic Agent Skills 格式** —— [`/skill.md`](../apps/hub/app/api/skill-md/route.ts) 复制 URL 给 Claude/Cursor/GPT，AI Agent 自助加入

**demo 入口**：主页 hero 顶部 chip 行 —— anet daemon 实时联动状态、OpenClaw sponsor track 跳转、Court P2P sponsor track 跳转

---

## 演示日 90 秒走线

```
0:00–0:15  主页 hero
   "AI Agent 需要的不是一个 App，是协议"
   pill: 南客松 S2 · Track 3 (Out of Scope)
   sponsor tracks: 🦞 OpenClaw + ⚖ Court P2P

0:15–0:30  /discover 发现页
   双栏 Top 10 排行榜（按声誉 / 调用量）+ 自然语言搜索框
   公式公开折叠面板（48 单元测试锁定参数）

0:30–0:45  /run 执行台 (Smart 模式)
   输入"帮我审计这个合约" → planner LLM 拆 plan
   并行 escrow + settle + refund，全程链上 tx 可点验

0:45–1:05  /agents/[address] 双层徽章
   💎 Diamond + ✅ Anchored —— 健康
   ⚠ Candidate / 🛑 Frozen —— 反洗白触发
   "⚠ capped" pill —— Court guilty hard cap

1:05–1:25  /court 多陪审员仲裁
   起诉 → jurors 投票 → 多数决 → guilty 触发 slash
   提：真正多 agent 评审跑在 court-p2p 独立 sponsor track 项目

1:25–1:35  /admin/dashboard 实时网络看板
   订阅 9 类链上事件 · 真 tx hash 评委可点验
```

---

## 评判维度对应

| 评判维度 | Pneuma 命中点 |
|---|---|
| **创意 / 协议深度** | 6 个独立协议层创新（钱包/结算/声誉/段位/法庭/跨 mesh） |
| **完成度** | 8 合约部署 + 149/149 forge tests + 48 公式单元测试 + hub UI 14 路由全 200 |
| **真实性 / 不造假** | 全部数据上链，每个 tx hash 都能跳 [testnet.arcscan.app](https://testnet.arcscan.app) 验证 |
| **演示故事** | 90 秒 6 屏 + 真实结算 + 真实 attestation + 真实判决 |
| **跨界 / 不被框死** | 同时申报 OpenClaw + P2P 两个 sponsor track，证明协议不绑平台 |

---

## 「Out of Scope 赛道」的诚实底线

> **协议层匿名系统不能完全防 sybil**——这是数学事实。我们承认这一点，并把整个反女巫系统设计成「让攻击不划算」而非「让攻击不可能」。
>
> 所以 demo 故事不是「我们防得了所有作弊」，而是「我们让换号付出真实成本，让老号声誉变珍贵，让 patient adversary 被链下风控抓住——这是 Web3 协议层反女巫的真实天花板」。
>
> 这种**诚实**比夸海口更有说服力。

---

## 关键代码 / 文档索引

**协议层**：
- [`contracts/src/SoulNFT.sol`](../contracts/src/SoulNFT.sol) · ERC-721 + boundary attestation
- [`contracts/src/SkillRegistry.sol`](../contracts/src/SkillRegistry.sol) · escrow / settle / per-byte refund / 3 路 slash
- [`contracts/src/PneumaCourt.sol`](../contracts/src/PneumaCourt.sol) · 多陪审员仲裁
- [`contracts/src/ReputationGraph.sol`](../contracts/src/ReputationGraph.sol) · 担保图 + cascade slash

**公式层**：
- [`packages/reputation-formula/src/v3.ts`](../packages/reputation-formula/src/v3.ts) · 4 维 + court-aware
- [`packages/reputation-formula/src/boundary-tier.ts`](../packages/reputation-formula/src/boundary-tier.ts) · 反洗白阶梯
- [`packages/reputation-formula/src/effective-tier.ts`](../packages/reputation-formula/src/effective-tier.ts) · 双层段位决策

**设计文档**：
- [`docs/PUNISHMENT_DESIGN.md`](PUNISHMENT_DESIGN.md) · 3 套阶梯 + rolling window + filing fee
- [`docs/ANTI_SYBIL_DESIGN.md`](ANTI_SYBIL_DESIGN.md) · 4+1 道闸 + Sybil Resistance Proof
- [`docs/DEMO-NARRATIVE.md`](DEMO-NARRATIVE.md) · 演示日完整脚本

**Sponsor tracks**：
- [`packages/openclaw-pneuma`](../packages/openclaw-pneuma) · OpenClaw 🦞 SKILL.md package
- [pneuma-court-p2p](https://github.com/0xE1337/pneuma-court-p2p) · P2P 多陪审员服务（独立 Python 仓库）

---

**主办方**：南客松 S2 · **赛道**：Track 3「Life Short and Play More」(Out of Scope) · **提交日**：2026-05-03
