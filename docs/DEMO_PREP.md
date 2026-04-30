# Pneuma Demo Prep Checklist

> 黑客松演示前 **必须** 跑完的清单。预留 30-45 min。
>
> 跟 `DEMO_SCRIPT.md` 配合使用。

---

## A. 钱包 & 链准备（10 min）

- [ ] **钱包 1 — "Provider Bob"** 私钥保存安全
  - [ ] MetaMask 切到 Arc Testnet（chainId 5042002）
  - [ ] 余额 ≥ 50 USDC（Circle faucet: https://faucet.circle.com）
  - [ ] 余额 ≥ 0.01 native gas
  - [ ] **已 mint Soul**（访问 /mint，记下 tokenId 和 TBA）
- [ ] **钱包 2 — "Caller Alice"** 私钥保存安全
  - [ ] MetaMask 切到 Arc Testnet
  - [ ] 余额 ≥ 200 USDC
  - [ ] 余额 ≥ 0.01 native gas
  - [ ] **已 mint Soul**

> 两个钱包都要持 Soul，否则 Endorse / Publish / Cite 会 revert（合约层 `NotSoulHolder`）。

---

## B. 合约部署（一次性 · 5 min）

```bash
cd contracts

# 1. 配置 .env
cp .env.example .env.local
# 编辑 .env.local 填入：
#   DEPLOYER_PRIVATE_KEY=...
#   USDC_ADDRESS=0x3600000000000000000000000000000000000000
#   ARC_TESTNET_RPC_URL=https://...

# 2. Deploy 全部合约
forge script script/Deploy.s.sol \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --legacy

# 3. 把输出的 8 个 NEXT_PUBLIC_* 地址写入 apps/hub/.env.local
```

**预期输出**：
```
SoulNFT:           0x...
PneumaAttestation: 0x...
SkillRegistry:     0x...
BudgetController:  0x...
PneumaTimelock:    0x...
PneumaCommons:     0x...   ← V6.0.1 新增
ReputationGraph:   0x...   ← V6.0.2 新增
SoulAccount:       0x...
```

**验证**：
- [ ] 8 个地址都打印出来
- [ ] "Wired SkillRegistry <-> ReputationGraph (slash linkage)" 在日志
- [ ] "Wired SkillRegistry <-> BudgetController" 在日志
- [ ] arcscan 上每个合约都有 verified bytecode

---

## C. Skills 注册（5 min）

```bash
forge script script/RegisterSkills.s.sol \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --legacy
```

**预期**：5 个 skill 注册成功
- V4 Finance Oracle (id 1)
- V4 Text Summarizer (id 2)
- V5 chat-short (id 3)
- V5 chat-medium (id 4) ← demo 主要用这个
- V5 chat-long (id 5)

**验证**：
- [ ] 访问 https://[demo-url]/skills
- [ ] 看到 5 张卡片
- [ ] V5 卡片显示 "V5 per-byte" badge + "Powered by claude-sonnet-4.5" + markup 25%

---

## D. Demo 数据 Seed（V6.0 新增 · 3 min）

```bash
forge script script/SeedDemo.s.sol \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast --legacy
```

**预期**：
- 3 publications 上链
- 1 self-citation (p2 → p3) 让 Commons 不空 + 给"live cite"做前置数据点

**验证**：
- [ ] 访问 https://[demo-url]/commons
- [ ] 顶部 stat：3 publications, 1 citation
- [ ] 列表 3 张卡片：article / prompt / case-study
- [ ] case-study "V5 Per-Byte Refund Pricing" 显示 cited 1

---

## E. Frontend 启动（5 min）

```bash
cd apps/hub

# 配置 .env.local 用 D 步骤拿到的 8 个合约地址
cat > .env.local <<EOF
NEXT_PUBLIC_USDC_ADDRESS=0x3600...
NEXT_PUBLIC_SOUL_ACCOUNT_IMPL=0x...
NEXT_PUBLIC_SOUL_NFT_ADDRESS=0x...
NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS=0x...
NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS=0x...
NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_PNEUMA_TIMELOCK_ADDRESS=0x...
NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS=0x...
NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS=0x...
EOF

pnpm dev
```

**验证**：
- [ ] http://localhost:3000 打开
- [ ] /skills 看到 5 个 skill
- [ ] /commons 看到 3 publications
- [ ] /profile/[soulId] 看到 Soul + Knowledge Commons 区块（如果 deployer 持 Soul）

---

## F. 演示前 5 分钟最后检查

- [ ] 浏览器开 4 个 tab：
  1. `/skills`
  2. `/commons`
  3. `/profile/[Provider Bob's Soul ID]`
  4. README 的 Roadmap 章节（备用）
- [ ] MetaMask 默认账号设为 "Caller Alice"（demo 第一段以 Alice 为主视角）
- [ ] 每个钱包 USDC > 100，gas > 0.01
- [ ] 关闭所有 distract 通知（钉钉 / 微信 / 邮件）
- [ ] **录屏开启**（OBS / QuickTime）
- [ ] 准备一段 "网络炸了" 的备用录屏
- [ ] DEMO_SCRIPT.md 在另一台设备打开（或纸质打印）

---

## G. 演示当中的错误处理

### "Endorse 按钮没显示？"
检查：当前钱包 ≠ Soul 持有者 + 当前钱包持 Soul（balanceOf > 0）。

### "Publish 一直 pending？"
- gas 设太低了？提高 gas
- USDC approve 没确认？打开 MetaMask 看 pending tx
- 如果超 1 分钟无响应：取消 tx（speed up），重试

### "Citation 红色数字没增加？"
- 链上 tx 已确认但前端没刷新：手动刷新页面
- refetchInterval 默认 8s，等一下应该自动刷新

### "BackedByBadge 没出现？"
- 担保 tx 真的成功了吗？检查 arcscan
- skill owner 跟 endorsee 是同一地址吗？
- 缓存：硬刷新（Cmd+Shift+R）

### "Slash linkage 想现场触发？"
- 不推荐 demo 现场触发（需要等 SLA timeout 或者制造 dispute）
- 改用 README §9 中的逻辑图静态讲解

---

## H. 演示后

- [ ] 保存录屏到 `~/Desktop/pneuma-demo-[date]-final.mov`
- [ ] 关键 tx hash 整理到 `docs/DEMO_TX_LOG.md`
- [ ] 评委反馈记录（哪个故事打动 / 哪里没讲清）
- [ ] 复盘：是否需要调整下次演示的 narrative
