# praximo

## Conventions

Agents write all documents, commit titles, and commit messages in English by default. The package manager is **bun** — use `bun` / `bunx` for all installs, scripts, and tooling.

## Agent skills

### Git workflow

`main` is always green: code lands via squash-merged PRs from `issue-{number}-{slug}` branches; planning docs may land on `main` directly. A `pre-push` hook enforces the split. See `docs/agents/git-workflow.md`.

### Issue tracker

Issues are tracked as GitHub issues in `apshenichniy/praximo`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Effect development

Effect 4 source vendored read-only under `.repos/effect`; the `effect` skill lives at `.claude/skills/effect`. See `docs/agents/effect.md`.
