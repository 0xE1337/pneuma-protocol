# CLAUDE.md

Project entrypoint for Claude Code working in `pneuma-protocol`. The full ruleset lives under `.claude/rules/` (web/solidity/common). This file is the index that other agent configurations point to.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. Git remote is not yet configured — once `git remote add origin <url>` lands and the repo is pushed, `gh issue create / view / list / comment / edit / close` work without further setup. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` at the repo root plus `docs/adr/` for architectural decisions. Pneuma terminology (Soul / Skill / Attestation / Boundary / Slash / Stake / Escrow / Rater Role / TBA / x402 / Skill Firewall) is shared across `contracts/`, `services/`, `apps/`, `packages/`, and `orchestrator/`, so one glossary covers the whole monorepo. See `docs/agents/domain.md`.
