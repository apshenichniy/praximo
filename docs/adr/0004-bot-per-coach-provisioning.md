# ADR 0004: Bot-per-coach provisioning via Telegram Managed Bots

- **Status**: accepted
- **Date**: 2026-07-20
- **Ticket**: [#9](https://github.com/apshenichniy/praximo/issues/9)

## Context

The baseline decision is **bot-per-coach**: the bot a client talks to carries the coach's brand. The open question was the mechanism. Research ([#2](https://github.com/apshenichniy/praximo/issues/2), `docs/research/telegram-managed-bots.md` on `research/telegram-managed-bots`) established that Telegram **Managed Bots** (Bot API 9.6, extended in 10.0) provides exactly the provisioning primitive needed: our platform bot prompts the coach to create a bot in one tap, the coach owns it, and we fetch its token via `getManagedBotToken` — no BotFather copy-paste. grammY v1.45+ covers every piece, including the Cloudflare Workers adapter.

Constraints inherited from prior decisions: the `bot` Worker owns all Telegram traffic behind `api.praximo.io/telegram/*` (ADR 0002, ADR 0003); per-coach bot tokens are **runtime data in Postgres**, never IaC secrets (ADR 0003); coach onboarding is manual; clients onboard via a single-use invite only (`docs/spec/client-onboarding-auth.md`).

## Decision

### Mechanism

- **Managed Bots one-tap provisioning is the primary path.** Manual BotFather
  token ingestion shipped separately
  ([#95](https://github.com/apshenichniy/praximo/issues/95)) as the fallback for
  a coach who already owns a bot or whom Managed Bots fails; it carries its own
  ownership-proof handshake and joins the one-tap pipeline at activation.
- **No shared-single-bot mode**, not even as a degraded state: it breaks branding and forfeits per-coach rate limits.

### Bot roles

- The **manager bot** (platform-owned; Telegram display name `PraximoMother`, dev instance suffixed) does provisioning and service notifications to the coach only ("bot needs re-link", permanent pipeline failures). After onboarding it is mostly silent.
- The **coach's own bot is the single surface** for both the coach (Mini App entry, briefs / debriefs / mentor reviews as messages) and their clients. This is the "workspace bot" of the client-onboarding spec.

### Provisioning flow (within manual coach onboarding)

1. Admin creates the workspace manually and hands the coach a personal deep link to the manager bot.
2. Manager bot shows a `request_managed_bot` keyboard button (equivalently the `t.me/newbot/{manager}/{suggested}` deep link) with a **suggested username derived from the workspace name**; the coach picks the final name/username in Telegram's own dialog.
3. On `Update.managed_bot` / `ManagedBotCreated`, everything is automatic: `getManagedBotToken` → encrypt and store the token → branding → `setWebhook` with a fresh per-bot secret → `setChatMenuButton` pointing at the Mini App. No manual steps after the tap.

Opening `/start` does not reserve the workspace. It records a resumable request;
the first subsequent `managed_bot` update from a requester atomically claims the
still-current invite. The bot id is persisted before Telegram configuration
begins, and a repeated update resumes the same installation. Only the final
database transaction sets the owner and `connected`, consumes the invite, and
queues the manager-bot notification.

### BotFather token fallback

Implemented by [#95](https://github.com/apshenichniy/praximo/issues/95). A token
is accepted only as a private message to the manager bot, and only while that
Telegram identity holds an open onboarding attempt:

1. The message is deleted before the token is validated; a deletion Telegram
   refuses is reported to the coach rather than passed over.
2. `getMe` validates the credential. It is then encrypted with the same envelope
   an installed token uses and parked on the attempt row, which also holds the
   SHA-256 of a one-shot proof nonce and of the webhook secret armed on that bot.
   The plaintext never reaches Postgres, a log, a URL, or a typed error payload.
3. The coach proves ownership by opening the candidate bot with that nonce. Only
   a `/start` carrying both the nonce and the Telegram identity that pasted the
   token activates; the bot's route serves the handshake until an installation
   exists, authenticated by the candidate's own webhook-secret hash.
4. From the proof on it is the one-tap path: the same claim, branding, webhook,
   menu button, activation transaction, and admin notification. Activation wipes
   the parked envelope and both proof hashes.

Every refusal — no open attempt, invalid token, a bot another workspace runs, a
foreign identity, a partial configuration failure — leaves the workspace
unconnected, and a fresh paste supersedes the previous nonce and secret.

### Webhook architecture and storage

- One `bot` Worker serves all bots, path-routed: `api.praximo.io/telegram/{bot_id}` per coach bot, `api.praximo.io/telegram/manager` for the manager bot (subscribed to `managed_bot` in `allowed_updates`).
- Every inbound request is verified against the bot's `secret_token` via the `X-Telegram-Bot-Api-Secret-Token` header. Coach-bot rows retain only its SHA-256 hash; the plaintext secret exists only while `setWebhook` is called.
- Bot records live in **Postgres (Neon)**: bot id, encrypted token, webhook-secret hash, workspace id, status, cached `botInfo` (passed to the grammY `Bot` constructor to skip the per-request `getMe`). The Worker keeps a **per-isolate in-memory cache** of bot records, invalidated on token rotation. No KV/D1 tier in MVP.

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
- Admin profile updates reapply avatar, description, and short description
  through the bot Worker's internal RPC boundary; tokens never enter the web
  Worker.

### Client-side experience

Clients interact with the coach-branded bot through plain messages plus tokenized web-room links. **No client-facing Mini App in MVP** — the Mini App (schedule, sessions/clients) is coach-only, attached to every coach bot via `setChatMenuButton` with the same TanStack Start URL; the workspace is resolved from `initData` (the bot id is available to the `validate3rd` auth path).

### Mini App entry points and the Main Mini App gap

Each bot can surface its Mini App two ways, both shown to the user as **"Open"** (the BotFather pattern):

- **In-chat menu button** (`setChatMenuButton`, `web_app`) — an ordinary Bot API call, set **programmatically** with the bot's token: on the manager bot at setup (`scripts/set-menu-button.ts`, [#80](https://github.com/apshenichniy/praximo/issues/80)) and on each coach bot at provisioning (step 3 above), labelled `"Open"`.
- **Chat-list "Open" button** (Telegram's *Main Mini App*) — as of **Bot API 10.2 (July 2026) there is no API to set it**; `has_main_web_app` is read-only in `getMe`, and the URL is configured **only in @BotFather, per bot, by the bot's owner**. Managed (coach) bots appear in the owner's @BotFather, so a coach *can* enable it — but the platform cannot do it for them.

Consequence for provisioning: the automated pipeline sets the **menu button** for every coach bot; the chat-list "Open" is **optional coach self-service** and onboarding is never blocked on it ([#86](https://github.com/apshenichniy/praximo/issues/86)). For the platform-owned manager bot the operator enables the Main Mini App once, by hand ([#84](https://github.com/apshenichniy/praximo/issues/84)). This is a Telegram limitation, not deferred work.

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
- **Revisit:** the Main Mini App (chat-list "Open") has no programmatic setter (Bot API 10.2). Watch the [Bot API changelog](https://core.telegram.org/bots/api-changelog) ([#83](https://github.com/apshenichniy/praximo/issues/83)); if Telegram ships a setter, fold it into provisioning so coach bots get the chat-list "Open" automatically.
