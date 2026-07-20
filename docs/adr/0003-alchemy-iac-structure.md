# ADR 0003: Alchemy IaC structure

- **Status**: accepted
- **Date**: 2026-07-19
- **Ticket**: [#18](https://github.com/apshenichniy/praximo/issues/18)

## Context

ADR 0002 fixed a **single root Alchemy 2 program** describing all three Workers (`web`, `bot`, `pipeline`), the shared R2 bucket, service bindings, and secrets, parameterized by stage. This ADR details that program: stages and naming, file layout, secrets and configuration flow, how non-Cloudflare pieces (Neon, self-hosted LiveKit) are represented, and the deploy path.

Alchemy 2 (`2.0.0-beta.x`, npm tag `next`) is a ground-up rewrite **on Effect**: the program is an `Alchemy.Stack` running an `Effect.gen` body, Workers are declared as Effect classes next to their runtime code, and cross-worker RPC, Workflows, cron, R2, AI Gateway, and Neon are first-class resources. This matches the project's Effect 4 commitment ideologically — and adds a third deliberate beta to the stack (after TS 7.0 and Effect 4). Facts below were verified against the v2 source (`alchemy-run/alchemy@main`), since beta docs lag.

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
- Dev: **`workers.dev`** URLs only (stable per stage; sufficient for Telegram/LiveKit webhooks). No dev custom domains.

### Deploy and state

- **Dev** deploys from the developer's machine: `alchemy dev` (local workerd + real cloud resources in the personal stage) and `alchemy deploy`.
- **Prod** deploys from **GitHub Actions on merge to `main`**: `bun alchemy deploy --stage prod --yes`. PRs run `check`/`test` only — no `alchemy plan`, no deploys. **`alchemy destroy` is forbidden in CI.**
- State store: **`Cloudflare.state()`** (Durable Object + SQLite in our account) — required for CI, survives machine changes; no local state files as source of truth.

### Secrets and configuration

- Boundary: **IaC secrets are platform keys** — Deepgram, LLM/AI Gateway keys, Neon (provider API key), Telegram manager-bot token, Better-Auth keys, LiveKit URL/API key/secret. **Per-coach bot tokens are runtime data in Postgres** (created during coach onboarding via Managed Bots); IaC never sees them.
- Source of truth: a single gitignored **`.env` at the repo root**. The program reads values via `Config.redacted(...)`; Redacted/Config values become Worker **`secret_text` bindings** (v2 routes them by shape; prop name is `env`).
- CI receives secrets as **one GitHub Actions secret `ENV_FILE`** (the file's contents), synced by the agent with `gh secret set ENV_FILE < .env`, plus `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY` for Alchemy itself.
- **We declare no Cloudflare Secrets Store resources of our own**: `.env` is already the source of truth; an account-level store adds nothing at this scale. This is not the same as the account never using one — Alchemy's `Cloudflare.state()` keeps its own bearer token and AES-CTR key in the account-wide Secrets Store, so the deploy token **must** carry `Secrets Store Edit` (rendered *Account Secrets Store Edit* in the dashboard). Amended per [#31](https://github.com/apshenichniy/praximo/issues/31), which corrects the original wording.
- `CLOUDFLARE_API_TOKEN` is an **account-owned** token (`cfat_`, not tied to a personal login); nothing in this stack requires a Global API Key. The exact two-policy permission set, and the bounded list of dashboard actions no token can perform, are fixed by [#31](https://github.com/apshenichniy/praximo/issues/31) (`docs/research/agent-operable-infra.md`, branch `research/agent-operable-infra`) and exercised by [#32](https://github.com/apshenichniy/praximo/issues/32). Note that Durable Objects, Workflows and cron triggers have **no permission group of their own** and ride on `Workers Scripts Edit`.

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

## Consequences

- The hand-written `wrangler.jsonc` stubs in `apps/*` are deleted; v2 neither generates nor needs wrangler config (typed env is inferred from the stack). `turbo.json` build inputs drop `wrangler.jsonc`; local development runs through `alchemy dev`. Executing this is an implementation ticket, not part of this ADR.
- `alchemy` is **pinned to an exact beta version** and upgraded deliberately — the third beta in the stack is an accepted, monitored risk.
- A fresh Neon project means no data migration concerns; the first prod deploy creates the database, branch, and schema in one pass.
- One merge to `main` is a full prod release: Workers, routes, DNS, gateway, DB migrations. Rollback is a revert commit plus redeploy.
- The guiding principle — *the agent does all devops; the human only supplies a secrets file* — **survives contact with the real APIs, with a bounded carve-out**. Every steady-state operation this ADR describes is API-drivable. The exceptions are the acts that mint credentials or attach money, and they are all once-ever: the R2 subscription checkout (a **separate entitlement from Workers Paid**, and a hard blocker on bucket creation), the Workers Paid subscription, the dashboard-minted bootstrap token, Neon organization creation and plan choice, and the first personal Neon key. The only recurring exception is Cloudflare's Email Sending quota-increase form, which should never bind at MVP volume. The authoritative list lives in [#31](https://github.com/apshenichniy/praximo/issues/31) and is amended by whatever [#32](https://github.com/apshenichniy/praximo/issues/32) discovers in execution.
