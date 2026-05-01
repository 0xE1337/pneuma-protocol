# Cloudflare Tunnel 一步一步 setup

> 把你电脑上 5 个 skill server 的 :3101-3105 暴露成公网 https URL，让链上
> endpoint 看起来真（不是 localhost）。整个流程 **15-20 分钟**。

---

## 0. 前置 · 你需要的

- macOS（其它系统命令稍有不同）
- 一个 Cloudflare 账号（免费）—— 不用买域名，Cloudflare 会送你 `*.cfargotunnel.com` 子域

---

## 1. 装 cloudflared

```bash
brew install cloudflared
cloudflared --version    # → 应该 ≥ 2024.x
```

---

## 2. 登录 Cloudflare（浏览器 OAuth）

```bash
cloudflared tunnel login
```

会弹一个浏览器页 → 选你的 Cloudflare 账号 / 注册 / 选默认 zone。完成后命令行返回，本地生成 `~/.cloudflared/cert.pem`。

---

## 3. 创建 tunnel

```bash
cloudflared tunnel create pneuma-skills
```

输出会包含一行类似：

```
Created tunnel pneuma-skills with id 12345678-abcd-ef01-2345-6789abcdef01
```

**记下这个 UUID**——下一步要用。同时 `~/.cloudflared/<UUID>.json` 凭据文件已生成。

---

## 4. 拿一个公网 hostname

两条路：

### 路 A · 用 Cloudflare 永久免费子域（推荐，省事）

`cfargotunnel.com` 是 Cloudflare 给 tunnel 直接送的兜底域：

```
https://<YOUR_TUNNEL_UUID>.cfargotunnel.com
```

UUID 永久 stable —— 重启 tunnel URL 不变。**不需要任何 DNS 配置**。

### 路 B · 用你自己的 Cloudflare 域名

如果你已经把某个域名（如 `your-domain.com`）托管在 Cloudflare，可以用子域 `skills.your-domain.com`：

```bash
cloudflared tunnel route dns pneuma-skills skills.your-domain.com
```

更专业，但要域名前置条件。

---

## 5. 写 ingress 配置

把 [`config/cloudflared.yml.example`](./config/cloudflared.yml.example) 复制到 `~/.cloudflared/config.yml`：

```bash
cp config/cloudflared.yml.example ~/.cloudflared/config.yml
```

然后用编辑器打开 `~/.cloudflared/config.yml`，**两处替换**：

```yaml
tunnel: <YOUR_TUNNEL_UUID>           # 替换为 step 3 的 UUID
credentials-file: /Users/yijingguo/.cloudflared/<YOUR_TUNNEL_UUID>.json
                                     #                ↑ 同上 UUID

ingress:
  - hostname: <YOUR_DOMAIN>          # 替换：
                                     #   路 A → <UUID>.cfargotunnel.com
                                     #   路 B → skills.your-domain.com
    path: /paper-summary/.*
    service: http://localhost:3101
  # ... 其它 4 条 path 同样替换 hostname
```

---

## 6. 启动 tunnel

```bash
cloudflared tunnel run pneuma-skills
```

前台跑，看到 "Connection established" 5 次（5 路边缘）就 OK。

**演示期保持窗口开**——关掉就断 tunnel，链上 endpoint 不可达。

---

## 7. 验证

新开一个 terminal：

```bash
# 先确认 5 个 skill server 还在跑
curl -s http://localhost:3101/ | head -c 100

# 再测公网 URL（替换你的 hostname）
curl -s https://<YOUR_HOSTNAME>/paper-summary/ | head -c 200
```

应该看到一段 JSON：`{"service":"Paper Summary","skillId":...}`。

**注意**：由于 ingress path 是 `/paper-summary/.*`，要带 trailing slash 才命中——`/paper-summary` 单独不会被路由。

---

## 8. 重注册 5 个 skill（链上 endpoint 切到公网 URL）

```bash
cd packages/pneuma-claude-skills

# 把旧的 5 个 localhost skill 替换成公网版（5 笔 tx + gas）
PUBLIC_BASE_URL=https://<YOUR_HOSTNAME> pnpm register

# 把 stdout 5 行 SKILL_ID_*=N 复制粘到 .env
# （注意旧的 SKILL_ID_*=8..12 会变成新的数字，比如 13..17）
```

---

## 9. 重启 5 个 skill server 让新 SKILL_ID 生效

```bash
# 停旧的
pkill -f "tsx src/server.ts"

# 起新的
pnpm start:all
```

5 个 banner 应该显示新 skillId（比如 13-17）。

---

## 10. 演示日真用

打开 hub `/discover` —— 应该看到 12+5=17 active skill（旧 5 localhost 还在但链上 active=true，可以单独 deactivate）。

新 5 个 skill 的 endpoint 在 explorer 上看是 **`https://<YOUR_HOSTNAME>/paper-summary/api/run`** 这种公网 URL，评委可以直接 curl 验证。

---

## 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `cloudflared tunnel login` 浏览器一直转圈 | Cloudflare 账号没选 zone | 浏览器手动选一个域名 zone（即使没用）|
| `tunnel run` 报 "no ingress rules" | config.yml 路径不对 / yaml 缩进错 | 用 `cloudflared tunnel ingress validate` 验证 |
| 公网 URL 一直 502 | local skill server 没在跑 | `lsof -i :3101` 看端口在不在 |
| 重注册后 hub 看不到新 skill | hub 缓存 | 等 30 秒 useReadContract refetch，或硬刷 |
| pnpm register 报 insufficient gas | deployer 钱包没 USDC（不是 ETH，Arc Testnet USDC 当 gas）| 去 [Circle faucet](https://faucet.circle.com) 领 |

---

## 备份方案：临时 trycloudflare（不需要登录）

完全不想注册 Cloudflare 账号？还有更轻量的：

```bash
# 单端口快速暴露
cloudflared tunnel --url http://localhost:3101
# → 输出 https://<random-words>.trycloudflare.com（每次重启换 URL）
```

**问题**：URL 重启就换，链上 endpoint 锁了之后断。所以**只适合 5 分钟试一下**，不适合演示日。

---

## 你做完之后告诉我

1. **Tunnel UUID**（step 3 的输出）
2. **公网 hostname**（step 4 路 A 或 B 的结果）

我立刻帮你：
- 写好 `~/.cloudflared/config.yml` 真实值
- 跑 `pnpm register` 重注册
- 验证公网 URL 都通了
- 把新 SKILL_ID 写进 .env
