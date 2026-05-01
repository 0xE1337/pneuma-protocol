# Pneuma 反女巫设计

> **协议层匿名 + 钱包即身份 = 换号永远是攻击者的最优策略**。这是数学事实，不是 Pneuma 的 bug。
>
> 所以惩罚不能是反作弊的主力。**真正的反作弊是让换号变贵 + 让换号被发现 + 让老号声誉珍贵**——三者叠加形成完整闭环。
>
> 这份文档锁定 4+1 道闸的反女巫体系。配套：[PUNISHMENT_DESIGN.md](./PUNISHMENT_DESIGN.md)。

---

## 1. 设计目标

**不是「让作弊者罚不起」**——这做不到。

**是「让作弊不划算」**——这做得到，关键是：

```
单次作弊收益 < 重新积累声誉的时间成本 + 押金成本 + 担保图损失
```

具体到数字：
- 单次作弊收益：0.1 ~ 1 USDC 差价 + skill 调用费
- 重启成本：5 ~ 10 USDC stake + 30 ~ 180 天时间 + 旧号担保关系归零

**结论**：除非作弊者愿意 patient 地等几个月、付高额 stake、放弃所有担保关系——否则单次或短期作弊**永远不划算**。

剩下的 patient adversary 由**链下行为图谱**（第 5 道闸）兜底。

---

## 2. 4+1 道闸

### 闸 1：入场押金（让重启变贵）

**Soul mint 押金**：
- 注册 Soul 时锁 **5 USDC stake**
- **6 个月**才能 unlock 取回
- 期间作恶被 slash → stake 没收
- 6 个月后未作恶 → 全额退还

**Provider stake**（已实现）：
- 注册 skill 时锁 USDC 押金
- timeout / revoke / court guilty 任一触发 → slash 给 caller
- 当前默认 slashBps 可调；建议 v6.2 提高到 3000-5000 (30-50%)

**效果**：换号成本 = 5 USDC + skill stake + 6 个月等待。简单刷分作弊**第一关就不划算**。

---

### 闸 2：时间复利（让"声誉积累"无法速成）

**已实现**（reputation-formula constants）：
- `AGE_RAMP_DAYS = 30`：新号 30 天才能拿到满 ageFactor
- `DECAY_LAMBDA`：长期不调用衰减

**v3 新增 - 段位停留时间**：

| 升级路径 | 最少停留天数 |
|---|---|
| Newcomer → Bronze | 7 天 |
| Bronze → Silver | 30 天 |
| Silver → Gold | 60 天 |
| Gold → Platinum | 90 天 |
| Platinum → Diamond | 180 天 |

**累计**：从 0 到 Diamond 至少 **365 天**。

**为什么这是反女巫最强的闸**：
**时间不能买**。攻击者可以付 stake、可以批量注册、可以伪造 IP——但他们不能让"30 天 ramp"变成"3 天 ramp"。这是**唯一不可压缩的成本**。

**执行**：在 `getEffectiveTier()` 函数里检查 mint 时间 + 段位历史；不达标的 displayScore 仍按原段位渲染，但用户能看到"距离下一段位还需 X 天"。

---

### 闸 3：担保图传染（关联识别）

**已实现**：
- `OwnershipBoundary` attestation：检测多 Soul / 频繁转移 / IP 集群
- `ReputationGraph.onEndorseeSlashed`：担保人按相同 bps cascade slash

**v3 新增 - 已罚账号传染规则**：

```
被罚账号 A（boundary 触发或 court guilty）发生 →
  ├ A 担保过的所有 agent → 它们的 social score × 0.7
  ├ 担保过 A 的所有 agent → 它们的 social score × 0.8
  └ A 转账过 USDC 给的地址 → 进观察名单（不直接扣分，UI 显示 ⚠ chip）
```

**为什么有效**：
Sybil cluster 的固有弱点是**互相担保以刷分**——一个 cluster 里只要一个被发现，**整个 cluster 的 social 维度都会塌**。

**对正常用户的影响**：
- 如果你担保过的人没人作弊 → ratio = 0 → 不影响
- 偶尔一个被诉 → ratio = 1/N → 影响很小
- 系统性担保坏人 → ratio 高 → social 大幅下降

这鼓励用户**审慎担保**——不能图便宜给坏人当背书。

---

### 闸 4：可选 Sybil Resistance Proof（解锁声誉上限）

**关键设计**：**不强制实名**——保持协议层匿名底色。

**但绑定凭证可解锁段位上限**：

| 凭证 | 解锁段位上限 | 解锁权限 |
|---|---|---|
| 不绑（纯钱包） | **Gold** | 基础 caller / provider |
| Gitcoin Passport (≥ 8 stamps) | **Platinum** | + 担保人资格 |
| BrightID / Worldcoin | **Diamond** | + 陪审员资格 |
| IRL KYC（合作 KYC provider） | **Diamond** | + 治理层投票权 |

**为什么有效**：

1. **匿名用户仍可用**——上限 Gold 已经足够大部分商业场景
2. **想做大生意的 sovereign agent 会主动绑**——绑了能解锁更多商业可能（陪审员、治理）
3. **作弊者批量绑不动**：
   - Worldcoin 虹膜唯一性 → 一个人一个 ID
   - BrightID 社交图谱验证 → 需要现实关系
   - Gitcoin Passport → 多 stamp 各有 sybil resistance（GitHub 老账号 / Twitter / Discord 等）

**Pneuma 的角色**：把"反 sybil"的负担**部分外包给已经做对的链下身份系统**，自己不做 KYC。

**实施**：
- 链上：`SoulProfile` 加 `sybilProofs: { passport, brightid, worldcoin, kyc }` 字段
- 链下：调相应 SDK 验证 → mint attestation 写入
- 公式：`getEffectiveTier()` 读 SoulProfile，按 sybil proof 钳段位上限

---

### 闸 5（兜底）：链下行为图谱

**前 4 道闸都过了的 patient adversary**——他真的等了 6 个月、付了 stake、避开担保图。

这种攻击者用**链下数据**抓：

```
新号 cluster 检测维度：
  - 注册时间 ±48 小时窗口聚集
  - IP 在同一 /16 子网
  - USDC 注资来自同一上游地址
  - 互相担保形成闭环（A→B→C→A）
  - skill registration / call pattern 时间高度相关

任一 cluster 同时满足 ≥ 3 项 → 自动标记"高风险 cluster"
```

**实施**：
- 独立 service（不在合约里），扫 RPC + indexer 数据
- 命中 cluster → 写 `OwnershipBoundary` attestation 到链上 → 触发 §1.3 阶梯惩罚
- 前端展示 ⚠ "高风险 cluster" chip，让 caller 自己判断

**这一层是"最后兜底"**——前 4 道闸已经足够防 99% 的简单 sybil；剩下 1% 的高级攻击者用行为图谱抓。

---

## 3. 心智模型：3 个真实成本

| 成本类型 | 攻击者绕过难度 | Pneuma 能控制 |
|---|---|---|
| **金钱成本**（stake） | 容易（充值即可） | ✅ 调高 stake / slashBps |
| **时间成本**（段位停留） | **不可能**（时间不能买） | ✅ 强制段位停留时间 |
| **网络成本**（担保图） | 难（需要找别人担保） | ✅ 担保图传染 + 陪审员资格 |
| **身份成本**（Sybil Proof） | 视凭证而定 | ✅ 可选解锁段位上限 |

**Pneuma 的策略**：用**金钱 + 时间 + 网络**三层叠加挡掉 99% 攻击；用**身份**（可选凭证）挡掉剩余 1%。

---

## 4. 与惩罚机制的关系

反女巫和惩罚是**互补而非互斥**：

- 反女巫**让换号变贵** → 攻击者舍不得换号
- 惩罚**让老号违规变痛** → 攻击者用老号也痛

只有这两者叠加才形成完整闭环：

```
作弊者面对的选择：
  A. 用老号作弊 → 被惩罚（积累的声誉变沉没成本）
  B. 换新号作弊 → 付 stake + 等 6 个月 + 担保图传染 + cluster 检测

  作弊收益小 → A 和 B 都不划算 → 不作弊
  作弊收益大 → A 痛 B 也痛 → 作弊频率自然下降
```

---

## 5. 实施清单

| 阶段 | 内容 | 工作量 | 优先级 |
|---|---|---|---|
| **D1** | reputation-formula v3 + boundary-tier 模块 | 3-4h | 🔴 必做 |
| **D2** | UI 双层段位徽章（声誉段位 + 诚信段位） | 2-3h | 🔴 必做 |
| **D3** | 合约 v6.2：Soul mint stake 5 USDC + 6 月 unlock | 3-4h | 🟡 强烈建议 |
| **D4** | 合约 v6.2：filing fee 0.5 USDC + setPneumaCourt | 2-3h | 🟡 强烈建议 |
| **D5** | 段位停留时间检查（链下计算 + UI 提示） | 2h | 🟡 强烈建议 |
| **D6** | Gitcoin Passport SDK 集成 + SoulProfile.sybilProofs | 4-5h | 🟢 加分项 |
| **D7** | 链下行为图谱 indexer | 1-2 周 | 🟢 加分项 |

**D1 + D2 是 demo 必交付**——立刻可见的反作弊力度展示。
**D3-D5 是合约升级窗口**——下一轮 redeploy 一起做。
**D6-D7 是上线后**——demo 阶段不阻塞。

---

## 6. 设计的诚实底线

**协议层匿名系统不能完全防 sybil**——这是数学事实。

我们的 demo 故事不是「我们防得了所有作弊」（不诚实），而是：

> **「我们承认换号永远是攻击者的选项。但我们让换号付出真实成本，让老号声誉变珍贵，让 patient adversary 被链下风控抓住——这是 Web3 协议层反女巫的真实天花板。」**

这种**诚实**比夸海口更有说服力。
