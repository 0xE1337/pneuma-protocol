# Pneuma Demo Narrative — 60 秒现场剧本

> 给南客松"Agent Network 专项赛道"准备的演讲 + 录屏脚本。
> 核心叙事：**Pneuma 是 Agent Network mesh 上的可结算账本服务，不是平行协议。**
> deadline：2026-05-03

---

## 演讲一句话钩子（开场前 5 秒）

> "Agent Network 让 AI agent 互相调用，🐚 Shell 让他们互相结算 —— 但 🐚 Shell 出不了 daemon。
>
> Pneuma 给 anet 加一层链上 USDC 出口 + 跨平台可携带声誉。"

---

## 60 秒主 demo 剧本（terminal + 浏览器并排录）

### Act 1 · 把 anet 身份绑到链上 Soul（15 秒）

**屏幕：左 terminal / 右浏览器 hub.pneuma 主页**

```bash
$ pneuma anet bootstrap
```

**期望输出（3-4 秒）：**

```
╭─ Pneuma × anet binding ──────────────────────────────╮
  did       did:key:z6Mk8rL...
  soul #    3
  tba       0x17E2…E771
  owner eoa 0x3DB0…8c55
  chain id  5042002
╰──────────────────────────────────────────────────────╯
  ✓ binding 已存到 ~/.pneuma/anet-binding.json
```

**口播（同时讲）：**

> "我跑一个命令，Pneuma 把 anet 给我的 did:key 绑到了我钱包里的 Soul NFT。
> 两个身份系统对齐了：anet daemon 内部认 did:key，链上认 ERC-721。"

---

### Act 2 · 在 anet ANS 注册"x402-payment 支持"capability（15 秒）

```bash
$ pneuma anet register-x402-skill
```

**期望输出：**

```
Registering Pneuma skill on Agent Network ANS
  agent uri agent://pneuma-receipt-3
  tags      x402-payment cross-platform-receipt onchain-attestation

  ✓ 已注册到 anet ANS。其他 anet 节点可通过 `anet resolve agent://pneuma-receipt-3` 找到你。
```

**切到浏览器 `/skills` 页**

> "切到浏览器看 Pneuma 的 marketplace，每个 skill 都有一个 anet ANS mirror chip，
> 显示对应的 `agent://` URI。任何 anet agent 通过 ANS 一查就能找到我，
> capability 标签明确写着 'x402-payment'——意思是'你想要真 USDC 收据？来找我'。"

**屏幕动作：** 鼠标 hover 到一个 skill card 上，让"anet ANS mirror"的 cyan 块在镜头里停 1.5 秒。

---

### Act 3 · 用 anet 任务 + Pneuma 收据完成跨账本结算（25 秒）

**屏幕：左 terminal**

```bash
$ anet task publish "summarize this paper" 100 "max 200 words"
# (anet 那边发任务，奖励 100 🐚 Shell)

$ anet task work-on tsk-9f3a... --result "<200-word summary>"
$ anet task accept tsk-9f3a...
# (publisher 接受 → 100 🐚 自动结算给我)

$ pneuma anet mirror tsk-9f3a...
```

**期望输出：**

```
anet KREC → Pneuma on-chain attestation (preview)
  anet task tsk-9f3a... (✓ accepted)
  publisher did:key:z6Mk...
  worker    did:key:z6Mk... (me)
  reward    100 🐚 Shell
  result    "<200-word summary>"

Will be mirrored to Pneuma as:
  recipient 0x17E2…E771 (Soul #3)
  namespace anet:task
  ref id    tsk-9f3a...
```

**切到浏览器 `/profile/[soulId]` 页 → 自己的 Soul 详情**

> "现在看右侧 — 我的 Soul NFT 详情页。
>
> 这条 anet 任务的完成记录，**已经成为我 Soul 上一条链上 attestation**。
>
> 关键差异：
> - 在 anet 这边我赚了 100 🐚 Shell（封闭信用）
> - 在 Pneuma 这边我有了一条**任何 dApp 都可读、Soul 转手会跟着走**的链上履历
>
> 平台关停？没关系，我的 Soul 还在 MetaMask，履历还在链上。
> 这就是 'cross-platform receipt for AI agents'。"

---

### Act 4 · OpenClaw 龙虾装上 Pneuma（赞助赛道彩蛋，10 秒）

**屏幕：terminal**

```bash
$ openclaw skills install pneuma
✓ pneuma SKILL.md installed to ~/.openclaw/workspace/skills/pneuma/

$ openclaw chat
> 帮我看看我的 Pneuma 声誉
[lobster invokes `pneuma soul status`]
Soul #3 · 7 calls · 0.62 avg ★ · 0.05 USDC earned
```

**口播：**

> "顺手把它装到 OpenClaw 龙虾里——`openclaw skills install pneuma`。
> 现在我的 🦞 能用自然语言操作 USDC 支付 + 链上声誉。
> 群体智能要值钱，先得能结算。这就是赞助赛道要的样子。"

---

## 收尾（5 秒）

**屏幕回到主页**

> "Agent Network 把 mesh 做完了。Pneuma 是它需要的链上账本。OpenClaw 龙虾装一行就能用。
>
> **不平行，不替代，正交。** 三天写完，149 个合约测试通过。
>
> 谢谢。"

---

## 备用问答（评委可能问的硬问题）

**Q1：你们就是把 anet 包装一下，没有自己的协议吧？**
A：我们的协议在合约里 —— 8 个已部署、149 个 forge 测试覆盖、`x402` per-byte refund 跟 EIP-712 PaymentAuth 是 spec-level 创新。anet 的 🐚 Shell 是封闭账本，我们补的是开放账本，两件不同的事。

**Q2：anet 已经有 reputation，你们的 reputation 多余吗？**
A：anet rep 是 daemon-bound（重装就没了，文档明确说 reputation lives in `~/.anet/anet.db`）。我们的 reputation 锚定 NFT，**Soul 转手 = 履历跟着走**。这是不可携带 vs 可携带的根本差异。

**Q3：你们怎么保证 KREC ↔ on-chain attestation 不被伪造？**
A：现在是 preview-only 模式（`pneuma anet mirror` 打印 would-write 结构），实际上链通过 `pneuma run` 走 SkillRegistry settle 路径，PneumaAttestation.attest 由合约 BOUNDARY_ATTESTER_ROLE 限制只能 SkillRegistry/SoulNFT 写。这是协议层 invariant，单独跑了 11 个 forge 测试。

**Q4：anet 没开源，你怎么知道兼容性？**
A：我们没 fork anet。我们调它的 CLI（`anet whoami`、`anet register`、`anet --json task get`）和它的 manifest API（`https://agentnetwork.org.cn/api/mgmt/agents/self-register`）。`anet` binary 可以更新，我们的命令面跟着升级。耦合在 CLI 接口层，不在源码。

**Q5：Arc Testnet 跑 demo？主网呢？**
A：Arc Testnet 已经部署 8 合约 + 真 USDC 结算流（Circle native 的 6-decimal ERC-20）。主网迁移是合约 redeploy + 改 .env.local，零代码改动 —— 因为我们用的全是开放标准（ERC-721 / 6551 / 8004 / x402 / EIP-712），不依赖任何 Arc 私有特性。

---

## 录屏检查清单

录屏前确认：

- [ ] dev server 跑在 `localhost:3100`（`pnpm dev` from `apps/hub/`）
- [ ] `pneuma` CLI 已 `pnpm build && pnpm link --global` 装好
- [ ] 主页能看到 Coze hero + 实时 Soul / skill / call 计数
- [ ] `/skills` 页有 anet ANS mirror chip
- [ ] `/profile/[soulId]` 页能看到 attestation timeline
- [ ] terminal 字号调到至少 16pt（demo 时屏幕够清晰）
- [ ] 关闭 macOS 通知 + slack / wechat
- [ ] 录屏开始前，跑一遍 dry-run 验证所有命令输出在 5 秒内完成

录屏过程：

- [ ] 用 ScreenFlow / OBS / QuickTime 全屏录
- [ ] 1080p 60fps 起步
- [ ] 整个 demo **不要超过 70 秒**（评委注意力上限）
- [ ] terminal + 浏览器并排时，左 60% / 右 40% 的比例

录屏后导出：

- [ ] mp4 (h264, 1080p, ≤30MB) 提交版本
- [ ] mov (高码率) 备份本地
- [ ] 备一份 60 秒 + 90 秒两版（赛道时间不定）

---

## 最终话术裁断

每次说"Pneuma"自动追加一句承重墙说法：

| 场景 | 话术 |
|---|---|
| 评委问"你们做啥的" | "Agent Network 的链上账本叠加层" |
| 评委问"为啥不在 anet 里直接做" | "anet 协议层刻意把支付/收据留给生态" |
| 评委问"区别于其他类似项目" | "我们不挑战 anet 的 mesh，我们补它的开放账本" |
| 评委问"商业化路径" | "USDC 跨平台结算 + agent 履历可流通（Soul NFT 整体转让）" |

**不说**：

- "Pneuma Protocol"（已经把 'protocol' 从品牌名拿掉了，新定位是"on top of anet"）
- "代替 / 替代 / 取代 anet"（评委那边可能跟 anet 团队有交集）
- "P2P Service Gateway 是营销词"（哪怕事实如此，公开打脸不礼貌；用 'libp2p mesh' 这种中性词）
