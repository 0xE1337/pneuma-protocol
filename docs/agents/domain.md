# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo uses **single-context** layout — Pneuma terminology (Soul, Skill, Attestation, Boundary, Slash, Stake, Escrow, Rater Role, TBA, x402, Skill Firewall) is shared across `contracts/`, `services/`, `apps/`, `packages/`, and `orchestrator/`, so one root-level glossary covers the whole monorepo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-...-decision.md
│   └── 0002-...-decision.md
├── apps/
├── contracts/
├── packages/
├── services/
└── orchestrator/
```

If a sub-module (e.g. a single package or service) later grows its own divergent vocabulary, escalate to multi-context layout — add a root `CONTEXT-MAP.md` and per-module `CONTEXT.md` files. Re-run `/setup-matt-pocock-skills` to refresh this file.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
