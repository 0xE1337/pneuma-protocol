# 演示日运维 Checklist

> 这份是给"南客松 S2 演示日"用的实操 checklist。建议演示前一晚走一遍，演示当天再走一遍。
>
> **核心原则**：reasoning 走你**本地的 Claude Code 订阅**（`claude -p` spawn 子进程）。
> 不需要 ANTHROPIC_API_KEY，不产生 per-token 计费。

---

## 演示前一晚（建议提前 12 小时）

### 0. 验证 Claude Code 本地可用

```bash
# 必须看到版本号
claude --version
# → 2.x.y (Claude Code)

# 必须能进 interactive 不被要求 login
claude
# 进入交互模式直接 Ctrl+C 退出即可——只要不弹"login first"就 OK

# 直接 spawn 验证
cd packages/pneuma-claude-skills
pnpm smoke
# 看到 "Smoke 通过" 才能继续
```

### 1. 链上注册全部就绪

```bash
cd packages/pneuma-claude-skills

# 检查 5 个 skillId 都已经在 .env 里
grep "SKILL_ID_" .env
# 应该看到 5 行非 0 数字

# 如果还没注册：
PUBLIC_BASE_URL=https://skills.pneuma.dev pnpm register
# 把 stdout 5 行复制粘到 .env
```

### 2. Cloudflare Tunnel 配置好

详细一步一步指南：[SETUP_TUNNEL.md](./SETUP_TUNNEL.md)

最快路径（不需要自己域名，用 Cloudflare 永久免费 `*.cfargotunnel.com` 子域）：

```bash
# 一次性安装 + OAuth + 创建 tunnel
brew install cloudflared
cloudflared tunnel login                    # 浏览器一次
cloudflared tunnel create pneuma-skills     # 拿到 Tunnel UUID

# 配置 ingress（基于 config/cloudflared.yml.example，替换 UUID + hostname）
cp config/cloudflared.yml.example ~/.cloudflared/config.yml
# 编辑 ~/.cloudflared/config.yml：
#   - tunnel: <UUID>
#   - credentials-file: ~/.cloudflared/<UUID>.json
#   - 5 个 hostname: <UUID>.cfargotunnel.com
```

### 3. seed 历史数据 → 链上有真历史

```bash
# 启动所有 skill 进程（前台）
pnpm start:all

# 另开一个 terminal 起 tunnel（前台）
cloudflared tunnel run pneuma-skills

# 第三个 terminal 跑 seed
ROUNDS=6 pnpm seed-traffic
# 会跑 30 次真调用 → 30 条 attestation 上链
```

### 4. 验证

```bash
# 每个 skill 都能返回元数据
for s in paper-summary code-review block-explainer creative-write quick-reasoning; do
  echo -n "$s: "
  curl -s https://skills.pneuma.dev/$s/ | jq -r '.skillId'
done

# 链上 SkillRegistry 也能看到 5 个 skill
# 进 hub /discover 看 Top Skills 列表，应该有 5 条 + 历史 calls 数 > 0
```

---

## 演示日当天（开演前 30 分钟）

### 1. 防睡眠

```bash
caffeinate -s &
# 这个进程不要关，整个演示期都让 mac 不睡
```

### 2. 启动所有进程

开 3 个 terminal tab：

**Tab 1** (skill processes):
```bash
cd packages/pneuma-claude-skills
pnpm start:all
# 看到 5 个彩色 banner，每个显示 skillId / port / pricePerCall
```

**Tab 2** (tunnel):
```bash
cloudflared tunnel run pneuma-skills
# 看到 "Connection established" 5+ 个
```

**Tab 3** (hub dev server):
```bash
cd apps/hub
pnpm dev
# 在 :3100 起 hub
```

### 3. 烟雾测试

```bash
# 每个 skill 元数据 OK
curl -s https://skills.pneuma.dev/paper-summary/ | jq

# Hub 能看到 5 个 active skill + 历史 calls
open http://localhost:3100/discover

# 直接调一次（在 hub /run 选一个 skill 真跑一遍）
```

---

## 演示中如果出事

### 场景 A: 某个 skill 进程挂了

`pnpm start:all` 已经自带 supervisor，最多重启 5 次。如果还挂：

```bash
# 单独起这一个
SKILL_ID=paper-summary PORT_OVERRIDE=3101 npx tsx src/server.ts
```

### 场景 B: Cloudflare Tunnel 断了

```bash
# 重启 tunnel
cloudflared tunnel run pneuma-skills

# 应急：用 ngrok 顶一下
ngrok http 3101
# 注意：ngrok 会换 URL，链上 endpoint 不会自动变，但**历史数据仍在链上**
```

### 场景 C: 完全跑不通

**这就是 seed 数据的意义**：

打开 hub `/discover`，所有历史 attestation + 评论 + 段位 + 法庭记录都在链上，**评委看到的是历史已发生的真实**——不依赖现场进程。

打开 `/admin/dashboard` —— 9 类事件订阅展示**全网过去的活动**，这些 event 已经写入链上不会消失。

打开任意 `/agents/[address]` —— 5 tab 详情页里的 reputation 计算来自链上数据，跟现场无关。

**底线**：seed 跑过一次，演示就有 fallback。

---

## 演示后

```bash
# 关 caffeinate
killall caffeinate

# 关 tunnel
# Ctrl+C 终止 cloudflared

# 关 skill 进程
# Ctrl+C 终止 start-all.mjs
```

链上数据**不会清理**——演示后 reputation 系统还在，每次跑都是协议级历史的累加。
