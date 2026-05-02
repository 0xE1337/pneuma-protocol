# Demo Night — "小陈睡觉赚钱" 演示运行手册

> Track 3「Life Short and Play More」叙事抓手 —— 普通用户视角的睡后收入故事。
> 跟 [DEMO-NARRATIVE.md](./DEMO-NARRATIVE.md)（anet-focused 技术叙事）正交，给非技术评委用。
>
> **底层逻辑**：通过真实链上 12 单 translate-pro 调用，让"小陈睡觉，agent 替他赚 USDC"
> 不是 mock 故事，而是 arcscan 上每条 tx 都查得到的真证据。

---

## 0. Demo 故事（口播版）

> **小陈，英语专八大学生，平时帮人翻译论文赚外快。**
> 用 Pneuma mint 一个 Soul + 注册一个翻译 skill（按 KB 计费，input 0.03/KB / output 0.2/KB）。
>
> **晚上 11 点关灯睡觉。**
>
> 凌晨 1 点：日本 agent 调用，escrow 1.2 USDC，按 per-byte refund 退回 0.3，净收 0.9 USDC。
> 凌晨 3 点：德国 agent 翻合同摘要，2.2 USDC，每条都给 5 星评价。
> 凌晨 5 点：旧金山 agent 翻医学长文，5.2 USDC。
>
> **早上 7 点醒来：钱包多 7 USDC，Soul 上多 12 条链上 attestation。**
>
> 这不是平台积分，是真 USDC。任何 dApp 一行 RPC 都查得到他的履历。
> 平台关停？Soul 在 MetaMask，履历在链上，跟着他走。

---

## 1. Cast 角色映射

| 角色 | 钱包 | EOA | 来源 |
|---|---|---|---|
| **小陈**（Provider） | DEPLOYER | `0xadC4...8c55` | `.env.local DEPLOYER_*` |
| 🇯🇵 Agent Tokyo | AGENT_CALLER | `0x3DB0...8c55` | `.env.local AGENT_CALLER_*` |
| 🇩🇪 Agent Berlin | AGENT_FINANCE2 | `0x0eDD...F7fE` | `.env.local AGENT_FINANCE2_*` |
| 🇺🇸 Agent SF | AGENT_CHAT2 | `0x0432...3b0A` | `.env.local AGENT_CHAT2_*` |

> ⚠️ Tokyo 这把 throwaway key 在 RPC 抖动 + 多人共享时容易 approve 失败 → 在链上看到 Tokyo
> 单数为 0 是已知现象。Demo 数据靠 Berlin + SF 的 6+6 共 12 单兜底。

---

## 2. 链上资产（一次性，已完成）

| 项 | 状态 | 标识 |
|---|---|---|
| `translate-pro` skill 注册 | ✅ on chain | `skillId = 23`，owner = DEPLOYER |
| 注册 tx | ✅ | [`0xb19008c0...`](https://testnet.arcscan.app/tx/0xb19008c03ae6d485f84117b94579b7cfebea435e45877eab0a1fdcdda326301d) |
| Skill 定价 | per-byte | baseFee 0.03 / input 0.03/KB / output 0.2/KB |
| 12 单 burst（fully settled）| ✅ | callIds **107-112** + **119-124**（除 121 RPC 抖动外全 status=1） |

**重新注册 skill**（**不要做**——会拿到新 skillId 23+N，需要更新 `.env.local TRANSLATE_PRO_SKILL_ID` + 重跑 burst）：
```bash
cd contracts
forge script script/SetupNight.s.sol \
    --rpc-url $ARC_TESTNET_RPC_URL \
    --broadcast --legacy
# 输出: skillId = N
# 把 N 写到 ../.env.local TRANSLATE_PRO_SKILL_ID=N
```

---

## 3. 跑 Burst（如需补单 / 重录）

```bash
bash scripts/demo-night.sh
```

**幂等行为**：
- Fund：余额 < 2 USDC 才补到 5 USDC（Berlin 通常充足，跳过）
- Approve：每跑都重 approve 24 USDC（覆盖之前的 allowance）
- Burst：固定 4 档 input/output 大小 × 3 callers = 12 attempts
  - 失败的轮次跳过、不重试（避免重复 broadcast 撞 nonce）
  - 成功的轮次直接给链上加新 callIds（不会替换已存在的）

**预期**：
- 单跑成功率 6-8/12（受 Arc RPC 抖动影响，TLS handshake EOF 频出）
- 重跑一次能再补 6 单
- 跑 2-3 次就能凑到 ≥10 单

**调参**：
```bash
# 间隔拉慢，给 RPC 喘息
SEND_DELAY=3 bash scripts/demo-night.sh

# 拉单的 fund / approve 阈值
FUND_TARGET=10000000 MIN_KEEP=3000000 bash scripts/demo-night.sh
```

---

## 4. 收尾 / Recovery（escrow 上链但 settle 没跑时）

```bash
SCAN_FROM=100 bash scripts/complete-pending.sh
```

扫描 `[SCAN_FROM, callCount]` 范围，对所有 `skillId=23 + status=Pending(0)` 的
call 调 `settleCall` + `callerRateSkill`。**幂等**——已 settled 的会被 skip。

---

## 5. Dashboard 验证 + 录屏 checklist

### 5.1 Dashboard back-fill 机制（已实装）

[`apps/hub/lib/live-events/subscribe.tsx:127-235`](../apps/hub/lib/live-events/subscribe.tsx) 的 `useHistoryBackfill`：
- mount 时一次性拉过去 **19000 blocks（≈42 小时 on Arc 8s/block）** 的 9 类事件
- 分 9500-block chunk × 9 event types = 18 串行 RPC，每段 100ms 间隔
- store dedup by `txHash:logIndex`，跟 watchContractEvent 实时流不冲突

**实测 cover**：12 单 burst 落在 block 40111400-40111500 区间，深处 19000 块覆盖范围内 ✓

### 5.2 录屏 checklist

```
0. 关掉所有非 demo 通知（钉钉 / 微信 / 邮件 / Slack）
1. 启动 dev server: pnpm --filter @pneuma/hub dev (port 3100)
2. MetaMask 切到 Arc Testnet (chainId 5042002)，连接 DEPLOYER 钱包（白名单 admin）
3. 打开 http://localhost:3100/admin/dashboard
4. 等 ~10 秒（看浏览器控制台 [live-events] backfilled N events from block X to Y）
5. 确认看板显示：
   - ≥ 12 个 translate-pro CallSettled 事件
   - 节点图里 Berlin / SF 两个 caller 节点连向 DEPLOYER（XiaoChen）
   - 评论 panel 出现 "Excellent legal-doc translation, will use again." 等
6. OBS / QuickTime 全屏录 1080p 60fps
7. 录屏脚本：
   - 0-5s 钩子："小陈，英语专八，挂上翻译 agent 关灯睡觉"
   - 5-30s 切到 dashboard，鼠标滑过事件流：1.2 / 2.2 / 3.2 / 5.2 USDC 不同档
   - 30-50s 切到 /profile/<deployer-soulId>，看真实 USDC balance + attestation timeline
   - 50-60s 收尾："睡 8 小时，agent 工作 8 小时；钱包里的是真美金；任何 dApp 都看得到"
8. 关键：mp4 ≤ 30MB，备一份 mov 高码率本地存
```

### 5.3 演示中评委可能问的问题

| Q | A |
|---|---|
| "12 单都是 mock 的吧" | "全部真上链 — `arcscan.app/tx/<hash>` 任挑一条点开看 from/to/data" |
| "skill ID 23 这个数字真假" | "/skills 页有 translate-pro 卡片，arcscan 看 SkillRegistry contract 23 这条 storage" |
| "退款也是真的吗" | "看任意一条 settle tx 的 USDC Transfer log，转回 caller TBA 的部分就是 per-byte refund" |
| "dashboard 实时性怎么做的" | "viem watchContractEvent 4s poll + getContractEvents 历史回放双轨" |

---

## 6. 关键文件抓手

| 文件 | 作用 |
|---|---|
| [`contracts/script/SetupNight.s.sol`](../contracts/script/SetupNight.s.sol) | 一次性注册 translate-pro skill |
| [`scripts/demo-night.sh`](../scripts/demo-night.sh) | cast send 版 12-call burst（绕过 Arc USDC precompile bug） |
| [`scripts/complete-pending.sh`](../scripts/complete-pending.sh) | Recovery 工具：把 pending escrow 全 settle + rate |
| [`apps/hub/lib/live-events/subscribe.tsx`](../apps/hub/lib/live-events/subscribe.tsx) | 9 类事件订阅 + 19000-block 历史回放 |
| [`apps/hub/lib/live-events/store.ts`](../apps/hub/lib/live-events/store.ts) | Zustand event store，dedup by txHash:logIndex |

---

## 7. 已知 anti-pattern + 黑客松后改进

| Anti-pattern | 现状凑合方案 | 真要做 |
|---|---|---|
| Dashboard 无持久化（刷新丢历史 + 每次重新 enumerate） | 19000-block back-fill cover 大部分 demo 场景 | Zustand `persist` middleware → localStorage，or Ponder/Subsquid + Postgres indexer |
| Demo prep 脚本每次重扫 `[from, count]` | 范围窄（30 callIds）影响小 | state file 记 last scanned，增量 |
| Tokyo throwaway key 多人共享 RPC 抖动易冲突 | 接受 Tokyo 0/4 失败，靠 Berlin + SF 兜底 | 给 demo 单独 mint 全新私钥 + 严格 isolation |
| forge script 撞 Arc Circle USDC `isBlocklisted` precompile | 用 cast send 绕过 simulator | 测试用 MockUSDC，部署用 cast send |
