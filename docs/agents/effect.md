# Effect development

## Vendored source (`.repos/effect`)

Effect 4 source is vendored read-only under `.repos/effect` (added via `git subtree --squash`), from the `main` branch of `Effect-TS/effect` — since 2026-07 the canonical home of Effect 4 (the former `effect-smol` is deprecated; v3 lives on the `v3` branch). Includes `ai-docs/`, `LLMS.md`, `MIGRATION.md`.

- Treat `.repos/**` as **read-only reference**: grep it to answer API questions from ground truth instead of guessing.
- **Never import from `.repos/`** in application code — depend on published packages.
- Update: `git subtree pull --prefix=.repos/effect https://github.com/Effect-TS/effect.git main --squash`.

## Effect skill

The `effect` skill (Effect v4 production patterns, from `kitlangton/skills`) is installed for Claude Code at `.claude/skills/effect` (managed by `bunx skills`, pinned in `skills-lock.json`). Consult it when writing any Effect code; its module conventions are the project standard (see ADR 0002).

- Add another agent target: `bunx skills add kitlangton/skills --skill effect --agent <name>`.
