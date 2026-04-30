/**
 * End-to-end attack runner — fires every payload in the attack suite at both
 * /api/echo (baseline, no firewall) and /api/echo-protected (firewall on),
 * then prints a side-by-side comparison.
 *
 * Run:
 *   pnpm --filter @pneuma/service-skill-firewall-demo attack
 *
 * Pre-req: server already running (pnpm --filter ... dev) on PORT.
 */

import { ATTACK_SUITE, type AttackCase } from "../src/attack-suite.js";

const PORT = Number(process.env.SKILL_FIREWALL_DEMO_PORT ?? 3099);
const BASE = `http://localhost:${PORT}`;

interface ProbeResult {
  status: number;
  blocked: boolean;
  /** rule id reported by firewall on block, or null if allowed / non-firewall response */
  rule: string | null;
  /** error message if request failed before HTTP response */
  transportError?: string;
}

async function probe(path: string, body: unknown): Promise<ProbeResult> {
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await resp.json().catch(() => ({}))) as {
      rule?: string;
      code?: string;
    };
    const blocked = resp.status === 400 && json.code === "FIREWALL_BLOCK";
    return {
      status: resp.status,
      blocked,
      rule: json.rule ?? null,
    };
  } catch (err) {
    return {
      status: 0,
      blocked: false,
      rule: null,
      transportError: (err as Error).message,
    };
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…";
  return s + " ".repeat(n - s.length);
}

async function waitForServer(retries = 10, delayMs = 300): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      // keep retrying
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error(
    `server not reachable at ${BASE} after ${retries} retries — did you 'pnpm --filter @pneuma/service-skill-firewall-demo dev' first?`,
  );
}

async function runOne(c: AttackCase): Promise<{
  baseline: ProbeResult;
  protected: ProbeResult;
  passed: boolean;
}> {
  const [baseline, prot] = await Promise.all([
    probe("/api/echo", c.body),
    probe("/api/echo-protected", c.body),
  ]);
  // pass criteria: protected behaviour matches expectBlock
  const passed = c.expectBlock ? prot.blocked : !prot.blocked;
  return { baseline, protected: prot, passed };
}

async function main(): Promise<void> {
  console.log(`\n→ probing ${BASE} ...`);
  await waitForServer();
  console.log(`✓ server up\n`);

  console.log(
    `${pad("case", 42)}  ${pad("category", 18)}  ${pad("baseline", 12)}  ${pad("protected", 22)}  verdict`,
  );
  console.log("─".repeat(120));

  let blocked = 0;
  let blockedExpected = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const c of ATTACK_SUITE) {
    const r = await runOne(c);
    if (c.expectBlock) blockedExpected++;
    if (r.protected.blocked) blocked++;

    if (c.expectBlock && !r.protected.blocked) falseNegatives++;
    if (!c.expectBlock && r.protected.blocked) falsePositives++;

    const baseStr = r.baseline.blocked
      ? `BLOCK ${r.baseline.status}`
      : `pass ${r.baseline.status}`;

    const protStr = r.protected.blocked
      ? `BLOCK ${r.protected.rule ?? "?"}`
      : `pass ${r.protected.status}`;

    const verdict = r.passed ? "✓ ok" : "✗ FAIL";

    console.log(
      `${pad(c.name, 42)}  ${pad(c.category, 18)}  ${pad(baseStr, 12)}  ${pad(protStr, 22)}  ${verdict}`,
    );
  }

  console.log("─".repeat(120));
  console.log(`\nResults:`);
  console.log(
    `  attacks blocked:           ${blocked} / ${blockedExpected} expected   (${blockedExpected === 0 ? "—" : Math.round((blocked / blockedExpected) * 100) + "%"})`,
  );
  console.log(`  false negatives (missed):  ${falseNegatives}`);
  console.log(`  false positives (benign blocked): ${falsePositives}`);

  const ok = falseNegatives === 0 && falsePositives === 0;
  console.log(`\n${ok ? "✅ ALL CASES PASSED" : "❌ FAILURES FOUND"}\n`);

  process.exit(ok ? 0 : 1);
}

void main().catch((err) => {
  console.error("\n✗ runner crashed:", (err as Error).message);
  process.exit(2);
});
