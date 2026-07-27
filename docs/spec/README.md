# Praximo — MVP Specification

Multi-tenant platform for coaches: session scheduling, video calls, audio recording, transcription, and LLM analysis that amplifies the coach — briefs, debriefs, and ICF-style mentor reviews. The agent never coaches the client itself. Single bounded context in MVP.

This document is the **assembly point** of the MVP spec: the end-to-end product flow, the architecture at a glance, the index of every specification document, and the list of what is deliberately left open. It adds no new decisions — every statement here is a pointer into a document that owns it. Assembled in wayfinder ticket [#13](https://github.com/apshenichniy/praximo/issues/13); the full decision trail lives on the [wayfinder map](https://github.com/apshenichniy/praximo/issues/1).

**How to read:** [CONTEXT.md](../../CONTEXT.md) defines the ubiquitous language — every document follows it. Specs (this directory) describe product behavior; ADRs ([docs/adr/](../adr/)) record architecture decisions; runbooks ([docs/runbooks/](../runbooks/)) are the operator's step-by-step procedures; research write-ups live on `research/*` branches; prototypes in `prototypes/` and on `prototype/*` branches.

## The product flow, end to end

1. **Coach onboarding — manual, no self-registration.** The admin invites the coach from the Mini App's admin section ([admin-surface.md](admin-surface.md)) — the workspace is created lazily behind the invite — delivering a single-use deep link to the platform's manager bot over one of three channels (Telegram share, email, copied link). One tap provisions the coach's own Telegram bot via Managed Bots (manual BotFather token paste is the permanent fallback); branding, webhook, and the Mini App menu button are set programmatically. The coach signs into the Mini App by Ed25519 `initData` verification — no server session, no access to per-coach bot tokens ([ADR 0006](../adr/0006-coach-authentication-in-mvp.md)) — and accepts the terms of service on first login. → [ADR 0004](../adr/0004-bot-per-coach-provisioning.md), [client-onboarding-auth.md](client-onboarding-auth.md), [privacy-copy.md](privacy-copy.md) §4

2. **Client onboarding — invite is the only door.** The coach creates a client (name only) and schedules the first session (kind `intake`) in one Mini App flow — scheduling while consent is pending is allowed. The invite (single-use token, TTL 7 days) is delivered over one of three paths: Telegram share-card, an invite email the service sends itself, or a link the coach forwards manually. Acceptance — in the bot or on the web Acceptance Page — is atomic: language → consent, with an editable profile step (optional Google import) on the web page only (the bot captures the Telegram profile snapshot automatically); it creates the client's Channel, appends the Consent Grant, and sets the client's language. Clients have no accounts — identity attestations (Telegram id, email, Google `sub`) are captured for a post-MVP portal. → [client-onboarding-auth.md](client-onboarding-auth.md), [privacy-retention.md](privacy-retention.md), [privacy-copy.md](privacy-copy.md) §1

3. **Session — join links, web room, reconciler.** Reminders carry per-(session, role) join links — the client's only credential, and in MVP the coach's too. The join window opens 15 minutes before the scheduled start; inside Telegram, links go through a trampoline to the system browser (WebRTC does not work in Telegram webviews). Joint join — both seats occupied — starts the session and two audio Track Egress jobs (no video is stored). Grace, coach-only +15 min extension, a 120-minute room cap, and empty-room idle govern the end; a per-session Durable Object reconciler is the sole writer of terminal states (`completed` / `cancelled` with reasons, including automatic no-show classification). → [web-room-sessions.md](web-room-sessions.md), [ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md), [client-onboarding-auth.md](client-onboarding-auth.md) §Web-room access

4. **Processing — one workflow per completed session.** The reconciler's completion event triggers a Cloudflare Workflow (instance id = session id): per-track Deepgram STT via callback (`waitForEvent`), deterministic merge into the Transcript, then Debrief ∥ Mentor Review in parallel, then the next scheduled session's Brief from the client's prior artifacts. Audio moves by reference — Egress writes to R2, Deepgram fetches by presigned URL; no media bytes transit our code. On retry exhaustion the coach is notified proactively; there is no manual retry control in the product. → [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md), [analysis-artifacts.md](analysis-artifacts.md)

5. **Delivery — the bot delivers, the Mini App archives.** Each artifact arrives in the coach's chat as a `sendDocument` message: the `.md` file (Telegram's viewer renders it), a ≤1024-char caption summary from the same LLM run, and a Mini App reader button. The debrief goes immediately, the mentor review five minutes later; a new brief version replaces the file in the same message. All artifacts are written in the coach's language. The Mini App (hub-and-spoke "Today" dashboard) is the archive and reading surface — no regenerate button in MVP. → [analysis-artifacts.md](analysis-artifacts.md), [mini-app.md](mini-app.md)

6. **Retention and deletion.** Audio is auto-deleted 30 days after transcription (cron sweeper); transcripts and artifacts live until the coach deletes them (hard delete, session-level or full client cascade). Consent revocation goes through the coach and blocks new scheduling only. All first-party data stays in the EU; the only US transfer is LLM analysis via Cloudflare AI Gateway. → [privacy-retention.md](privacy-retention.md)

## Architecture at a glance

| Piece | Decision | Where |
|---|---|---|
| Deploy units | Four Cloudflare Workers — `web` (TanStack Start: coach Mini App and admin surface), `client` (TanStack Start: acceptance page, legal texts, web room), `bot` (grammY, all per-coach bots path-routed), `pipeline` (Workflows, LiveKit webhook receiver, retention cron). Cross-worker communication is typed service bindings only. | [ADR 0002](../adr/0002-monorepo-layout-and-module-boundaries.md) |
| Processing | Cloudflare Workflows orchestrator; R2 pass-by-reference (1 MiB step-payload discipline); **no Queues in MVP**; no container worker. | [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md) |
| Session concurrency | One Durable Object per session — serializes webhooks, commands, due evaluation; alarm at earliest due instant + 15-min safety-net sweeper. Chosen over a minute-cron to let Neon autosuspend. | [ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md) |
| Bots | Bot-per-coach via Telegram Managed Bots, one-tap provisioning; manual token paste fallback; one `bot` Worker serves all bots; tokens AES-GCM-encrypted in Postgres. | [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) |
| Data | Neon Postgres (`aws-eu-central-1`) via Drizzle + serverless driver; content (transcripts, audio, avatars) in R2 (`jurisdiction: eu`), metadata in Postgres. | [domain-model.md](domain-model.md), [ADR 0003](../adr/0003-alchemy-iac-structure.md) |
| IaC | Single root Alchemy 2 stack (pinned `2.0.0-beta.63`), stages `dev_<user>` / `prod`; canonical dev web at `stage.praximo.io`, prod deploys from GitHub Actions on merge. Agent-operable — the human only supplies a secrets file; bootstrap proven by execution from three credential variables. | [ADR 0003](../adr/0003-alchemy-iac-structure.md) |
| External systems | LiveKit self-hosted (EU, `room.praximo.io` per ticket [#8](https://github.com/apshenichniy/praximo/issues/8)) — secrets-only in IaC; Deepgram EU endpoint, zero retention; LLMs via Vercel AI SDK through Cloudflare AI Gateway (the only US transfer); Cloudflare Email Service (`mail.praximo.io`); Telegram Bot API 10.x via grammY. | [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md), [ADR 0003](../adr/0003-alchemy-iac-structure.md), [privacy-retention.md](privacy-retention.md), [#8](https://github.com/apshenichniy/praximo/issues/8) |
| Language/runtime | TypeScript 7.0 (tsgo), Effect 4 beta (workerd compatibility proven by spike, [#17](https://github.com/apshenichniy/praximo/issues/17)), bun + Turborepo, oxlint/oxfmt, `@effect/vitest`. | [ADR 0002](../adr/0002-monorepo-layout-and-module-boundaries.md) |

Domains: `stage.praximo.io` (canonical dev web), `app.praximo.io` (prod web), `api.praximo.io` (prod path-routed webhooks/API), `mail.praximo.io` (email sending) — all per [ADR 0003](../adr/0003-alchemy-iac-structure.md); `room.praximo.io` (LiveKit, external appliance per ticket [#8](https://github.com/apshenichniy/praximo/issues/8)).

## Cross-cutting invariants

- **Workspace is the tenancy boundary** — every row carries `workspace_id` directly or through its parent; no cross-workspace identity.
- **Three languages** (`en | uk | ru`) from day one. Coach language → UI and all artifacts; client language → messages to the client and the STT fallback hint. UK/RU copy addressed at or about the coach must avoid gender-agreeing verb forms — the system does not know the coach's gender.
- **Session lifecycle and processing status are separate dimensions** — no god-status on Session; processing progress lives on Recording / Track Transcript / Transcript / Artifact.
- **At-least-once everywhere** — every webhook handler, workflow step, and command is idempotent; terminal transitions are single-writer (reconciler) plus conditional UPDATE.
- **Recording is unconditional** — no per-session opt-out; a client who declines is met off-platform. Consent is captured once, at onboarding.
- **The bot is the coach's brand** — every client-facing message comes from the coach's own bot, written as the coach's assistant; the platform never fronts itself to clients.
- **ICF materials are paraphrased, never verbatim** — attribute the framework, disclaim affiliation ([#4](https://github.com/apshenichniy/praximo/issues/4)).

## Document index

### Specifications (`docs/spec/`)

| Document | Owns |
|---|---|
| [domain-model.md](domain-model.md) | Entities, relationships, session state machine, language rules |
| [client-onboarding-auth.md](client-onboarding-auth.md) | Coach auth, invites, acceptance (bot + web), web-room access tokens, email channel, manual clients |
| [web-room-sessions.md](web-room-sessions.md) | Session lifecycle: join eligibility, presence, grace/extension, reconciliation, no-show, recording control — with acceptance criteria |
| [analysis-artifacts.md](analysis-artifacts.md) | Brief / Debrief / Mentor Review: shape, section structure, delivery, prompt layout |
| [mini-app.md](mini-app.md) | Coach Mini App: navigation, screens, lifecycle actions |
| [admin-surface.md](admin-surface.md) | Operator surface (BotFather-style Mini App admin section): invite-a-coach flow, coaches list/details, deletion, deep-link lifecycle, manager-bot notifications |
| [privacy-retention.md](privacy-retention.md) | Consent policy, retention, deletion, residency, roles |
| [privacy-copy.md](privacy-copy.md) | The four texts: client consent, pre-join notice, privacy policy, coach ToS (with embedded DPA) |

### Runbooks (`docs/runbooks/`)

| Runbook | Covers |
|---|---|
| [coach-onboarding.md](../runbooks/coach-onboarding.md) | Operator checklist for onboarding one coach: invite, bot connection (one-tap and token fallback), verification, the optional coach-side Main Mini App step, offboarding pointer |

### ADRs (`docs/adr/`)

| ADR | Decision |
|---|---|
| [0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md) | Processing pipeline on Cloudflare Workflows |
| [0002](../adr/0002-monorepo-layout-and-module-boundaries.md) | Monorepo layout and module boundaries |
| [0003](../adr/0003-alchemy-iac-structure.md) | Alchemy IaC structure |
| [0004](../adr/0004-bot-per-coach-provisioning.md) | Bot-per-coach provisioning via Telegram Managed Bots |
| [0005](../adr/0005-session-reconciler-on-durable-objects.md) | Session reconciler on Durable Objects |

### Research (on `research/*` branches)

| Topic | Branch | Ticket |
|---|---|---|
| Telegram Managed Bots API | `research/telegram-managed-bots` | [#2](https://github.com/apshenichniy/praximo/issues/2) |
| CF Workflows + Queues pipeline | `research/cf-workflows-pipeline` | [#3](https://github.com/apshenichniy/praximo/issues/3) |
| ICF materials: content and licensing | `research/icf-materials` | [#4](https://github.com/apshenichniy/praximo/issues/4) |
| Better-Auth × Telegram | `research/better-auth-telegram` | [#5](https://github.com/apshenichniy/praximo/issues/5) |
| Email provider (CF Email Service vs Resend) | `research/email-provider` | [#26](https://github.com/apshenichniy/praximo/issues/26) |
| Agent-operable Cloudflare + Neon | `research/agent-operable-infra` | [#31](https://github.com/apshenichniy/praximo/issues/31) |

### Prototypes

| Prototype | Location | Ticket |
|---|---|---|
| Effect 4 on workerd (spike) | `prototypes/effect4-workerd` | [#17](https://github.com/apshenichniy/praximo/issues/17) |
| Invite delivery flow | `prototypes/invite-delivery-flow.html` | [#19](https://github.com/apshenichniy/praximo/issues/19) |
| Client web flow | `prototypes/client-web-flow` | [#28](https://github.com/apshenichniy/praximo/issues/28) |
| Mini App screens | `prototypes/mini-app-screens` | [#15](https://github.com/apshenichniy/praximo/issues/15) |
| Consent and policy copy | `prototypes/privacy-copy.html` (branch `prototype/privacy-copy`) | [#16](https://github.com/apshenichniy/praximo/issues/16) |
| Analysis artifact templates | `prototypes/analysis-artifacts.html` (branch `prototype/analysis-artifacts`) | [#11](https://github.com/apshenichniy/praximo/issues/11) |
| Infra bootstrap probe | `prototypes/infra-bootstrap` | [#32](https://github.com/apshenichniy/praximo/issues/32) |

## Deliberately open at implementation time

Decisions the map consciously did **not** make; each has a named owner-moment.

- **Reminder and scheduling mechanics** — timing, cadence, timezones, and when the pre-session Brief is delivered. The routing branch is already fixed (`telegram → bot, email → email, manual → coach`, [client-onboarding-auth.md](client-onboarding-auth.md)); the rest is product behavior, not plumbing — it **requires a dedicated grilling session before reminder implementation starts** (owner's decision at spec assembly, [#13](https://github.com/apshenichniy/praximo/issues/13); flagged in [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md)).
- **Default model per analysis task** — sharpens once real prompts exist; multi-model via Vercel AI SDK is fixed, prompts are model-agnostic.
- **Observability and evals for LLM outputs** — AI Gateway logging is on; anything more is post-MVP unless implementation demands it.
- **Legal placeholders** — operator entity, jurisdiction, liability cap, pricing, contact, named LLM providers ([privacy-copy.md](privacy-copy.md)); a launch prerequisite outside this spec's scope.
- **Implementation-time details flagged in their documents:** which Worker hosts the reconciler DO class ([ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md)); wrangler stub removal and the first prod `--adopt` deploy ([ADR 0003](../adr/0003-alchemy-iac-structure.md)); Cyrillic artifact filenames across Telegram clients ([analysis-artifacts.md](analysis-artifacts.md)); on-device Telegram webview cookie behavior ([#5](https://github.com/apshenichniy/praximo/issues/5)); UK/RU translation of the privacy policy and coach terms ([privacy-copy.md](privacy-copy.md)); final wording of all four privacy texts; two-microphone Track Egress acceptance check on the live LiveKit appliance ([#8](https://github.com/apshenichniy/praximo/issues/8)); unverified Managed Bots API details ([ADR 0004](../adr/0004-bot-per-coach-provisioning.md)).

## Out of MVP scope

Post-MVP roadmap (returns only if the destination is redrawn): client booking and rescheduling, calendar integration, coach availability, monetization, client payment tracking, ICF hours journal, session **video** recording, between-sessions layer (checklists, nudges), client assessments, full memory system, coach self-registration, client portal with accounts, email-domain features on synthetic addresses, self-service consent revocation, client-data export archive, sessions without recording, group sessions. The post-MVP idea log rides on [Client onboarding and auth flow](https://github.com/apshenichniy/praximo/issues/14); scope rulings live on the [map](https://github.com/apshenichniy/praximo/issues/1).
