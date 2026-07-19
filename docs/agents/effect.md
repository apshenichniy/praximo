# Effect development

## Vendored source (`.repos/effect`)

Effect 4 source is vendored read-only under `.repos/effect` (added via `git subtree --squash`), from the `main` branch of `Effect-TS/effect` — since 2026-07 the canonical home of Effect 4 (the former `effect-smol` is deprecated; v3 lives on the `v3` branch). Includes `ai-docs/`, `LLMS.md`, `MIGRATION.md`.

- Treat `.repos/**` as **read-only reference**: grep it to answer API questions from ground truth instead of guessing.
- **Never import from `.repos/`** in application code — depend on published packages.
- Update: `git subtree pull --prefix=.repos/effect https://github.com/Effect-TS/effect.git main --squash`.

## Effect skill

The `effect` skill (Effect v4 production patterns, from `kitlangton/skills`) is managed by `bunx skills` and pinned in `skills-lock.json`. Consult it when writing any Effect code; its module conventions are the project standard (see ADR 0002).

**`.agents/skills/` is the canonical store** — the real files live there, and agent directories link into it:

- `.agents/skills/effect` — the store, and what "universal" agents (Codex among them) read directly.
- `.claude/skills/effect` — a relative symlink into the store. Claude Code has no separate copy.

Edit the store, never an agent directory. Symlinking is `bunx skills`' own default (`--copy` opts out), so let the tool manage the layout rather than moving files by hand — `skills-lock.json` tracks what it installed.

- Add another agent target: `bunx skills add kitlangton/skills --skill effect --agent <name>` (repeat `--agent` per target; a comma-separated list is rejected). `bunx skills ls` shows which agents a skill is wired to.
