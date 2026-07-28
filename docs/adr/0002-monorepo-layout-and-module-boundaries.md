# ADR 0002: Monorepo layout and module boundaries

- **Status**: accepted
- **Date**: 2026-07-19; amended 2026-07-28 by #215
- **Ticket**: [#12](https://github.com/apshenichniy/praximo/issues/12)

## Context

Praximo ships distinct Platform Admin, Coach, and Client job contexts plus a
staged landing surface. The original combined `apps/web` and duplicated
`apps/client` design system made those contexts share deployment and visual
ownership accidentally. #215 split the applications and introduced the shared
Maia foundation after the third visual surface made duplicated tokens and
primitives the more expensive boundary.

The stack is TypeScript 7.0 + Effect 4 beta, Drizzle + Neon, TanStack Start for
the product applications, Astro for the landing application, Deepgram STT
behind a provider-agnostic transcription module, Vercel AI SDK, and Alchemy 2
IaC. Solo dev + AI agents; agents rely on the `effect` skill and the vendored
Effect source in `.repos/effect`.

## Decision

### Workspace and tooling

- **bun workspaces + Turborepo** orchestrate the monorepo; bun is the package manager for everything.
- **TypeScript 7.0 (tsgo)** for typechecking; **oxlint + oxfmt** for linting and formatting (no ESLint/Prettier/Biome); **vitest + `@effect/vitest`** (published from the Effect 4 monorepo, currently `4.0.0-beta.99`) for tests.
- Turbo task baseline: `build`, `check` (typecheck + lint), `test`.
- Shared presets (tsconfig, oxlint config) live in `@praximo/tooling`; the oxfmt config sits at the repo root.

### Deployment units — `apps/`

Six applications, independently represented in the root Alchemy graph:

| App | Contents |
| --- | --- |
| `apps/admin` | TanStack Start: Platform Admin console and Manager Bot onboarding companion. `admin.praximo.io` |
| `apps/coach` | TanStack Start: Coach practice workflows. Telegram is the only deployed MVP host, isolated behind a presentation-host adapter. `coach.praximo.io` |
| `apps/client` | TanStack Start: minimal browser foundation and current technical/legal routes. Client product work starts with #57. `me.praximo.io` |
| `apps/www` | Astro static output served from Cloudflare Assets. `stage.praximo.io` until #176 authorizes a public launch. |
| `apps/bot` | grammY webhook Worker; serves all per-coach bots via per-bot webhook paths + secret tokens |
| `apps/pipeline` | Cloudflare Workflows (session processing, ADR 0001), the LiveKit webhook receiver, and the audio-retention cron sweeper |

Admin and Coach are separate job contexts even when one person has both
capabilities. The Manager Bot opens Admin; a Workspace Bot opens Coach. There is
no cross-navigation between them except the onboarding notice that the Coach
Bot is ready.

The future Web Room remains a Client App surface because the coach joins from
an external browser: the Coach App credential must never reach it (ADR 0006).
#215 does not implement the Client product, Conference Core, or role harnesses.
They arrive in order through #57, #64, and #65 on top of this topology.

**All visual applications share `@praximo/ui`.** The package owns the Maia CSS,
light/dark semantic tokens, interface typography recipes, shadcn primitives
actually used by consumers, `cn`, motion foundations, reduced-motion behavior,
the host-neutral feedback contract, and UI Lab. It must not import Telegram
SDKs, TanStack application code, routers, or business/domain features. Apps may
add app-only CSS but may not override the shared base contract or copy shared
primitives.

Workflow definitions live in `apps/pipeline`; steps stay thin and call package services.

**Cross-worker communication is service bindings only** (typed
`WorkerEntrypoint` RPC, declared in Alchemy): Coach → Pipeline for session
workflow operations; Admin/Coach → Bot for the narrow capabilities whose
credentials may not leave the Bot Worker; Pipeline → Bot for artifact delivery
and failure notifications. No public HTTP between our own Workers and no queues
in MVP.

### Shared packages — `packages/`

npm scope **`@praximo/*`**, all private:

| Package | Responsibility |
| --- | --- |
| `@praximo/domain` | Effect Schema entities, branded IDs, domain errors, the ubiquitous language from `CONTEXT.md`. No infrastructure dependencies. |
| `@praximo/db` | Drizzle schema + repository services (Neon). Depends on `domain`; decodes rows into domain types. Apps never touch Drizzle directly. |
| `@praximo/transcription` | Provider-agnostic STT: `Transcription.Service` interface plus the Deepgram implementation under a `./deepgram` subpath. The provider is chosen by layer at pipeline wiring time. `domain` holds only Track Transcript / Transcript types, no provider knowledge. |
| `@praximo/analysis` | Prompts + Vercel AI SDK for Brief / Debrief / Mentor Review. |
| `@praximo/telegram` | Shared grammY client, bot registry, message sending (used by `bot`; `pipeline` delivers through the `pipeline → bot` service binding and shares only the types). |
| `@praximo/auth` | Telegram Mini App credential verification — manager HMAC for Admin, Ed25519 `validate3rd` for Coach (ADR 0006) — plus the coach onboarding deep-link token. Pure crypto and config; each application owns its composition. |
| `@praximo/i18n` | The i18n **mechanism** shared by Coach, Client, and Bot: gap filling, plural forms, locale-aware formatters, and content digests. Catalogues remain surface-owned except texts whose accepted version is recorded. |
| `@praximo/ui` | Shared Maia theme, semantic interface typography, source-owned shadcn primitives, utilities, motion/reduced-motion foundation, host-neutral feedback contract, and UI Lab. No Telegram, router, TanStack application, or business/domain imports. |
| `@praximo/tooling` | tsconfig and oxlint presets. |

### Effect conventions

- The **module-namespace style from the `effect` skill is the project convention**: file-local `Interface` / `Service` / `layer` roles, `export * as UserRepo from "./user-repo.js"` self-export, errors as `Schema.TaggedErrorClass` next to the owning service, operations wrapped in `Effect.fn("UserRepo.get")`.
- **Packages export service tags and layers only** (`layer`, `testLayer` — the skill's names) — never runtimes. Each app composes its own `AppLive` and builds exactly one runtime per Worker entrypoint.
- In `apps/admin` and `apps/coach`, Effect runs **server-side only** (server
  functions / route handlers); client React stays Effect-free.
- **Errors**: domain errors in `@praximo/domain`; infrastructure errors in the owning package (`db`, `transcription`, `telegram`); apps map errors at their boundaries into HTTP responses or the workflow retry classes of ADR 0001. No shared `errors` package.
- **Config**: each app owns its environment schema via Effect `Config` with a ConfigProvider over the Worker `env`. Packages declare the config they need but never read the environment themselves.

### IaC

A **single root Alchemy 2 program** describes all applications, the shared R2
bucket, service bindings, assets, domains, and secrets, parameterized by stage.
Detailed structure lives in ADR 0003.

## Consequences

- Independent deploys isolate Admin, Coach, Client, Bot, Pipeline, and WWW
  release/runtime concerns. Telegram runtime stays out of Client and WWW.
- A future environment split is configuration/IaC only; it does not reunite or
  split application code again.
- Agents write uniform Effect code by following the installed skill; deviations are a review flag.
- The scaffolding of this skeleton is executed as its own task ticket; this ADR is the source of truth for the layout.
- `@effect/vitest` tracks the Effect 4 beta; the pinned beta version moves with the `effect` dependency.
