# @pneuma/claude-skills

> 5 个 sovereign-agent skill server，跑在演示者电脑上，**spawn 本地 `claude -p`** 做真 reasoning，通过 Cloudflare Tunnel 暴露公网，链上 x402 结算。

**零 LLM API key**：reasoning 走你已订阅的 Claude Code（OAuth keychain），不调 Anthropic API、不产生 per-token 计费。
你付的是 Claude Code 月费，演示日评委通过 x402 给你打 USDC，你的订阅算力替他们干活。

---

## 5 个 skill

| skill | 价格 | 干什么 |
|---|---|---|
| **paper-summary** | 0.10 USDC | 给论文 title + abstract，返回中英双语 TL;DR + 3 contributions + citation hints |
| **code-review** | 0.15 USDC | 给 git diff，返回 4 档（critical / high / medium / suggestion）评审清单 + 修复建议 |
| **block-explainer** | 0.20 USDC | 给 tx receipt JSON，返回中文人话解释 + 关键参与方 + 资金流向 + 状态 |
| **creative-write** | 0.05 USDC | 给主题 + genre + tone，返回 primary 文 + 1-2 alternative |
| **quick-reasoning** | 0.03 USDC | 任意问题，Claude 直接答 + 自评 confidence（不知道就说不知道） |

---

## 公网部署模式（演示日推荐 · 详见 [SETUP_TUNNEL.md](./SETUP_TUNNEL.md)）

```bash
# 0. 装 cloudflared + 登录（一次性，5 min）
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create pneuma-skills      # 拿到 Tunnel UUID

# 1. 配 ~/.cloudflared/config.yml（基于 config/cloudflared.yml.example）
#    填 Tunnel UUID + hostname

# 2. 启 tunnel（前台，演示期保持开）
cloudflared tunnel run pneuma-skills

# 3. 起 5 个 skill server（另一个 terminal）
pnpm start:all

# 4. 重注册 5 skill 到公网 URL（自动验 endpoint 通后才上链）
PUBLIC_BASE_URL=https://<UUID>.cfargotunnel.com pnpm register:tunnel
```

链上 endpoint 现在是 `https://<UUID>.cfargotunnel.com/<skill-id>/api/run`——评委用 explorer 看可信。

---

## 本地 dev 模式（不走公网）

```bash
# 0. 前置确认 —— 你电脑上的 Claude Code 已登录（订阅版 OAuth）
which claude        # → /usr/local/bin/claude 之类
claude --version    # → 2.x.y (Claude Code)

# 1. 一次性确认 spawn 链路通
cd packages/pneuma-claude-skills
pnpm smoke
# 应该看到 Claude 输出 JSON、字段检查全 ✓

# 2. 注册 5 个 skill 到链上（拿 5 个 skillId）
PUBLIC_BASE_URL=https://skills.your-domain.com pnpm register
# 把 stdout 5 行 SKILL_ID_*=N 复制粘到 .env

# 3. 启动 5 个进程（一行命令）
pnpm start:all

# 4. 起 Cloudflare Tunnel（另开一个 terminal）
cloudflared tunnel run pneuma-skills

# 5. seed 30+ 真历史调用
pnpm seed-traffic
```

---

## 演示日 ops checklist

详见 [DEMO_DAY_OPS.md](./DEMO_DAY_OPS.md)。要点：

- [ ] 演示前一晚跑 `caffeinate -s` 防 mac 睡眠
- [ ] **Claude Code 已登录**（`claude --version` 能输出版本，且 `claude` 进 interactive 不会被要求 login）
- [ ] `pnpm smoke` 通过 —— 验证 spawn `claude -p` 真能拿到 JSON 输出
- [ ] `pnpm start:all` 5 个进程都活着
- [ ] `cloudflared tunnel run` tunnel 通了
- [ ] `pnpm seed-traffic` 已制造 30+ 条历史 attestation 上链
- [ ] **ANTHROPIC_API_KEY 不需要**——你付的是订阅，不是 API token

---

## 架构

```
评委钱包（任意 EOA）
    │
    │ x402 escrow PaymentAuth (EIP-712)
    ▼
SkillRegistry (Arc Testnet)
    │ escrowForCall → 锁仓 USDC
    ▼
你电脑上的 cloudflared tunnel
    │ https://skills.pneuma.dev/<skill-id>/api/run
    ▼
你电脑上的 node 进程（pnpm start:all 起的 5 个）
    │ x402 middleware verify PaymentAuth
    │
    │ ┌─ spawn 子进程 ─────────────────────────┐
    │ │ claude -p --append-system-prompt ...   │
    │ │   stdin: user message                  │
    │ │   OAuth keychain（你的订阅）           │
    │ │   stdout: JSON                         │
    │ └─────────────────────────────────────────┘
    │
    │ JSON parsed
    ▼
SkillRegistry.settle → 转 USDC 给你 + 写 attestation
    │
    ▼
评委 hub UI 看到：
  - 真 tx hash（点 explorer 验）
  - 真 Claude 输出（你电脑上的 Claude 真 reasoning）
  - 链上声誉公式实时更新
```

---

## 关键设计点

### 为什么 spawn `claude -p` 而不是 Anthropic SDK？

参考 [pneuma-court-p2p/src/court_agent/jurors/_runner.py](https://github.com/0xE1337/pneuma-court-p2p/blob/main/src/court_agent/jurors/_runner.py)（南客松 S2 P2P 赛道独立项目）的 `_ask_claude_cli` 实现。同样的设计原则：

- **零 API key**：Anthropic SDK 要 `ANTHROPIC_API_KEY`，等于让操作者付**两份钱**（订阅 + API token）
- **走订阅**：`claude -p` 子进程读 OAuth keychain，复用你 Claude Code 的算力
- **同人格**：每次 reasoning 的人就是你 Claude Code 当前账号本人

代价是**每次调用 5-10 秒 CLI 启动开销**。对 demo 完全可接受（caller 在 hub 上等结果时本来就要等链上 escrow 确认）。

### 为什么 5 个独立进程而不是 5 个 route in 1 server？

让评委 `ps aux | grep tsx` 能看到 5 个真独立的 sovereign agent：
- 各自的 PID
- 各自的端口（3101–3105）
- 各自 spawn 自己的 `claude` 子进程
- 各自的 SkillRegistry skillId

这是协议层"sovereign"叙事的工程证据。

---

## 加新 skill

1. 在 `src/skills/<your-skill>.ts` 里 export `definition` + `handler`，handler 调 `ctx.callClaude(...)`
2. 在 `src/skills/index.ts` 加 import + 加进 `ALL_SKILLS` map
3. `.env.example` 加一对 `SKILL_ID_<UPPER>` + `PORT_<UPPER>`（可选）
4. 跑 `pnpm register` 重注册
5. 跑 `pnpm start:all` —— supervisor 自动起新 skill 进程

不需要改 `server.ts` / `start-all.mjs`。
