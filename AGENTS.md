# praximo

## Conventions

Agents write all documents, commit titles, and commit messages in English by default.

The package manager is **bun**. Use `bun` / `bunx` for all installs, scripts, and tooling.

## Vendored reference repositories

External source code lives under `.repos/` as read-only reference material (added via `git subtree --squash`):

- `.repos/effect` — Effect 4 source, vendored from the `main` branch of `Effect-TS/effect` (since 2026-07 the canonical home of Effect 4; the former `effect-smol` repo is deprecated, v3 lives on the `v3` branch). Includes `ai-docs/`, `LLMS.md`, and `MIGRATION.md`.

Rules:

- Treat `.repos/**` as **read-only reference**: grep it to answer API questions from ground truth instead of guessing.
- **Never import from `.repos/`** in application code; depend on published packages instead.
- Update with `git subtree pull --prefix=.repos/effect https://github.com/Effect-TS/effect.git main --squash`.

## Effect skill

The `effect` skill (Effect v4 production patterns, from `kitlangton/skills`) is installed at project scope for all agents (`.agents/skills/effect`, symlinked into per-agent dirs; managed by `bunx skills`). Consult it when writing any Effect code.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in `apshenichniy/praximo`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
