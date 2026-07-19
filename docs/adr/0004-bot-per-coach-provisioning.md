# ADR 0004: Bot-per-coach provisioning via Telegram Managed Bots

- **Status**: accepted
- **Date**: 2026-07-20
- **Ticket**: [#9](https://github.com/apshenichniy/praximo/issues/9)

## Context

The baseline decision is **bot-per-coach**: the bot a client talks to carries the coach's brand. The open question was the mechanism. Research ([#2](https://github.com/apshenichniy/praximo/issues/2), `docs/research/telegram-managed-bots.md` on `research/telegram-managed-bots`) established that Telegram **Managed Bots** (Bot API 9.6, extended in 10.0) provides exactly the provisioning primitive needed: our platform bot prompts the coach to create a bot in one tap, the coach owns it, and we fetch its token via `getManagedBotToken` — no BotFather copy-paste. grammY v1.45+ covers every piece, including the Cloudflare Workers adapter.

Constraints inherited from prior decisions: the `bot` Worker owns all Telegram traffic behind `api.praximo.io/telegram/*` (ADR 0002, ADR 0003); per-coach bot tokens are **runtime data in Postgres**, never IaC secrets (ADR 0003); coach onboarding is manual; clients onboard via a single-use invite only (`docs/spec/client-onboarding-auth.md`).

## Decision

### Mechanism

- **Primary: Managed Bots one-tap provisioning.** **Permanent fallback: manual BotFather token paste** (coaches with existing bots, or Managed Bots outages).
- **No shared-single-bot mode**, not even as a degraded state: it breaks branding and forfeits per-coach rate limits.

### Bot roles

- The **manager bot** (platform-owned) does provisioning and service notifications to the coach only ("bot needs re-link", permanent pipeline failures). After onboarding it is mostly silent.
- The **coach's own bot is the single surface** for both the coach (Mini App entry, briefs / debriefs / mentor reviews as messages) and their clients. This is the "workspace bot" of the client-onboarding spec.

### Provisioning flow (within manual coach onboarding)

1. Admin creates the workspace manually and hands the coach a personal deep link to the manager bot.
2. Manager bot shows a `request_managed_bot` keyboard button (equivalently the `t.me/newbot/{manager}/{suggested}` deep link) with a **suggested username derived from the workspace name**; the coach picks the final name/username in Telegram's own dialog.
3. On `Update.managed_bot` / `ManagedBotCreated`, everything is automatic: `getManagedBotToken` → encrypt and store the token → branding → `setWebhook` with a fresh per-bot secret → `setChatMenuButton` pointing at the Mini App. No manual steps after the tap.

### Fallback flow

- The coach pastes a BotFather token as a message to the manager bot — no web form in MVP. We validate with `getMe`, require a `/start` handshake from the coach's own Telegram account on the new bot before activation (ownership is otherwise unverifiable), delete the chat message containing the token after ingestion, then run the same downstream pipeline (branding, webhook, menu button).

### Webhook architecture and storage

- One `bot` Worker serves all bots, path-routed: `api.praximo.io/telegram/{bot_id}` per coach bot, `api.praximo.io/telegram/manager` for the manager bot (subscribed to `managed_bot` in `allowed_updates`).
- Every inbound request is verified against the bot's `secret_token` via the `X-Telegram-Bot-Api-Secret-Token` header.
- Bot records live in **Postgres (Neon)**: bot id, encrypted token, webhook secret, workspace id, status, cached `botInfo` (passed to the grammY `Bot` constructor to skip the per-request `getMe`). The Worker keeps a **per-isolate in-memory cache** of bot records, invalidated on token rotation. No KV/D1 tier in MVP.

### Token security

- Per-coach tokens are full-control credentials: **AES-GCM at rest**, ciphertext in Postgres, key held as a Worker secret (root `.env` → `Config.redacted`, per ADR 0003). Decryption happens only in the `bot` Worker's runtime path; tokens are never logged and never appear in URLs.
- The **manager bot's token is a stack secret** (platform key in `.env`), unlike per-coach tokens.

### Token lifecycle

- `ManagedBotUpdated` (rotation / owner-side change) → re-fetch the token, re-arm the webhook, invalidate the cache.
- A 401 from the Bot API (the paste flow has no rotation notifications) → workspace status **"bot needs re-link"**, coach notified via the manager bot. No manual retry surface in the product, consistent with ADR 0001.

### Role routing inside the coach bot

Resolve the incoming update's Telegram user id: workspace owner → coach experience; a client bound via invite → client experience; anyone else → a polite stub ("this is coach X's assistant, contact the coach") with **no onboarding path** — the invite stays the only door for clients.

### Branding

- Name and username are the coach's choice in the one-tap dialog. Avatar, description, and short description are set **programmatically from the workspace profile** (collected during manual onboarding), in the coach's language.
- Post-onboarding rebranding is out of MVP (handled manually on request).

### Client-side experience

Clients interact with the coach-branded bot through plain messages plus tokenized web-room links. **No client-facing Mini App in MVP** — the Mini App (schedule, sessions/clients) is coach-only, attached to every coach bot via `setChatMenuButton` with the same TanStack Start URL; the workspace is resolved from `initData` (the bot id is available to the `validate3rd` auth path).

### Explicitly skipped

- **Restricted-access mode** (Bot API 10.0 `BotAccessSettings`): onboarding is manual, a "private beta" state per coach bot buys nothing in MVP.

### Offboarding

On workspace deletion: `deleteWebhook`, wipe the token and the bot record. The bot itself remains the coach's property (in the Managed Bots model the coach is the owner) — we only release control. This becomes part of the coach on/offboarding runbook.

## Consequences

- grammY (v1.45+, Bot API 10.x) with `webhookCallback(bot, "cloudflare-mod")` is the bot framework; pinned and upgraded deliberately.
- One-time manual prerequisite: create the manager bot and enable bot management for it in the @BotFather Mini App (`can_manage_bots`) — a coach-runbook / implementation-setup step, not IaC.
- Telegram messaging rate limits apply **per bot, i.e. per coach** — a scalability win that a shared bot would forfeit.
- Facts the research could not verify from primary sources (exact `KeyboardButtonRequestManagedBot` field list, `replaceManagedBotToken` parameters, any cap on bots per manager bot) are checked empirically during the bot Worker's implementation spike; none of them gate this decision.
- A coach switching between flows (paste → managed or back) is out of MVP; re-onboarding covers it manually.
