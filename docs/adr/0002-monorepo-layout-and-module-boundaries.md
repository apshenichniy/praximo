# ADR 0002: Monorepo layout and module boundaries

- **Status**: accepted
- **Date**: 2026-07-19
- **Ticket**: [#12](https://github.com/apshenichniy/praximo/issues/12)

## Context

Praximo ships three delivery surfaces on Cloudflare Workers — the TanStack Start web app (including the Telegram Mini App and the web room), the grammY bot serving all per-coach bots, and the processing pipeline on Cloudflare Workflows (ADR 0001). The stack is TypeScript 7.0 + Effect 4 beta, Drizzle + Neon, Deepgram STT behind a provider-agnostic transcription module, Vercel AI SDK, Alchemy 2 IaC. Solo dev + AI agents; agents rely on the `effect` skill (kitlangton/skills) and the vendored Effect source in `.repos/effect`.

## Decision

### Workspace and tooling

- **bun workspaces + Turborepo** orchestrate the monorepo; bun is the package manager for everything.
- **TypeScript 7.0 (tsgo)** for typechecking; **oxlint + oxfmt** for linting and formatting (no ESLint/Prettier/Biome); **vitest + `@effect/vitest`** (published from the Effect 4 monorepo, currently `4.0.0-beta.99`) for tests.
- Turbo task baseline: `build`, `check` (typecheck + lint), `test`.
- Shared presets (tsconfig, oxlint config) live in `@praximo/tooling`; the oxfmt config sits at the repo root.

### Deployment units — `apps/`

Three Workers, each an independent deploy:

| App | Contents |
| --- | --- |
| `apps/web` | TanStack Start: coach UI, Telegram Mini App, web room (LiveKit Components React) |
| `apps/bot` | grammY webhook Worker; serves all per-coach bots via per-bot webhook paths + secret tokens |
| `apps/pipeline` | Cloudflare Workflows (session processing, ADR 0001), the LiveKit webhook receiver, and the audio-retention cron sweeper |

Workflow definitions live in `apps/pipeline`; steps stay thin and call package services.

**Cross-worker communication is service bindings only** (typed `WorkerEntrypoint` RPC, declared in Alchemy): web → pipeline to trigger the brief workflow on session creation and to cancel a session's in-flight run when the coach deletes its data ([privacy-retention.md](../spec/privacy-retention.md)); pipeline → bot for artifact delivery and failure notifications. No public HTTP between our own Workers, no queues (per ADR 0001).

### Shared packages — `packages/`

npm scope **`@praximo/*`**, all private:

| Package | Responsibility |
| --- | --- |
| `@praximo/domain` | Effect Schema entities, branded IDs, domain errors, the ubiquitous language from `CONTEXT.md`. No infrastructure dependencies. |
| `@praximo/db` | Drizzle schema + repository services (Neon). Depends on `domain`; decodes rows into domain types. Apps never touch Drizzle directly. |
| `@praximo/transcription` | Provider-agnostic STT: `Transcription.Service` interface plus the Deepgram implementation under a `./deepgram` subpath. The provider is chosen by layer at pipeline wiring time. `domain` holds only Track Transcript / Transcript types, no provider knowledge. |
| `@praximo/analysis` | Prompts + Vercel AI SDK for Brief / Debrief / Mentor Review. |
| `@praximo/telegram` | Shared grammY client, bot registry, message sending (used by `bot`; `pipeline` delivers through the `pipeline → bot` service binding and shares only the types). |
| `@praximo/auth` | First-party Better-Auth `telegram-mini-app` plugin (per the client onboarding spec). |
| `@praximo/tooling` | tsconfig and oxlint presets. |

### Effect conventions

- The **module-namespace style from the `effect` skill is the project convention**: file-local `Interface` / `Service` / `layer` roles, `export * as UserRepo from "./user-repo.js"` self-export, errors as `Schema.TaggedErrorClass` next to the owning service, operations wrapped in `Effect.fn("UserRepo.get")`.
- **Packages export service tags and layers only** (`layer`, `testLayer` — the skill's names) — never runtimes. Each app composes its own `AppLive` and builds exactly one runtime per Worker entrypoint.
- In `apps/web`, Effect runs **server-side only** (server functions / route handlers); client React stays Effect-free.
- **Errors**: domain errors in `@praximo/domain`; infrastructure errors in the owning package (`db`, `transcription`, `telegram`); apps map errors at their boundaries into HTTP responses or the workflow retry classes of ADR 0001. No shared `errors` package.
- **Config**: each app owns its environment schema via Effect `Config` with a ConfigProvider over the Worker `env`. Packages declare the config they need but never read the environment themselves.

### IaC

A **single root Alchemy 2 program** describes all three Workers, the shared R2 bucket, service bindings, and secrets, parameterized by stage. Detailed structure is deferred to the Alchemy IaC ADR ([#18](https://github.com/apshenichniy/praximo/issues/18)), which inherits this constraint.

## Consequences

- Three independent deploys isolate bot webhook latency from pipeline load and web releases.
- Agents write uniform Effect code by following the installed skill; deviations are a review flag.
- The scaffolding of this skeleton is executed as its own task ticket; this ADR is the source of truth for the layout.
- `@effect/vitest` tracks the Effect 4 beta; the pinned beta version moves with the `effect` dependency.
