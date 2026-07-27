# ADR 0003: Alchemy IaC structure

- **Status**: accepted
- **Date**: 2026-07-19 (verified by execution 2026-07-20, [#32](https://github.com/apshenichniy/praximo/issues/32); dev-domain exception added 2026-07-23, [#84](https://github.com/apshenichniy/praximo/issues/84))
- **Ticket**: [#18](https://github.com/apshenichniy/praximo/issues/18) — bootstrap proven by [#32](https://github.com/apshenichniy/praximo/issues/32)

## Context

ADR 0002 fixed a **single root Alchemy 2 program** describing all the Workers (`web`, `bot`, `pipeline` when this was written; `client` joined them with [#191](https://github.com/apshenichniy/praximo/issues/191)), the shared R2 bucket, service bindings, and secrets, parameterized by stage. This ADR details that program: stages and naming, file layout, secrets and configuration flow, how non-Cloudflare pieces (Neon, self-hosted LiveKit) are represented, and the deploy path.

Alchemy 2 (`2.0.0-beta.x`, npm tag `next`) is a ground-up rewrite **on Effect**: the program is an `Alchemy.Stack` running an `Effect.gen` body, Workers are declared as Effect classes next to their runtime code, and cross-worker RPC, Workflows, cron, R2, AI Gateway, and Neon are first-class resources. This matches the project's Effect 4 commitment ideologically — and adds a third deliberate beta to the stack (after TS 7.0 and Effect 4). Facts below were first verified against the v2 source (`alchemy-run/alchemy@main`), since beta docs lag, and then **proven by execution against the real Cloudflare + Neon accounts** in [#32](https://github.com/apshenichniy/praximo/issues/32) (`alchemy@2.0.0-beta.63`, deploy → verify → destroy). See [Verification and adoption](#verification-and-adoption-32) for the corrections that surfaced.

Guiding principle for every choice here: **the agent does all devops; the human only supplies a secrets file.**

## Decision

### Stages and naming

- Two stages: the personal default **`dev_<user>`** (Alchemy's default, e.g. `dev_alexander`) and **`prod`** (`--stage prod`). Ad-hoc named stages (`--stage exp-foo`) are allowed by construction; nothing depends on them.
- **No preview/per-PR environments in MVP.**
- Physical resource names are **Alchemy-generated** (`praximo-<stage>-<id>-<hash>`); we do not pin `name` manually. State tracks identity; dashboard aesthetics lose to zero naming decisions.

### Program layout

- Root **`alchemy.run.ts`** holds the single `Alchemy.Stack("Praximo", { providers, state }, ...)` — providers: `Cloudflare.providers()` + `Neon.providers()`.
- **Worker declarations live next to their code** in `apps/*/src` (`class Web extends Cloudflare.Worker<Web>()(...)` with `main: import.meta.path`); the root stack imports and `yield*`s them. This is the official v2 monorepo-single-stack pattern.
- Service bindings are typed RPC via `Cloudflare.Worker.bind` / `Cloudflare.Workers.bindWorker` (web → pipeline, pipeline → bot, per ADR 0002); cron via `Cloudflare.Workers.cron` in the pipeline Worker's init phase; Workflows as Effect-native `Cloudflare.Workflow` classes in `apps/pipeline`.

### Domains and routing

- Prod web: **`app.praximo.io`** as a Worker custom domain.
- Prod webhooks/API: one **`api.praximo.io`** hostname shared by path-based zone routes — `api.praximo.io/telegram/*` → bot Worker, `api.praximo.io/livekit/*` and STT callback paths → pipeline Worker (`routes: [{ pattern, zoneName }]` + a proxied `Cloudflare.DNS.Record` AAAA `100::` for the hostname). Verified: distinct path patterns on one hostname may target different Workers.
- The `praximo.io` **zone pre-exists** in the Cloudflare account; Alchemy manages records and routes inside it, not the zone itself.
- Canonical dev web: **`stage.praximo.io`** is a Worker custom domain bound only to `dev_apshenichniy`. Telegram's @BotFather Main Mini App input could not persist the generated hostname, so the platform-owned dev manager bot needs one short URL that remains stable across Worker deployments ([#84](https://github.com/apshenichniy/praximo/issues/84)).
- Other dev surfaces stay on **`workers.dev`**: the canonical bot and pipeline Workers, and every non-canonical personal/ad-hoc stage including its web Worker. `stage.praximo.io` is singular by design and must never move implicitly when another personal stage deploys.

### Deploy and state

- **Dev** deploys from the developer's machine: `alchemy dev` (local workerd + real cloud resources in the personal stage) and `alchemy deploy`. **Non-interactive runs must set `CI=1`** (e.g. `CI=1 alchemy deploy --stage dev_<user> --yes`) — without it Alchemy expects an interactive `alchemy login` and fails with `AuthError` even when the `.env` creds are present ([#32](https://github.com/apshenichniy/praximo/issues/32)).
- **`bun run deploy` is that command** ([#152](https://github.com/apshenichniy/praximo/issues/152)): it sets `CI=1`, resolves the stage as `--stage` → `APP_STAGE` → `dev_<user>` so a deploy cannot target a different stage from the `db:reset` that just ran against it, refuses a stage that is neither `dev_<name>` nor `prod` (`staging` does not exist here), requires `--confirm-prod` before prod, and forwards everything else — `--dry-run`, `--force`, `--adopt` — to the CLI.
- **Prod** deploys from **GitHub Actions on merge to `main`**: `CI=1 bun alchemy deploy --stage prod --yes`. PRs run `check`/`test` only — no `alchemy plan`, no deploys. **`alchemy destroy` is forbidden in CI.**
- Branch-per-stage extends to **branch-per-CI-run**: every run creates a schema-only `ci-run-*` branch of the dev project, migrates it with this checkout's `packages/db/migrations`, runs the repository suites against it and deletes it (`scripts/ci-neon-branch.ts`, [#136](https://github.com/apshenichniy/praximo/issues/136)). The suites use the same **neon-http** driver as production, so the no-interactive-transactions constraint they are written around still holds; a run without `DATABASE_URL` fails rather than skipping them.
- State store: **`Cloudflare.state()`** (Durable Object + SQLite in our account) — required for CI, survives machine changes; no local state files as source of truth.

### Secrets and configuration

- Boundary: **IaC secrets are platform keys** — Deepgram, LLM/AI Gateway keys, Neon (provider API key), Telegram manager-bot token, LiveKit URL/API key/secret. (Better-Auth keys were listed here before [ADR 0006](0006-coach-authentication-in-mvp.md) deferred Better Auth; none exist. Coach auth needs no secret at all — the Ed25519 trust anchor is Telegram's public key, hardcoded and selected by the non-secret `TELEGRAM_ENV`.) **Per-coach bot tokens are runtime data in Postgres** (created during coach onboarding via Managed Bots); IaC never sees them.
- Source of truth: a single gitignored **`.env` at the repo root**. The program reads values via `Config.redacted(...)`; Redacted/Config values become Worker **`secret_text` bindings** (v2 routes them by shape; prop name is `env`).
- CI receives secrets as **one GitHub Actions secret `ENV_FILE`** (the file's contents), synced by the agent with `gh secret set ENV_FILE < .env`, plus `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY` for Alchemy itself. `NEON_API_KEY` is also what PR CI provisions its per-run database branch with, alongside the non-secret repository variable `NEON_PROJECT_ID`; the connection URI is masked and never leaves `$GITHUB_ENV`.
- **We declare no Cloudflare Secrets Store resources of our own**: `.env` is already the source of truth; an account-level store adds nothing at this scale. This is not the same as the account never using one — Alchemy's `Cloudflare.state()` keeps its own bearer token and AES-CTR key in the account-wide Secrets Store, so the deploy token **must** carry `Secrets Store Edit` (rendered *Account Secrets Store Edit* in the dashboard). Amended per [#31](https://github.com/apshenichniy/praximo/issues/31), which corrects the original wording.
- `CLOUDFLARE_API_TOKEN` is an **account-owned** token (`cfat_`, not tied to a personal login); nothing in this stack requires a Global API Key. The exact two-policy permission set, and the bounded list of dashboard actions no token can perform, are fixed by [#31](https://github.com/apshenichniy/praximo/issues/31) (`docs/research/agent-operable-infra.md`, branch `research/agent-operable-infra`) and exercised by [#32](https://github.com/apshenichniy/praximo/issues/32). Note that Durable Objects, Workflows and cron triggers have **no permission group of their own** and ride on `Workers Scripts Edit`.
- **The token must also carry `Workers Observability` (read), or `alchemy logs` cannot read a Worker's logs.** Same shape as the `Secrets Store Edit` finding above: a permission group nothing else needs, whose absence is invisible until the one command that wants it is run. Symptom, observed 2026-07-25: `alchemy logs` fails with `AuthError` / `Unauthorized` while every other operation — including `deploy` — works, because it is a `POST /accounts/{id}/workers/observability/telemetry/query` that answers `403` on its own. **Nothing in the program needs changing**: Alchemy enables Workers Logs by default (`observability` defaults to `{ enabled: true, logs: { enabled: true, invocationLogs: true } }` on `Cloudflare.Worker`), so the logs were being written all along and only the reader was locked out.
  - The cost of not having it is concrete rather than theoretical: two coach-onboarding defects ([#150](https://github.com/apshenichniy/praximo/issues/150), [#154](https://github.com/apshenichniy/praximo/issues/154)) were diagnosed by reading Postgres timestamps because the log lines those very tickets added could not be read back. With the group added, the third one was answered in a single `alchemy logs` call. **Treat a stage whose logs cannot be read as an unfinished stage.**
  - Minting and editing the token stays a dashboard act, so this joins the human carve-out list in [Consequences](#consequences) rather than becoming something the agent can repair.

### Neon (managed by IaC)

- The stack **creates the Neon project from scratch**: `Neon.Project` with a **branch per stage** — prod uses the project default branch, `dev_<user>` gets its own `Neon.Branch`.
- **`region: "aws-eu-central-1"` (Frankfurt) is passed explicitly.** `Neon.Project` defaults to `aws-us-east-1`, which violates the EU-residency posture of [#6](https://github.com/apshenichniy/praximo/issues/6); the resource **diffs on `region`**, so a wrong first deploy means project replacement, not an update. Alchemy's `NeonRegion` union still lists `azure-*` regions Neon has deprecated for new projects — do not use them. Added per [#31](https://github.com/apshenichniy/praximo/issues/31); the ADR was previously silent here.
- `NEON_API_KEY` is an **organization** API key. A project-scoped key can neither create the project nor delete the project it belongs to; the org key scopes every request to the org, so no `org_id` plumbing is needed. Organization *member* management still requires a personal admin key and stays off the deploy path.
- **Drizzle migrations auto-apply at deploy** via `migrationsDir` (applied over the branch's direct `connectionUri`, tracked in the `neon_migrations` table; re-applied only when file hashes change).
- Workers connect with **`@neondatabase/serverless`** (HTTP driver) + Drizzle; the branch's connection URI is passed as a secret binding. **No Hyperdrive in MVP** — add it point-wise if DB latency ever warrants.

### AI Gateway

- The LLM gateway is **stack-managed**: `Cloudflare.AI.Gateway` (verified present in v2, incl. provider keys and spend limits) rather than hand-configured in the dashboard.

### LiveKit

- The self-hosted LiveKit deployment stays an **external system represented only by secrets** (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`); Alchemy neither creates nor manages it.

### Verification and adoption (#32)

The whole decision above was **run end-to-end** from the three-variable root `.env` against the real accounts (`alchemy@2.0.0-beta.63`, isolated `dev_probe32` stage, deploy → verify against live APIs → destroy). A reference scaffold and full run log live at [`prototypes/infra-bootstrap`](../../prototypes/infra-bootstrap). What held, and the corrections that surfaced:

- **Everything provisioned unaided**: Neon project (`aws-eu-central-1` ✓) + branch + Drizzle migration; R2 `jurisdiction: eu`; `Cloudflare.state()`; AI Gateway with a cost cap; three Workers + service bindings + a Workflow + a cron trigger; and the `mail.praximo.io` Email Sending subdomain — **no dashboard touched**. `workers.dev` subdomains auto-claim.
- **Email Sending needs no extra scope and no hidden dashboard step**: the account-scoped Email Sending permission authorized the *zone-scoped* subdomain endpoint (no 403), and the REST call alone provisions and enables a *subdomain* (SPF/DKIM/DMARC/cf-bounce auto-created). #31's two flagged email unknowns are resolved.
- **`alchemy@2.0.0-beta.63` runtime peer deps** beyond the three creds: `@effect/platform-node`, `@effect/platform-bun`, `@effect/sql-pg` (all `4.0.0-beta.99`), and `drizzle-orm` / `drizzle-kit` (`1.0.0-rc.4`). The platform-agnostic `@effect/platform` has no 4.x line and is not needed on Effect 4. Pin `alchemy` at **exactly `2.0.0-beta.63`**.
- **A live `praximo-prod` stack already exists** (a prior bootstrap): workers `praximo-prod-{web,api,pipeline}`, the `alchemy-state-store` Worker, the `app.praximo.io` **custom domain** (bound to `praximo-prod-web`), and the `app`/`api` `AAAA 100::` records. The first real root-stack deploy must therefore **`--adopt` the existing state**, not create from zero, or the custom-domain and DNS resources collide (Alchemy refuses to re-attach `app.praximo.io` with a clean error).
- **`alchemy destroy` is not quite clean for Email Sending**: it removes the subdomain and its SPF/DKIM/cf-bounce records but **leaves `_dmarc.mail.praximo.io`** — delete it manually.

## Consequences

- The hand-written `wrangler.jsonc` stubs in `apps/*` are deleted; v2 neither generates nor needs wrangler config (typed env is inferred from the stack). `turbo.json` build inputs drop `wrangler.jsonc`; local development runs through `alchemy dev`. Executing this is an implementation ticket, not part of this ADR.
- `alchemy` is **pinned to an exact beta version** (`2.0.0-beta.63`, the version exercised by [#32](https://github.com/apshenichniy/praximo/issues/32)) and upgraded deliberately — the third beta in the stack is an accepted, monitored risk.
- A fresh Neon project means no data migration concerns; the first prod deploy creates the database, branch, and schema in one pass. **Caveat**: prod was already partially bootstrapped (see [Verification and adoption](#verification-and-adoption-32)), so the first root-stack deploy runs with `--adopt` against the existing `praximo-prod` state rather than creating from zero.
- One merge to `main` is a full prod release: Workers, routes, DNS, gateway, DB migrations. Rollback is a revert commit plus redeploy.
- The guiding principle — *the agent does all devops; the human only supplies a secrets file* — **survives contact with the real APIs, with a bounded carve-out**. Every steady-state operation this ADR describes is API-drivable. The exceptions are the acts that mint credentials or attach money, and they are all once-ever: the R2 subscription checkout (a **separate entitlement from Workers Paid**, and a hard blocker on bucket creation), the Workers Paid subscription, the dashboard-minted bootstrap token, Neon organization creation and plan choice, and the first personal Neon key. The few recurring exceptions are teardown- or edge-path-only (e.g. Cloudflare's Email Sending quota-increase form, which should never bind at MVP volume, and the `_dmarc` destroy orphan above). The authoritative list lives in [#31](https://github.com/apshenichniy/praximo/issues/31) and is amended by whatever [#32](https://github.com/apshenichniy/praximo/issues/32) discovers in execution.
- **Editing that token's permissions is on the same list, and it recurs in practice.** `Workers Observability` had to be added by hand before the agent could read a Worker's logs (see Secrets and configuration above). The pattern to expect: a permission group missing from the original two-policy set surfaces the first time a command needs it, as an `Unauthorized` on one endpoint while everything else keeps working — cheap to diagnose *if* the failing endpoint is read out of the error, and expensive if it is mistaken for a broken feature.
