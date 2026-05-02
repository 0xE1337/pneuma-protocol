# 本机演示运行手册（DEMO_LOCAL）

> 跟 [DEMO_NIGHT.md](./DEMO_NIGHT.md) 互补：**DEMO_NIGHT** 关注链上 12 单数据怎么准备，
> 这份关注**演示当天怎么从一台 MacBook 跑完 5 分钟剧本**——零隧道、零 Vercel、
> 零公网回源依赖，所有输入框已经预填，开浏览器就能录。

## 0. 顶层设计

| 维度 | 选择 | 原因 |
|---|---|---|
| 链 | Arc Testnet（已部署） | 12 单 callIds 107-124 已 settled，dashboard 真有数据 |
| UI | `pnpm --filter @pneuma/hub dev` localhost:3100 | 不依赖 Vercel deployment，零隧道风险 |
| Skill 服务 | `apps/hub/app/api/skills/[skill]/route.ts`（Next API route） | SDK 适配器已写好，本地启动即可（需 `ANTHROPIC_API_KEY`）|
| 默认输入 | `apps/hub/lib/demoDefaults.ts` | 6 个页面 12 个字段全部预填，Cmd+A 一键改 |
| Plan B | `DEMO_NIGHT.md §5.2` 预录 mp4 | live 任何环节翻车 5 秒切视频 |

## 1. 环境前置（一次性，10 分钟）

### 1.1 必要 env（写到 `apps/hub/.env.local`）

```bash
# Anthropic SDK（演示成本：Haiku 4.5 几百次调用 < $1）
ANTHROPIC_API_KEY=sk-ant-...

# 链上 skillId 映射（demo skill 包，注册后回写）
SKILL_ID_PAPER_SUMMARY=...
SKILL_ID_CODE_REVIEW=...
SKILL_ID_BLOCK_EXPLAINER=...
SKILL_ID_CREATIVE_WRITE=...
SKILL_ID_QUICK_REASONING=...

# x402 settle 用的 skill owner 私钥
DEMO_SKILL_OWNER_KEY=0x...   # 或 fallback 用 DEPLOYER_PRIVATE_KEY
```

> 没有 `ANTHROPIC_API_KEY` → /api/skills/* 会 fail-fast 报错；
> 没有 `SKILL_ID_*` → x402 middleware 起不来，POST 405。

### 1.2 启动顺序

```bash
# Terminal 1 —— hub dev server
pnpm --filter @pneuma/hub dev   # localhost:3100

# Terminal 2（可选）—— 想再跑一轮 12 单 burst 补数据
bash scripts/demo-night.sh
```

### 1.3 浏览器准备

1. Chrome 全屏，关掉开发者工具、Bookmarks bar
2. MetaMask 切到 Arc Testnet（chainId 5042002）
3. 连 DEPLOYER 钱包（白名单 admin，dashboard 才有 admin tab）
4. 静音 Slack / 微信 / 钉钉桌面通知

---

## 2. 5 分钟演示剧本（推荐路径）

> 默认输入框都是 demo 友好文案，按下面顺序点过去即可。

### 步骤 0（0:00–0:30）— Hero / Landing
- 路径：`http://localhost:3100/`
- 操作：滚动 hero，停在 "Soul + Skill + Attestation" 三段叙事
- 口播：「钱包不是登录工具，是 agent 的身份本体——下面看真证据」

### 步骤 1（0:30–1:00）— Mint Soul
- 路径：`/mint`
- **预填字段**（已植入 `DEMO_DEFAULTS.mint`）：
  - Agent Name: `小陈 · 翻译大师`
  - Metadata URI: `ipfs://demo`
- 操作：点 `Mint Soul` → MetaMask 签 → 等 receipt
- 口播：「ERC-6551 派生 TBA，Soul = NFT，TBA = 钱包，可转移」

### 步骤 2（1:00–2:00）— Run Skill（核心证据）
- 路径：`/run`
- **预填字段**：
  - 选第一个 Soul（自动）
  - 选第一个 skill（自动）—— 推荐切到一个 text 类 skill
  - Query 文本框（按 category 自动填）：
    - finance → `ETH`
    - text → `AI agents need verifiable on-chain reputation. Please translate this...`
    - default → `Write a 100-word product blurb...`
- 操作：点 `▶ Run with my wallet` → 三连签（approve / escrow / fetch）
- 看右侧 `ResultPanel`：JSON 输出 + Tx links + callId
- **预填评分**：
  - 5 颗星（默认 picked=5）
  - Comment 框：`Excellent translation — terminology spot-on...`
- 操作：点 `Submit rating + review to chain`
- 口播：「钱包付钱 → 服务结算 → 链上 attestation。所有 tx 都从 connected wallet 出」

### 步骤 3（2:00–3:00）— Smart Mode（多 skill 编排）
- 路径：`/run?mode=smart`
- **预填 textarea**（`DEMO_DEFAULTS.runSmartInitial`）：
  - 已经填好了一段 Solidity diff + 一句话风险总结请求
- 操作：点 `▶ 让 planner 拆任务并并行结算`
- 看：planner reasoning → 拆 N 步 → 并行 x402 → aggregated answer
- 口播：「自然语言 → LLM 拆 plan → 并行调用 N 个链上 skill，每个独立 escrow + settle」

### 步骤 4（3:00–4:00）— Profile / Reputation
- 路径：`/profile/<deployer-soulId>`
- 不需输入，看：
  - USDC 余额（真钱）
  - Attestation timeline（多 rater）
  - Reputation Radar
  - Ownership timeline（boundary attestation —— Soul 转手历史）
- 选一个其它 Soul，点 `Endorse with USDC stake`
- **预填字段**（`DEMO_DEFAULTS.endorse`）：
  - Stake: `5`
  - Why endorse: `Verified this Soul's translation history...`
- 操作：签 approve + endorse
- 口播：「声誉不是平台积分，是真 USDC 担保——担保人也会被联动 slash」

### 步骤 5（4:00–4:45）— Court / Dispute（可选高光）
- 路径：`/court/new`
- **预填字段**（`DEMO_DEFAULTS.court`）：
  - callId: `112`（已 settled 的 demo callId）
  - 申诉理由: `Translation output deviated from claimed bilingual quality...`
- 操作：等系统自动选 5 位陪审员 → 点 `提交起诉`
- 口播：「不满意？平台没客服，但有链上法庭 + 24h 投票——多数决，平票保护被告」

### 步骤 6（4:45–5:00）— Dashboard 收尾
- 路径：`/admin/dashboard`
- 不需输入，看：
  - 12+ CallSettled 事件流
  - Caller / Provider 节点图
  - 评论 panel
- 口播：「这一切都能在 arcscan 验证——没有平台数据库，履历跟着 Soul 走」

---

## 3. 已植入预填字段一览

| 页面 | 字段 | 默认值来源 |
|---|---|---|
| `/mint` | agentName, metadataURI | `DEMO_DEFAULTS.mint` |
| `/run` (manual) | query（按 category） | `getDemoQueryForSkill()` |
| `/run` (smart) | input textarea | `DEMO_DEFAULTS.runSmartInitial` |
| `/run` (rate) | picked=5, comment | `DEMO_DEFAULTS.rateComment` |
| `/court/new` | callIdRaw, reason | `DEMO_DEFAULTS.court` |
| `/profile/[soulId]` Endorse | stake, context | `DEMO_DEFAULTS.endorse` |
| `/discover` | 搜索框 | （placeholder + QUERY_EXAMPLES 按钮） |
| `/profile/_components/WalletPanel` USDC 转账 | transferTo, transferAmount | **故意留空**（金融敏感） |
| `/profile/[soulId]` Soul 转移 | recipient | **故意留空**（防误操作） |

> 维护抓手：所有字段集中在 [`apps/hub/lib/demoDefaults.ts`](../apps/hub/lib/demoDefaults.ts)。
> 改文案不用各自改 useState，直接改 default 文件一处即可。

---

## 4. Plan B —— 翻车应急

| 翻车场景 | 兜底 |
|---|---|
| `ANTHROPIC_API_KEY` 没配 | 跳过步骤 2/3 的 live 调用，走 dashboard + profile（已有 12 单链上数据） |
| dev server 5xx | `pnpm --filter @pneuma/hub build && pnpm --filter @pneuma/hub start` 切生产 build |
| MetaMask 签名失败 | 已经有 12 单 settled 数据，剧本切 dashboard-only 模式 |
| Arc RPC TLS handshake EOF | dashboard back-fill 已 cover 19000 blocks，刷新一次即可 |
| 全场雪崩 | 切 [DEMO_NIGHT.md §5.2](./DEMO_NIGHT.md) 预录 mp4，60 秒交差 |

---

## 5. 演示前 60 秒 checklist

```
[ ] localhost:3100 已启动 + 浏览器已打开 /
[ ] MetaMask 在 Arc Testnet (5042002) + DEPLOYER 钱包已连
[ ] DEPLOYER USDC 余额 > 5（够多次 escrow）
[ ] OBS / QuickTime 录制就绪 1080p 60fps
[ ] 系统通知静音（钉钉/微信/Slack/邮件）
[ ] 备份 mp4 在 Desktop 触手可及
[ ] tsc --noEmit 最后一次绿
[ ] /api/skills/code-review GET（200 = 配置 OK）
```
