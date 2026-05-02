# Pneuma Agent Runtime

Buyer-side local agent CLI dispatcher. Runs on **your laptop**, gets called by the Vercel-hosted hub through a Cloudflare Tunnel, spawns `claude` (or any other CLI agent), streams stdout back via SSE.

This is the "soul lives on user device" half of Pneuma — the on-chain side stays the same, but the actual agent reasoning runs on hardware you own.

```
your laptop                                 Vercel
┌──────────────────────┐               ┌──────────────────┐
│ claude CLI           │               │ apps/hub         │
│   ↑ child_process    │               │  ↓ fetch          │
│ agent-runtime:3010   │ ◄──────HTTPS──── agent.<your>.dev │
│   ↑ cloudflared      │   Bearer token │                  │
└──────────────────────┘               └──────────────────┘
```

## Setup (one-time)

1. **Install Cloudflare Tunnel**
   ```bash
   brew install cloudflared
   cloudflared tunnel login                    # opens browser, auths with your CF account
   cloudflared tunnel create pneuma-demo       # creates a tunnel, prints UUID
   cloudflared tunnel route dns pneuma-demo agent.<your-domain>.dev
   ```

2. **Generate the auth token** (any caller without this token gets 401 — required because the tunnel URL is public)
   ```bash
   echo "AGENT_RUNTIME_TOKEN=$(openssl rand -hex 32)" >> ../../.env.local
   ```

3. **Optional env overrides** (all have sane defaults):
   ```bash
   AGENT_RUNTIME_PORT=3010      # local port
   AGENT_BIN=claude             # CLI binary; could also be `aider`, `goose`, custom script
   AGENT_TIMEOUT_MS=120000      # SIGKILL after 2 min
   ```

## Run (every demo)

Terminal A — start the runtime:
```bash
pnpm --filter @pneuma/service-agent-runtime dev
```

Terminal B — open the tunnel:
```bash
cloudflared tunnel run pneuma-demo
```

Smoke test from a third terminal:
```bash
curl -N -X POST https://agent.<your-domain>.dev/invoke \
  -H "Authorization: Bearer $AGENT_RUNTIME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"echo hello from claude"}'
```

You should see SSE frames stream back: `event: start` → `event: stdout` (potentially many) → `event: exit` → `event: done`.

## Hub-side wiring (apps/hub)

In a Next.js route handler, fetch the tunnel URL and pipe SSE through to the browser:

```ts
// apps/hub/app/api/agent-call/route.ts
export async function POST(req: Request) {
  const { prompt, callId } = await req.json();
  const upstream = await fetch(`${process.env.AGENT_RUNTIME_URL}/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AGENT_RUNTIME_TOKEN}`,
    },
    body: JSON.stringify({ prompt, callId }),
  });
  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

Set `AGENT_RUNTIME_URL` and `AGENT_RUNTIME_TOKEN` in Vercel project env vars (Production + Preview).

## Security notes

- **Bearer token is the only barrier.** Tunnel URL is public. Rotate the token after the demo: `openssl rand -hex 32` → update both local `.env.local` and Vercel env.
- **No `shell:true`.** Args are passed as an array; user-supplied `args` are regex-whitelisted to flag-shaped tokens only.
- **Prompt goes via stdin**, not argv — avoids `ps -ef` leakage and CLI arg length limits.
- **Hard timeout.** `AGENT_TIMEOUT_MS` SIGKILLs runaway children so the hub call doesn't hang.
- **Don't commit `AGENT_RUNTIME_TOKEN`** — it's in `.env.local` which is `.gitignore`d.

## Why not deploy this to Vercel too?

The whole point is "agent runs on user-owned hardware". If it runs on Vercel, the agent's secrets, file system access, MCP servers, and local toolchain (git, gh, npm, etc.) all evaporate. Local runtime + tunnel preserves the Pneuma narrative: **soul owns wallet, wallet pays for skill, skill runs on your machine**.
