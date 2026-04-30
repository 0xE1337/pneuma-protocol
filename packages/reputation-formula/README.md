# @pneuma/reputation-formula

> Conviction-weighted reputation formula for Pneuma — pure TypeScript, zero deps, reproducible from any dApp without forking the frontend.

This is the canonical implementation of the Pneuma reputation formula. Both the Pneuma `apps/hub` frontend and any third-party dApp consume the **same package**, ensuring a single source of truth.

## Install

```bash
pnpm add @pneuma/reputation-formula
# or
npm i @pneuma/reputation-formula
```

## Quick Start (v1, economic-only)

```ts
import { computeReputation } from "@pneuma/reputation-formula";
import { createPublicClient, http } from "viem";
import { PneumaAttestationAbi } from "@pneuma/x402"; // or your own ABI

const client = createPublicClient({ chain: arc, transport: http() });

const attestations = await client.readContract({
  address: PNEUMA_ATTESTATION_ADDRESS,
  abi: PneumaAttestationAbi,
  functionName: "getAttestationsByRecipient",
  args: [tba],
});

const { score, validCount, totalVolumeRaw } = computeReputation(attestations);
console.log(`reputation: ${score.toFixed(1)} / 100`);
```

## v2 (4-Dimensional, V6.0.3)

```ts
import { computeReputationV2 } from "@pneuma/reputation-formula";

const breakdown = computeReputationV2({
  attestations,            // PneumaAttestation.getAttestationsByRecipient
  publications,            // PneumaCommons.getPublication × N
  endorsementsReceived,    // ReputationGraph.getEndorsement × M
});

console.log({
  total: breakdown.total,
  economic: breakdown.economic.score,
  intellectual: breakdown.intellectual.score,
  social: breakdown.social.score,
  judicial: breakdown.judicial.score,
});
```

## Formula

### v1 — Economic

```
score = sqrt(volumeUSDC) × ageFactor × repMultiplier × decayFactor × weightedAvgRating × 5
       (clamp [0, 100])

  ageFactor      = min(1, daysSinceFirst / 30)
  repMultiplier  = 1 + 0.1·log₂(validCount + 1) − 0.5·revokedRatio
  decayFactor    = max(0, 1 − 0.023·idleDays)
  weightedAvgRating = Σ(rating × roleWeight) / Σ(roleWeight)
```

Role weights: `PROVIDER=1.0`, `CALLER=1.5`, `JUROR=2.0`, `SYSTEM=1.0` (default).

### v2 — 4-Dimensional

```
total = 0.30·economic + 0.25·intellectual + 0.30·social + 0.15·judicial
```

| Dimension | Source | Formula |
|---|---|---|
| Economic | PneumaAttestation | v1 (above) |
| Intellectual | PneumaCommons | `sqrt(citations) × ageFactor × decay × 8` |
| Social | ReputationGraph | `sqrt(stakeUSDC) × diversity × ageFactor × 6` |
| Judicial | PneumaCourt (V6.1) | placeholder = 0 |

All scores clamped to `[0, 100]`.

## Design Invariants

- **Pure TypeScript, zero deps** — no `viem` / `ethers` / `bignumber.js` imports
- **`bigint` in, `number` out** — paidAmount/stakedAmount stay as raw USDC 6-decimals on input; score is normalized 0-100 number
- **Stable across versions** — formula constants (`DECAY_LAMBDA`, `AGE_RAMP_DAYS`, `DIM_WEIGHTS`) are exported and version-locked; future PneumaGovernance proposals to change them will bump major version
- **Same code, frontend + indexer + third-party dApp** — Pneuma's own `apps/hub` re-exports from this package

## License

MIT
