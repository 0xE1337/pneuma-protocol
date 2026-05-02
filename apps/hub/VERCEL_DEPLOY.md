# Hub Vercel 部署指南

> 把 `apps/hub` 部署到 Vercel，让评委有公网 URL（如 `pneuma-hub.vercel.app`）。
> 整套约 **15-20 分钟**。

> 注意：Vercel 上跑的只是 **hub UI + /api/orchestrate planner**。
> 5 个 Claude skill 仍在你电脑上跑，通过 cloudflared trycloudflare URL 暴露。
> Vercel hub 调 `/api/orchestrate` → orchestrator 拉链上 skill → fetch trycloudflare URL → 你电脑上 spawn claude → 真返回。

---

## 0. 前置

- Vercel 账号（[免费注册](https://vercel.com/signup)）
- 你电脑：保持 `pnpm tunnels:up` + `pnpm start:all` 都在跑（链上 endpoint 是 trycloudflare URL，断了 hub 调不通）

---

## 路 A · 浏览器 dashboard 部署（推荐，最稳）

### Step 1. 推代码到 GitHub

```bash
cd /path/to/pneuma-protocol
git push origin main
```

### Step 2. 浏览器进 Vercel dashboard

1. 去 [https://vercel.com/new](https://vercel.com/new)
2. 选 **Import Git Repository** → 选你的 GitHub repo
3. **Configure Project**：
   - **Project Name**: `pneuma-hub`（自取）
   - **Framework Preset**: Next.js（自动检测）
   - **Root Directory**: 点 **Edit** → 选 `apps/hub`
   - **Build / Install Command**: 都留默认 (Vercel 自动用 pnpm + monorepo)
   - **Output Directory**: 默认 (Next.js auto detects `.next`)

### Step 3. Environment Variables（必填）

把下面所有 ENV var 填到 **Environment Variables** 部分（粘贴后点 **Add**）。值从你本机 `apps/hub/.env.local` 复制：

**链上配置（公开，前缀 NEXT_PUBLIC_*）**：

| Key | Value 来源 |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `5042002` |
| `NEXT_PUBLIC_CHAIN_NAME` | `Arc Testnet` |
| `NEXT_PUBLIC_CHAIN_RPC` | `.env.local` 同名 |
| `NEXT_PUBLIC_CHAIN_EXPLORER` | `.env.local` 同名 |
| `NEXT_PUBLIC_USDC_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_SOUL_NFT_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_PNEUMA_ATTESTATION_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_REPUTATION_GRAPH_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_BUDGET_CONTROLLER_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_PNEUMA_TIMELOCK_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_PNEUMA_COMMONS_ADDRESS` | `.env.local` 同名 |
| `NEXT_PUBLIC_SOUL_ACCOUNT_IMPL` | `.env.local` 同名 |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `.env.local` 同名（如有） |
| `NEXT_PUBLIC_ERC6551_REGISTRY` | `.env.local` 同名 |

**Server-side（私有，不暴露浏览器）**：

| Key | 用途 |
|---|---|
| `ARC_TESTNET_RPC_URL` | server fetch RPC（`.env.local` 同名） |
| `DEEPSEEK_API_KEY` | planner LLM (orchestrator) |
| `OPENAI_API_KEY` | planner LLM 备用 |
| `TEST_SELLER_PRIVATE_KEY` | `/api/orchestrate` Smart 模式 caller key（**关键**：必须跟 5 skill owner 不同，否则 SelfCallForbidden） |
| `DEPLOYER_PRIVATE_KEY` | 仅作 fallback，可不填 |

### Step 4. Deploy

点 **Deploy**。Vercel 自动：
1. clone repo
2. 检测 pnpm-workspace.yaml
3. `pnpm install`
4. `pnpm --filter @pneuma/hub build`
5. 推上 edge

约 3-5 分钟出炉。完成后给一个 `https://pneuma-hub.vercel.app` URL。

---

## 路 B · CLI 一行部署（适合 token 流）

### Step 1. 创建 Vercel API Token

1. 浏览器去 [https://vercel.com/account/tokens](https://vercel.com/account/tokens)
2. **Create**：name 自取（如 "pneuma-deploy"）, scope 选 your account, expiration 30 天
3. 复制 token（只显示一次！）

### Step 2. 在仓库根跑 deploy

```bash
cd /path/to/pneuma-protocol/apps/hub

# Link to a new project
VERCEL_TOKEN=<your-token> vercel link --yes --project pneuma-hub

# Push env vars from .env.local（一次性，推送所有 NEXT_PUBLIC_* + private）
# 注意：vercel env add 是交互式的，CLI script 用不了。
# 推荐去 Dashboard Project Settings > Environment Variables 一次性粘贴

# Deploy production
VERCEL_TOKEN=<your-token> vercel deploy --prod --yes
```

CLI 比 dashboard 快但 env vars 仍要去 dashboard 配（CLI 的 `vercel env add` 是交互式，不适合 30+ env 一次配）。

---

## 部署后必做 4 件事

### 1. 验 deployment URL 真活

```bash
curl -s https://<your-deploy>.vercel.app/api/anet-status | head
# → 应该返回 anet 状态 JSON
```

### 2. 验 /discover 真读链

```bash
curl -s "https://<your-deploy>.vercel.app/discover" | grep -oE "Top Agents|Top Skills"
# → 都要看到
```

### 3. 验 Smart 模式真能 plan

浏览器打开 `https://<deploy>.vercel.app/run` 切 Smart 模式，输入「评审 Solidity diff + 写 slogan」，点按钮。应该看到 plan 拆 2 步 + 真 escrow tx。

### 4. 演示日 CHECKLIST

- [ ] 你电脑 `pnpm tunnels:up` 跑着
- [ ] 你电脑 `pnpm start:all` 跑着
- [ ] Vercel hub URL 对评委公开
- [ ] 5 个 trycloudflare URL 没断（重启换 URL → hub 调不通）

---

## 常见踩坑

| 现象 | 原因 / 修复 |
|---|---|
| Build fail "Cannot find module @pneuma/x402" | Root Directory 没设 `apps/hub`，Vercel 没在 monorepo 上下文 install |
| Build fail "ArgError: env DEEPSEEK_API_KEY is required" | 没在 Vercel env vars 里加 LLM key |
| Smart 模式 planner 失败 | `TEST_SELLER_PRIVATE_KEY` 没设；或 `ARC_TESTNET_RPC_URL` 不通 |
| /run Smart 调用全 500 | 你电脑上 `pnpm start:all` 没跑 / tunnel 断了 |
| 链上 skill 列表空 | `NEXT_PUBLIC_SKILL_REGISTRY_ADDRESS` 错或链不通 |

---

## 我能帮你做什么

如果你跑路 A：
- 推完代码后告诉我 deploy URL 出炉
- 我帮你跑 4 步 verify

如果你跑路 B：
- 给我一个 `VERCEL_TOKEN`，我立刻帮你 link + deploy（env vars 你仍需去 dashboard 配，因为 CLI add 是交互式）

你哪条路？
