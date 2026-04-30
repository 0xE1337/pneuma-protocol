# @pneuma/x402

> HTTP 402 中间件：让任何 AI 服务**一行代码**收 USDC（Arc 原生），让任何 Agent 客户端**自动**支付。

## 安装

```bash
pnpm add @pneuma/x402
# or
npm i @pneuma/x402
```

## 服务端（Hono）—— 30 秒接入

```ts
import { Hono } from "hono";
import { x402 } from "@pneuma/x402/hono";

const app = new Hono();

app.post(
  "/api/summarize",
  x402({
    skillId: 1,
    skillName: "Text Summarizer",
    chainId: 5042002,
    paymentToken: "0x3600000000000000000000000000000000000000", // Arc 原生 USDC
    skillRegistry: "0xB63c7fBCA41466edF3AB0F78F14a7EB85D8D6B69",
    serverPrivateKey: process.env.SERVER_PRIVATE_KEY as `0x${string}`,
    rpcUrl: process.env.RPC_URL!,
  }),
  async (c) => {
    const { text } = await c.req.json();
    return c.json({ summary: text.slice(0, 100) + "..." });
  },
);

export default app;
```

## 服务端（Express）

```ts
import express from "express";
import { x402 } from "@pneuma/x402/express";

const app = express();
app.use(express.json());

app.post(
  "/api/summarize",
  x402({
    skillId: 1,
    /* ...same config as Hono */
  }),
  (req, res) => {
    res.json({ summary: "..." });
  },
);
```

## 客户端

```ts
import { PneumaClient } from "@pneuma/x402/client";

const client = new PneumaClient({
  rpcUrl: "https://rpc.testnet.arc.network",
  chainId: 5042002,
  paymentToken: "0x3600000000000000000000000000000000000000", // Arc 原生 USDC
  skillRegistry: "0xB63c7fBCA41466edF3AB0F78F14a7EB85D8D6B69",
  privateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}`,
});

const result = await client.callSkill({
  endpoint: "https://service.example.com/api/summarize",
  callerTBA: "0x...", // your Soul's TBA address
  body: { text: "..." },
});

console.log(result.data); // 业务返回
console.log(result.callId, result.paidAmount, result.escrowTxHash); // 链上凭证（USDC, 6 decimals）
```

> **测试 USDC 领取**：[Circle faucet](https://faucet.circle.com)（Arc Testnet 上 USDC 同时是 native gas + 6-decimal ERC-20 接口，单合约地址 `0x3600...0000`）。

## 协议流程

```
┌──────┐                  ┌──────┐            ┌──────────────┐  ┌────────────────┐
│Client│                  │Server│            │SkillRegistry │  │PneumaAttestation│
└──┬───┘                  └──┬───┘            └──────┬───────┘  └────────┬───────┘
   │                         │                       │                   │
   │─POST /api (no X-PAY)──>│                       │                   │
   │<─402 + challenge───────│                       │                   │
   │                                                │                   │
   │─approve(SkillRegistry, amt)─────────────────>│                   │
   │─escrowForCall(skillId, tba, hash)──────────>│                   │
   │<─callId──────────────────────────────────────│                   │
   │                                                │                   │
   │─POST /api with X-PAY: {callId}───>│         │                   │
   │                                    │─verify─>│                   │
   │                                    │<─status─│                   │
   │                                    │ (run)   │                   │
   │<─200 + result────────────────────│         │                   │
   │                                    │─settleCall──>│              │
   │                                    │              │─attest()────>│ ← PROVIDER 评分写入
   │                                    │<─attestUid───│              │
   │                                                                   │
   │ (caller 反向评分，可选)                                            │
   │─callerRateSkill(callId, rating)─────────────>│                   │
   │                                                │─attestFromCaller>│ ← CALLER 评分写入
```

**声誉闭环**：每笔调用产生 PROVIDER attestation；caller 可选反向调用 `callerRateSkill` 产生 CALLER attestation。两类都挂在各自 recipient 的 TBA 索引上，**任何 dApp 可读、orchestrator 决策可用**。

## API

| 导出路径 | 类型 | 说明 |
|---|---|---|
| `@pneuma/x402/hono` → `x402()` | middleware factory | 一行接入 Hono 服务 |
| `@pneuma/x402/express` → `x402()` | middleware factory | 一行接入 Express |
| `@pneuma/x402/client` → `PneumaClient` | class | 客户端 SDK，自动处理 402 + escrow + 重试 |
| `@pneuma/x402` → `PneumaMiddleware` | class | 框架无关核心实例（自定义集成） |
| `@pneuma/x402` → `SkillRegistryAbi`, `Erc20Abi` | const | 常用合约 ABI（viem 兼容，含 `escrowForCall` / `settleCall` / `callerRateSkill` / `listActiveSkills` / `getSkill`，以及 USDC 的 `approve` / `permit` / `balanceOf`） |
| `@pneuma/x402` → `PaymentChallenge`, `X402PaymentHeader` 类型 | type | x402 协议消息类型，自定义集成用 |

> **调声誉系统时**：直接用 viem + `PneumaAttestationAbi`（在 `apps/hub/lib/contracts.ts` 或 `apps/viewer/lib/contracts.ts` 里导出）调 `getAttestationsByRecipient(tba)` 即可，零授权，跨 dApp 可读。

## 设计要点

- **客户端付 gas**：客户端自己 escrow（非 meta-tx），服务端只付 settle 的 gas。简化合约设计 + 信任最小化。
- **链上验证 callId**：服务端不验证客户端签名，而是直接 `getCall(callId)` 看链上状态 — 因为 callId 是链上 escrow 后才有的，本身就是不可伪造的支付凭证。
- **settle 异步触发 attestation**：handler 跑完之后自动 `settleCall(callId, rating)` 释放资金 + 触发 PneumaAttestation.attest，履历写入跨平台可读的注册器。

## 许可证

MIT
