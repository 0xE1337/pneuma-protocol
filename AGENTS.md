# AGENTS.md

The canonical agent configuration for this repository is [CLAUDE.md](./CLAUDE.md). Tools that read `AGENTS.md` (Codex, Cursor, Aider, etc.) should follow the same instructions; the skill block below is mirrored from `CLAUDE.md` for tools that do not follow links.

## Agent skills

### Issue tracker

GitHub Issues via the `gh` CLI. Remote not yet configured — once `git remote add origin <url>` lands, `gh issue` commands work with no further setup. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
