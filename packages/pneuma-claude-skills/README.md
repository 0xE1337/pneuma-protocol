# @pneuma/claude-skills

> 5 个 sovereign-agent skill server，跑在演示者电脑上，由 Anthropic Claude 真做 reasoning，通过 Cloudflare Tunnel 暴露公网，链上 x402 结算。

这是 Pneuma 协议的**真用例**：不是 Vercel API 集线器，而是**别人电脑上跑的 AI agent，我钱包付钱真打进去**。每个 skill 一个独立进程、独立端口、独立 Anthropic API 调用栈——评委可以看到 5 个 sovereign agent 真活着。

---

## 5 个 skill

| skill | 价格 | 干什么 |
|---|---|---|
| **paper-summary** | 0.10 USDC | 给论文 title + abstract，返回中英双语 TL;DR + 3 条 contributions + citation hints |
| **code-review** | 0.15 USDC | 给 git diff，返回 4 档（critical / high / medium / suggestion）评审清单 + 修复建议 |
| **block-explainer** | 0.20 USDC | 给 tx receipt JSON，返回中文人话解释 + 关键参与方 + 资金流向 + 状态 |
| **creative-write** | 0.05 USDC | 给主题 + genre + tone，返回 primary 文 + 1-2 alternative |
| **quick-reasoning** | 0.03 USDC | 任意问题，Claude 直接答 + 自评 confidence（不知道就说不知道） |

---

## 5 分钟跑起来

```bash
# 1. 复制 .env.example 填进 .env（核心：ANTHROPIC_API_KEY + DEPLOYER_PRIVATE_KEY）
cp .env.example .env
# 编辑 .env

# 2. 注册 5 个 skill 到链上（拿 5 个 skillId）
PUBLIC_BASE_URL=https://skills.pneuma.dev pnpm register
# 把 stdout 输出的 SKILL_ID_* 5 行复制粘到 .env

# 3. 启动 5 个进程（一行命令，自动重启）
pnpm start:all

# 4. 起 Cloudflare Tunnel（另开一个 terminal）
cloudflared tunnel run pneuma-skills
# tunnel 把 https://skills.pneuma.dev/<skill-id>/api/run → localhost:31xx

# 5. 演示数据 seed —— 制造 30+ 条历史调用
ROUNDS=6 pnpm seed-traffic
```

---

## 演示日 ops checklist

详见 [DEMO_DAY_OPS.md](./DEMO_DAY_OPS.md)。要点：

- [ ] 演示前一晚跑 `caffeinate -s` 防 mac 睡眠
- [ ] `pnpm start:all` 5 个进程都活着（看终端 banner）
- [ ] `cloudflared tunnel run` tunnel 通了
- [ ] `curl https://skills.pneuma.dev/paper-summary/` 返回元数据 JSON
- [ ] `pnpm seed-traffic` 已经制造过历史数据（链上 attestation 已有）

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
    │ Anthropic SDK → claude-sonnet-4-5
    ▼
真实 reasoning 结果
    │
    │ HTTP response
    ▼
SkillRegistry.settle → 转 USDC 给你 + 写 attestation
    │
    ▼
评委 hub UI 看到：
  - 真 tx hash（点 explorer 验）
  - 真返回内容（Claude 输出）
  - 链上声誉公式实时更新
```

---

## 加新 skill

1. 在 `src/skills/<your-skill>.ts` 里 export `definition` + `handler`
2. 在 `src/skills/index.ts` 加 import + 加进 `ALL_SKILLS` map
3. `.env.example` 加一对 `SKILL_ID_<UPPER>` + `PORT_<UPPER>`
4. 跑 `pnpm register` 重注册（拿到新 skillId 再回填 .env）
5. 跑 `pnpm start:all` —— supervisor 会自动起新 skill 进程

不需要改 `server.ts` / `start-all.mjs`。
