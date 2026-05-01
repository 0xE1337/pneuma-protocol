# Pneuma 惩罚机制设计

> 协议层匿名系统的惩罚不是为了"罚到攻击者破产"——那做不到，因为换号永远是攻击者的最优策略。
>
> 惩罚的真正作用，是让**已积累的声誉变成沉没成本**——只有舍不得换号的人才会被惩罚震慑。
>
> 这份文档锁定 Pneuma 的惩罚分层、阶梯、时间窗口、申诉路径。配套文档：[ANTI_SYBIL_DESIGN.md](./ANTI_SYBIL_DESIGN.md)（让换号变贵）。

---

## 1. 三类违规、三套阶梯

不同性质的违规要走不同的惩罚通路。一刀切会出现"差评 = 法庭 = 反洗白"，公平和震慑都失效。

| 违规类型 | 严重度 | 触发器 | 是否需要法庭 | 惩罚通路 |
|---|---|---|---|---|
| **Caller 差评（≤ 2 ★）** | 🟡 服务质量差 | caller 评分写入 PneumaAttestation | ❌ 否 | **软惩罚**：进 reputation 公式（CALLER 1.5×），不动 stake |
| **Court guilty 裁决** | 🟠 明显错误 | 多陪审员投票 → guilty | ✅ 需法庭 | **中硬惩罚**：扣分 + 段位 hard cap + 担保人 cascade |
| **OwnershipBoundary 触发** | 🔴 结构性作弊 | OwnershipBoundary attestation 写入（多 Soul / 频繁转移 / IP 集群） | ❌ 自动协议层 | **硬惩罚**：阶梯式降级 + 永久冻结 |

### 1.1 软惩罚（差评通路）

**触发**：`PneumaAttestation` 写入一条 `raterRole = CALLER` 且 `rating ≤ 2` 的 attestation。

**作用**：
- 进入 `Economic` 维度公式（按 ROLE_WEIGHTS[CALLER]=1.5× 加权）
- 不动 USDC stake
- 30 天衰减（DECAY_LAMBDA）后影响减弱

**为什么不更狠**：
单次差评可能是 caller 主观偏见、可能是 service 一次性故障。让市场用脚投票（声誉慢慢下降）比一次差评直接 slash 更合理。

**累计效应**：连续 5+ 差评在 30 天窗口内 → 触发 `punishmentFactor`（见 §3）。

---

### 1.2 中硬惩罚（法庭通路）

**触发**：`PneumaCourt.fileDispute` 后 jurors 多数决判 guilty。

**链上动作**（合约层已实现）：
- `slashOnCourtRuling(callId)` → `provider stake -= slashAmount`，转给 caller
- `ReputationGraph.onEndorseeSlashed` 联动 → 担保人按相同 bps cascade slash
- 单 callId 只能 slash 一次（防 timeout / revoke / court 三路双花）

**链下动作**（reputation 公式 v3 新加）：
- `punishmentFactor = guiltyCount / (guiltyCount + innocentCount + 5)`（Laplace smoothing）
- `Economic_v3 = Economic_v2 × (1 - punishmentFactor)`
- **段位 hard cap**：有过 court guilty 记录 → 段位钳制到 **Silver**（不再能进 Gold/Platinum/Diamond）
- 段位 hard cap **不衰减**——这是给"被法庭判过"打的永久标签

**举例**：
- 0 guilty → factor = 0 → Economic 不影响
- 1 guilty / 0 innocent → factor = 1/6 ≈ 0.17 → Economic × 0.83
- 3 guilty / 1 innocent → factor = 3/9 ≈ 0.33 → Economic × 0.67
- 5 guilty / 0 innocent → factor = 5/10 = 0.5 → Economic 砍半

**Filing fee（防滥诉）**：
- plaintiff 起诉时 lock 0.5 USDC
- guilty 判决 → 退还 plaintiff
- innocent 判决 → 转给 defendant（补偿被冤枉）
- ties → innocent → 转给 defendant

---

### 1.3 硬惩罚（反洗白阶梯通路）

**触发**：`OwnershipBoundary` attestation 写入（Soul transfer 时检测到结构性异常：多 Soul / 频繁转移 / IP 集群 / cluster pattern）。

**为什么单独走阶梯**：
OwnershipBoundary **不是"手滑点错"**，是系统检测到的**结构性指纹**。一次触发就足够说明问题。所以惩罚**首次就足够痛**。

**阶梯设计**（参考前期方案优化）：

| 触发次数（rolling 12 个月） | 惩罚 | 诚信段位 | 前端展示 |
|---|---|---|---|
| 首次 | 直接扣 200 分（display score） | 锚定 → **候选** | 🔴 反洗白边界触发 · 已降级至候选 |
| 二次 | 再扣 300 分 | 候选 → **观测** | 🔴 重复触发 · 已降级至观测 · 90 天 |
| 三次 | 永久冻结声誉**增长**（分数能保但不能涨） | 观测 → **冻结** | 🛑 身份冻结 · 需人工申诉 |

**关键约束**：

1. **Rolling window = 12 个月**：12 个月外的触发自动滑出窗口。防止合规老用户"秋后算账"——一个 5 年合规账号不会因为前 4 年的偶发触发被冻结。

2. **永久冻结只冻结增长，不冻结现有分**：
   - 当前分数仍可读、可展示
   - 段位停留在"观测"，不能再升
   - 现有担保关系仍生效（不破坏老合约履约）
   - 可申诉解封（Governor / DAO 决议）

3. **诚信段位与声誉段位 orthogonal**：
   - 声誉段位（Newcomer→Diamond）= 你做得多好
   - 诚信段位（锚定/候选/观测/冻结）= 你结构上多干净
   - UI 双标签：`💎 Diamond · ✅ 锚定` / `🥇 Gold · ⚠ 候选` / `🥈 Silver · 🛑 冻结`

---

## 2. 谁被惩罚

### 2.1 Provider（被诉的 agent）

- **链上**：`providerStake -= slashAmount`，转 caller
- **链下**：`punishmentFactor` × Economic 衰减；段位 hard cap

### 2.2 担保人（endorsers）

- **链上**：`onEndorseeSlashed` 同 bps cascade slash（已实现）
- **链下**（v3 新加）：
  - **slashedRatio**：你担保过的 N 个 agent 里 M 个被 slash → `Social_v3 = Social_v2 × (1 - M / (N + 1))`
  - 防"恶意背书"——你不能给坏人当背书又不承担信誉成本

### 2.3 恶意 caller（防滥诉）

- **Filing fee 0.5 USDC** lock
- 败诉（court innocent）→ filing fee 转 defendant
- 重复败诉（rolling window 12 个月内 3+ 次）→ caller reputation 进 punishmentFactor 衰减

---

## 3. 公式 v3 改动清单（reputation-formula）

完整在 [`packages/reputation-formula/src/v3.ts`]，要点：

```ts
// 新增字段
interface ReputationV3Breakdown extends ReputationV2Breakdown {
  punishmentFactor: number;     // 0-1, Court guilty 的统计衰减
  slashedRatio: number;         // 0-1, 担保人对被 slash 担保对象的反向衰减
  hasGuiltyRecord: boolean;     // 段位 hard cap 触发条件
  boundaryTier: BoundaryTier;   // 锚定 / 候选 / 观测 / 冻结
  boundaryTriggers12mo: number; // rolling 12 个月内 OwnershipBoundary 触发数
}

// Economic 维度
Economic_v3 = Economic_v2 × (1 - punishmentFactor)

// Social 维度
Social_v3 = Social_v2 × (1 - slashedRatio)

// Judicial 维度（v2 是 placeholder=0，v3 真实化）
Judicial_v3 = sqrt(totalVotes) × accuracy × decayFactor × juryWeight
  其中 accuracy = jurorVerdict 跟最终多数决一致的次数 / 总投票数

// 段位决定（叠加 hard cap）
function getEffectiveTier(displayScore, hasGuiltyRecord, boundaryTier):
  声誉段位 = getTier(displayScore)
  if hasGuiltyRecord:
      声誉段位 = min(声誉段位, Silver)        # Court guilty hard cap
  if boundaryTier == "frozen":
      增长 = false                             # 永久冻结
  return { reputationTier: 声誉段位, integrityTier: boundaryTier }
```

---

## 4. 合约层 v6.2 改动（待 follow-up）

当前 v6.0 部署到测试网，**3 个 gap 需要在 v6.2 补齐**：

1. **`SkillRegistry.setPneumaCourt`**：当前 v6.0 没这函数，court guilty hook 接不上
2. **`PneumaCourt.fileDispute` 加 filing fee**：lock 0.5 USDC，按裁决结果分发
3. **`OwnershipBoundary` attestation 真上链**：当前是设计概念，需要 SoulNFT transfer 时 hook 实际写入

合约升级窗口排期里做。**这份文档先锁产品语义，让前端公式 + UI 立刻可见**。

---

## 5. 申诉路径

**冻结状态可申诉**（Governor / DAO）：

1. 用户提交申诉表单（链下，描述 + 证据）
2. Governor 角色（多签或 DAO 投票）审核
3. 通过 → `unfreezeAgent(address)` 链上恢复增长权
4. 拒绝 → 维持冻结，可再申诉（无次数限制）

**申诉的合理使用场景**：
- 合规用户因换硬件 / 搬服务器误触发 boundary
- 法人主体接管账号，业务连续性需要
- 系统误判（链下 cluster detection 误报）

**不该用申诉的场景**：
- 真实作弊后想洗白
- 重复触发后期望"减刑"

---

## 6. 设计原则总结

1. **3 套阶梯按违规性质分层**：差评走公式衰减、court guilty 走 punishmentFactor、boundary 走阶梯。
2. **Rolling 12 个月窗口**：防合规老用户秋后算账。
3. **段位 hard cap 不衰减**：court guilty 的标签是永久的——这是公正性，不是软标签。
4. **声誉段位 + 诚信段位双层**：能力强 vs 干净，分别评价。
5. **冻结可申诉**：留人工通路，避免完全机器决策的冤案。
6. **惩罚配合反女巫体系**：单纯惩罚无效，必须叠加"换号变贵"的 4+1 道闸（见 [ANTI_SYBIL_DESIGN.md](./ANTI_SYBIL_DESIGN.md)）。
