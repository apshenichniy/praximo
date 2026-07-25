# praximo

## Conventions

Agents write all documents, commit titles, and commit messages in English by default. The package manager is **bun** — use `bun` / `bunx` for all installs, scripts, and tooling.

## Workspace layout

bun workspaces + Turborepo. Three deployable Workers in `apps/` (`web`, `bot`, `pipeline`), seven private `@praximo/*` packages in `packages/`. [ADR 0002](docs/adr/0002-monorepo-layout-and-module-boundaries.md) is the source of truth for the layout and the module boundaries.

Commands: `bun run check` (typecheck every workspace, then lint), `bun run test`, `bun run build` (bundles each Worker for workerd via `wrangler --dry-run`), `bun run format`.

Conventions worth knowing before writing code here:

- **Packages are consumed as TypeScript source.** Every `@praximo/*` package points `exports` at `./src/index.ts`; nothing builds to `dist`. Only apps have a `build`, and it is the Worker bundle.
- **Import specifiers carry the `.ts` extension** (`import { Workspace } from "./workspace.ts"`), matching the Effect v4 source. The `effect` skill's examples still show `.js` — the pinned source wins, per the skill's own Source Rule.
- **Service modules follow the module-namespace style**: file-local `Interface` / `Service` / `layer`, errors next to the owning service, operations wrapped in `Effect.fn`, and `export * as Name from "./file.ts"` at the bottom. `packages/telegram/src/bot-registry.ts` is the reference implementation. Plain domain data (`packages/domain`) uses ordinary named exports.
- **The `effect` skill's names win** where a doc paraphrases it loosely — the skill is maintained by an Effect maintainer and tracks the library. Test layers are `testLayer`, not `layerTest`.
- **Placeholder layers fail loudly.** Every adapter in the skeleton is unwired and returns a typed error rather than pretending to work; they use `Layer.sync` because they acquire nothing yet.
- **The `@praximo/db` suites need a real Postgres.** Locally they skip (loudly) without `DATABASE_URL` — `bun run db:reset` provisions the dev Neon branch. CI creates a schema-only branch per run and *fails* when the URL is missing, so a skipped database suite can never read as a passing one (#136).
- **Toolchain pins live in the root `catalog`.** `effect` and `@effect/vitest` track the same beta and move together.
- **This repository owns LiveKit maintenance.** `deploy/livekit/README.md` is the canonical rebuild, upgrade, rollback, rotation, and diagnostics runbook. The local root `.env.livekit` is the mode-`0600`, gitignored five-key recovery source; never print or commit its values. Run `bun run livekit:check` before maintenance and `bun run livekit:status` for read-only live verification.

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

Effect 4 source vendored read-only under `.repos/effect`; the `effect` skill lives in the canonical store at `.agents/skills/effect`, which agent directories symlink into. See `docs/agents/effect.md`.
