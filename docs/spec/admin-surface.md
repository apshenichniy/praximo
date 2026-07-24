# Admin Surface — Workspace Creation and Coach On/Offboarding

The operator's surface for creating and managing coach workspaces in MVP. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); it composes with the manual-onboarding provisioning flow in [ADR 0004](../adr/0004-bot-per-coach-provisioning.md), the coach Mini App auth in [client-onboarding-auth.md](client-onboarding-auth.md), and the deletion semantics in [privacy-retention.md](privacy-retention.md). Decided in wayfinder ticket [#34](https://github.com/apshenichniy/praximo/issues/34).

> **Revised 2026-07-24 by the Admin UX redesign** ([map #111](https://github.com/apshenichniy/praximo/issues/111), [design artifact](https://claude.ai/code/artifact/e0dd5959-2b86-4415-9a11-cd58dbc58e69), execution [#102](https://github.com/apshenichniy/praximo/issues/102)–[#110](https://github.com/apshenichniy/praximo/issues/110)). Headline changes: the create intent is reframed as **"Invite a coach"** with three delivery channels; manager-side branding editing is **removed** (the coach owns their bot's identity); deletion confirmation moves from typed-name to a **two-step button flow**; the manager Mini App gains a **universal entry with role dispatch**, retiring the non-admin-404 limitation. Sections below are updated in place.

## Principle

**The management surface is an admin section in the Mini App, modeled on the BotFather Mini App; the manager bot keeps only what a Mini App cannot do.** The Mini App already exists (the coach app, TanStack Start on the `web` Worker), so the admin surface is a **self-contained `/admin` route tree in that same app and Worker** — not a separate app, not a fourth Worker (ADR 0002 fixes three). "Self-contained" means the `/admin` tree has its **own root layout**, its **own Tailwind theme** (which may diverge freely from the coach app's — a different design system is expected), is **English-only** (see [Language](#language)), is **code-split** so no admin JS/CSS ships to coaches, and is **server-gated** on the admin flag. BotFather's Mini App gives a proven structure to copy — a list of bots, tap into one, edit its fields as a form — which maps almost one-to-one onto workspaces. Forms beat a linear bot conversation for the create/edit operations: every field is visible at once, any field is editable, and the avatar is a native upload.

## Separation model (coach vs admin)

The coach surface and the admin surface are **deliberately separated where it matters to a person, and deliberately unified where it only matters to the codebase.** This is the shape a dual-role person needs — the operator dogfooding as a coach, or a coach who also onboards other coaches (e.g. a coach-spouse running onboarding). For such a person the two roles must never bleed together **in Telegram**, but there is no reason to pay for two codebases to achieve that.

Separated at the layers a human perceives:

- **Bot account / chat.** Coach-facing notifications (sessions, artifacts, service notices) are delivered by the coach's **own branded bot** ([ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md), [ADR 0004](../adr/0004-bot-per-coach-provisioning.md)). Admin-facing notifications (onboarding loop, deep links) are delivered by the **manager bot** (below). For a dual-role person these are **two distinct bot chats** — a session notification never arrives from the same account that reports "a coach onboarded."
- **Mini App entry point.** The coach opens the coach Mini App from **their coach bot**; the admin opens the admin Mini App from the **manager bot** (Telegram display name `PraximoMother`). Each bot exposes its app two ways — both labelled **"Open"**, both opening that bot's own app (see [Entry points and the Open button](#entry-points-and-the-open-button)). Different bots, different `initData`, different auth, different `.admin`-themed experience. A coach never sees an admin entry inside the coach app.

Unified where only the codebase is affected:

- **One TanStack Start app, one `web` Worker.** The `/admin` route tree shares the deploy, the build, and reusable primitives with the coach app, but nothing a coach sees. The wins of a separate app (independent deploy cadence, zero admin bytes in the coach bundle) are marginal for a solo dev and the second is already covered by code-splitting; they do not justify a fourth Worker plus the ADR 0002 / IaC cost. Refinement of ticket [#34](https://github.com/apshenichniy/praximo/issues/34): the "one app, not a new Worker" decision stands; this section makes the intended isolation (own route tree, own theme, English-only) explicit.

### Entry points and the Open button

Each bot surfaces its Mini App two ways, both shown to the user as **"Open"** (matching the BotFather Mini App) and both opening that bot's own app — for the manager bot, the admin app; for a coach bot, the coach app:

- **In-chat menu button** (`setChatMenuButton`, `web_app`) — an ordinary Bot API call, so it is set **programmatically** with the bot's token. The manager bot's is set at setup (`scripts/set-menu-button.ts`, [#80](https://github.com/apshenichniy/praximo/issues/80)); each coach bot's at provisioning ([ADR 0004](../adr/0004-bot-per-coach-provisioning.md), [#86](https://github.com/apshenichniy/praximo/issues/86)). Its label is `"Open"`.
- **Chat-list "Open" button** (Telegram's *Main Mini App*) — the button next to the bot in the dialog list, like @BotFather's. As of **Bot API 10.2 (July 2026) there is no API to set it**: `has_main_web_app` is read-only in `getMe`, and the URL is configured **only in @BotFather, per bot, by the bot's owner**.

This makes the "Open" pattern **two-layered**: the menu button is automatable everywhere; the chat-list Main Mini App is a manual @BotFather step. For the platform-owned manager bot the operator enables it once, by hand ([#84](https://github.com/apshenichniy/praximo/issues/84)). For coach bots it is **optional coach self-service** — a coach may enable it in their own @BotFather (managed bots appear there), but the platform cannot do it for them and onboarding never blocks on it ([#86](https://github.com/apshenichniy/praximo/issues/86)). This is a Telegram limitation, not deferred work; revisit only if Telegram ships a setter ([#83](https://github.com/apshenichniy/praximo/issues/83)).

The canonical dev manager bot uses `https://stage.praximo.io/admin` for both entry points. Alchemy binds `stage.praximo.io` directly to the `dev_apshenichniy` web Worker, so the BotFather-owned Main Mini App URL remains short and stable across Worker deployments; non-canonical personal stages keep their generated `workers.dev` URLs.

**Universal entry with role dispatch** ([#106](https://github.com/apshenichniy/praximo/issues/106)): the manager bot's Mini App entry resolves the viewer's role server-side (`resolveRole(initData)`) instead of hard-gating on the admin flag. Admin → `/admin`; coach mid-onboarding → a stub status screen (full onboarding companion: [#112](https://github.com/apshenichniy/praximo/issues/112)); active coach → an "open your bot" pointer screen; anyone else → an invite-only landing. `AccessDenied` never renders as a 404, and no admin content flashes before the gate resolves. This retires the former known limitation (non-admin landing on a rejected admin app).

## Language

**The admin surface is English-only.** The admins are a tiny internal set (see [Admin identity and auth](#admin-identity-and-auth)); the trilingual (`en | uk | ru`) machinery that serves coaches and clients does not apply to admin routes. Admin routes never touch the i18n layer, and admin copy is authored in English only. (The coach's language is **not** collected at invite time — the coach picks it themselves during onboarding. The only language choice on the admin surface is the **invite-message language** — `en` default, `uk | ru` chips on the email and copy channels — which is a property of the message, not of the coach.)

The manager bot is **not** the management surface. It retains exactly two jobs it is uniquely good at, and no admin commands:

- **Proactive notifications** that close the onboarding loop (a Mini App cannot push).
- **Authoring the Telegram invite message**: the Mini App's "Send in Telegram" channel uses `savePreparedInlineMessage` + `WebApp.shareMessage` ([#104](https://github.com/apshenichniy/praximo/issues/104)) — the native chat picker sends a bot-authored message with the onboarding button. The former "bot messages the deep link to the admin's own chat for manual forwarding" delivery is retired; copy-link remains as the manual channel.

## The surface: admin section in the Mini App

Structure follows the BotFather Mini App, reframed around coaches rather than workspaces ([design artifact](https://claude.ai/code/artifact/e0dd5959-2b86-4415-9a11-cd58dbc58e69)):

- **Coaches list** ([#107](https://github.com/apshenichniy/praximo/issues/107)) — pending invites pinned on top with a status progression ("Invited via {channel} · expires in Nd" → "Link opened · creating bot…" → "Invite expired"), active coaches below (bot avatar, name, `@botUsername`, status badge, "active Nh ago"). Client/session counts render as muted placeholders until practice aggregates land ([#113](https://github.com/apshenichniy/praximo/issues/113)).
- **Details page** (tap a row, [#108](https://github.com/apshenichniy/praximo/issues/108)) — two variants. *Pending:* invite status card (channel, issued, expires, link-opened), Resend / Copy link, a "what happens next" step list, danger zone. *Active:* status-first — bot + coach activity, About (coach language, joined date), practice placeholders, Settings (internal-label rename only), danger zone.
- **Invite a coach** ([#103](https://github.com/apshenichniy/praximo/issues/103)) — an action-first screen, not a profile form: one optional internal-label field and three delivery actions. See [Invite a coach](#invite-a-coach).

Concrete screen layouts live in the design artifact; this spec fixes the surface, the operation set, and the semantics.

## Admin identity and auth

- Admin is a **flat, seeded set of Telegram ids** — a handful, not a role hierarchy: no admin-role model, no super-admin, and no way to grant admin *inside* the product. In practice the set is one or two people ([Rollout phases](#rollout-phases)).
- **Who is admin lives in the database**, not in config: an admin flag / record keyed by Telegram id, **seeded by the reset/seed script** (below) from `ADMIN_TELEGRAM_IDS` in the root `.env` (a comma-separated list, [#85](https://github.com/apshenichniy/praximo/issues/85)). This is deliberately the same shape a future assignable role will use — seeding is simply the only way to grant it in MVP, so no migration is needed when the role graduates.
- **Auth is the simplest case in the whole system.** The admin opens the Mini App from the **manager bot** (`PraximoMother`) via either "Open" surface ([Entry points and the Open button](#entry-points-and-the-open-button)), both landing on the admin route of the same TanStack Start app. The manager bot is platform-owned and its token is a stack secret we hold ([ADR 0004](../adr/0004-bot-per-coach-provisioning.md)), so its `initData` is validated by **standard HMAC against our own token** — not the third-party Ed25519 scheme the coach path needs to avoid touching per-coach bot tokens ([client-onboarding-auth.md](client-onboarding-auth.md), [#5](https://github.com/apshenichniy/praximo/issues/5)). The validated Telegram id is then gated on the admin flag; a non-admin opening the route gets nothing.
- A coach **may also be an admin** (dogfooding): the admin section is orthogonal to owning a workspace and is entered from the manager bot, not a coach bot. Such a person carries two hats on one Telegram id — an admin record *and* workspace ownership — checked independently (admin app → admin flag; coach app → workspace membership).

### Rollout phases

The admin set is seeded, so it simply changes with `ADMIN_TELEGRAM_IDS` across the build's phases; nothing in the product needs to know which phase it is:

| Phase | Admin set | Notes |
|---|---|---|
| **1 — active development** | operator only | The operator is admin **and** dogfoods as a coach (own workspace + coach bot) — the dual-role case, self-tested. |
| **2 — feature-complete build** | operator + spouse | The spouse joins as a coach *and* is granted admin; both test and iterate. |
| **3 — MVP / production** | spouse (primary), operator optional | Real coaches onboard; the spouse is the standing admin. Coaches are **not** admins. |

Re-seeding is the only mechanism: edit `ADMIN_TELEGRAM_IDS` and re-run the seed. All ids in the set are equal — "primary" is organisational, not a privilege level.

## Operations (MVP set)

| Operation | Surface | Notes |
|---|---|---|
| **Invite a coach** | Mini App action-first screen | Optional internal label; workspace + invite are created **lazily on the first delivery action** (idempotent by `requestId`); three channels: Telegram share, email (stub in MVP, [#105](https://github.com/apshenichniy/praximo/issues/105)), copy. See [Invite a coach](#invite-a-coach). |
| **List + status** | Mini App coaches list / details | Bot connection (`awaiting setup`→`connected`→`needs re-link`), coach language, bot username, terms-accepted, and the dates below. |
| **Resend / re-issue invite** | Mini App action | Resend re-delivers the current pending invite over any channel; re-issue mints a fresh single-use code (TTL 7 days), **annuls the previous one**, updates the `invited` date. There is **no separate revoke** — stale invites die by expiry, re-issue, or deletion. |
| **Rename internal label** | Mini App details → Settings | The label is **admin-only** — never shown to the coach or clients; after onboarding the list defaults to the coach's Telegram name, the label wins when set. The bot's Telegram identity is the coach's property. |
| ~~**Edit profile**~~ | — | **Removed by the redesign** ([#108](https://github.com/apshenichniy/praximo/issues/108)): the coach owns their bot's branding. Provisioning sets a generated default (initial-on-gradient avatar + templated description); rebranding is coach-side only. |
| **Delete** | Mini App action → two-step button confirm | Irreversible hard cascade; see [Delete flow](#delete-flow). |

**Block / unblock is not a distinct MVP state.** "A coach stops working in the system" is expressed as **delete** in MVP. A richer block semantics (kill-switch that suspends without deleting) is post-MVP — see the map's Out of scope.

### Invite a coach

The screen collects exactly one optional field — the **internal label** (the coach's name as the admin knows it), used to identify the pending invite in the list. Everything else the coach provides themselves during onboarding: language, bot branding, profile.

Three **delivery actions**; tapping one creates the workspace (`awaiting setup`) + invite lazily and delivers in the same gesture:

1. **Send in Telegram** (primary, [#104](https://github.com/apshenichniy/praximo/issues/104)) — the backend prepares a bot-authored invite message (`savePreparedInlineMessage`, prepared on tap since prepared messages are short-lived); `WebApp.shareMessage(id)` opens Telegram's native chat picker. The recipient is not revealed to the bot — the invite stays `pending` until claimed. Fallback for clients < Bot API 8.0: `openTelegramLink("https://t.me/share/url?…")`.
2. **Send by email** ([#105](https://github.com/apshenichniy/praximo/issues/105)) — bottom sheet with the address and invite-language chips. **MVP ships the UI as a stub** ("coming soon" toast); delivery lands later on **Cloudflare Email Service + React Email** ([#114](https://github.com/apshenichniy/praximo/issues/114) research).
3. **Copy invite** — copies the full forwardable message (with the deep link) via `navigator.clipboard.writeText`, for any other channel.

Backing out before any delivery action creates nothing. Success is a toast + the pending card in the coaches list — there is no separate "created" screen. Everything downstream of the coach opening the link is automatic per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) through Managed Bots one-tap; manual token ingestion is a separate follow-up ([#95](https://github.com/apshenichniy/praximo/issues/95)).

### Default coach-bot avatar operations

The platform default is one private R2 object per stage, addressed by
`DEFAULT_COACH_BOT_AVATAR_R2_KEY`. Workspaces with no custom branding avatar
reference that default at provisioning time; the object is not copied into each
workspace.

> **Redesign note ([#108](https://github.com/apshenichniy/praximo/issues/108)):** since the admin no longer uploads
> avatars, *every* bot gets default branding at provisioning — upgraded from the single static object to a
> **generated initial-on-gradient avatar** plus a templated description ("Coaching with {coach} · powered by
> Praximo"). The static R2 default and the tooling below remain as the fallback when generation is unavailable.

Replace it with:

```sh
bun run branding:avatar:set --stage dev_apshenichniy --file ./avatar.png \
  --key branding/default-coach-avatar.jpg
```

The command accepts JPEG, PNG, WebP, or SVG, normalizes the source to a square
512×512 JPEG, resolves exactly one stage-isolated Alchemy `Uploads` bucket, and
replaces only the configured key. To roll back, run the same command with the
previous source file. Replacement affects future provisioning and an explicit
avatar reset only; it never rewrites already-connected coach bots.

### Deep link lifecycle

Single-use, **TTL 7 days** — the same constant as the client invite ([client-onboarding-auth.md](client-onboarding-auth.md)), one fewer number to reason about. The start param is a **short random code** — `ws_{code}`, 8 chars of Crockford base32 stored on the invite — replacing the former HMAC-signed token ([#102](https://github.com/apshenichniy/praximo/issues/102)); the code's ~40 bits of entropy plus one-time use, TTL, and `/start` rate limiting carry the guessing protection. Re-issue creates a new code and expires the old one. The workspace owner (coach) is fixed by whoever first opens the link and completes provisioning; the admin does not need the coach's Telegram id in advance — but `/start` with a valid invite records `startedByTelegramId` ([#106](https://github.com/apshenichniy/praximo/issues/106)), so the pending card can show "Link opened".

### Delete flow

- Triggered from the details page's danger zone. Confirmation is a **two-step button flow** ([#110](https://github.com/apshenichniy/praximo/issues/110)), replacing the former typed-name confirmation (a desktop pattern; on a phone, buttons beat keyboards): sheet 1 lists the concrete consequences with Cancel prominent; sheet 2 flips the button order and labels ("Yes, delete everything" / "Keep workspace") and arms the destructive button behind a **3-second countdown** — a motor pause instead of a typing task, BotFather-style.
- A **pending** workspace (no bot yet) skips the ceremony: a single light confirm sheet ("Delete invite and workspace?").
- On confirmation: hard cascade per [privacy-retention.md](privacy-retention.md) (clients, sessions, recordings, artifacts physically removed; R2 objects removed by the async cleanup job; any in-flight pipeline run cancelled first) **and** bot release per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) (`deleteWebhook`, wipe token + bot record; the bot itself stays the coach's property). The sheet shows **live pipeline progress** and is closable — deletion continues in the background; an interrupted deletion shows the list card as "Deleting…" with Resume, backed by server-side adoption of the in-flight operation ([#109](https://github.com/apshenichniy/praximo/issues/109)).
- The manager bot sends the coach a **farewell message**; clients are notified of nothing — the coach's bot simply stops responding (it is now the coach's own bot). No pre-delete block is required.

## Status fields on the workspace page

Per workspace: the bot connection status (`awaiting setup` → `connected` → `needs re-link`; the last is a **display-only badge** until detection ships, [#55](https://github.com/apshenichniy/praximo/issues/55)), coach language, bot username, terms-accepted, the invite's delivery channel and link-opened marker (pending variant), and the dates:

- **`invited`** — when the current invite was issued (updated on re-issue).
- **`created`** — workspace creation.
- **`joined`** — when onboarding completed (member creation / terms acceptance); shown as "Joined" on the active details.
- **`last_login`** — the coach's most recent Mini App authentication.
- **`last_activity`** — the coach's most recent action (session/invite creation, bot command, Mini App login); a cheap touch-update at those call sites. Surfaced on the coaches list as "active Nh ago".

## Notifications — closing the onboarding loop

The manager bot proactively notifies the admin of the events that the Mini App cannot push and that a solo operator would otherwise have to poll for:

- **Coach completed Managed Bots setup → bot connected** (`connected`).
- **Coach's first Mini App login → terms accepted** — onboarding complete, workspace fully active.
- **`needs re-link`** — a coach bot returned 401 (token revoked); status flips and the coach is notified per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md). Consistent with [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md), there is no manual retry surface in the product; recovery is coach-side re-linking.

## Dev tooling: reset + admin seed

A repo-level script (e.g. `bun run db:reset`) supports MVP development: it **refuses to run against `prod`** (hardcoded stage guard, [ADR 0003](../adr/0003-alchemy-iac-structure.md) stages `dev_<user>` / `prod`), recreates/clears the dev Neon branch, runs Drizzle migrations, and **seeds the admins** from the root `.env` (`ADMIN_TELEGRAM_IDS`, a comma-separated list of one or more positive decimal Telegram ids — [#85](https://github.com/apshenichniy/praximo/issues/85)). Whitespace around ids is ignored; empty or malformed entries abort before the database is reset. This is dev tooling, not an operation of the admin surface itself, and it is the sole way an admin flag is granted in MVP.

`bun run db:reset --demo` performs the same guarded reset and additionally seeds
deterministic coaches-list fixtures covering **every onboarding stage the list
can render** ([#107](https://github.com/apshenichniy/praximo/issues/107)):
invited over each of the three channels, an invite inside its last day, an
accepted claim, a stalled one, a connected bot awaiting activation, an expired
invite, a coach decline, an admin reset, a reissue with its cancelled
predecessor, two active coaches (`connected` and `needs re-link`), a workspace
that was never invited, and one claim held by the seeding admin so the
admin-as-coach action has something to point at. Timestamps are relative to the
seed run, so countdowns stay truthful. The ordinary command never creates
workspaces. **Demo bot tokens are always absent** — a fixture may carry
`connected`, because the list has to show active coaches, but none of them can
reach Telegram. Every fixture is removable through the admin UI.

## Explicitly out of MVP

- **Block/unblock as a suspend-without-delete state** and any richer stop-working semantics — post-MVP.
- **Assignable admin role** (granting admin to another person through the product) — the DB shape is present; only seed-time grant ships.
- **Coach self-service rebranding UI** — the coach owns their bot's branding (redesign decision, [#108](https://github.com/apshenichniy/praximo/issues/108)); in MVP they exercise it via @BotFather on their managed bot, an in-product surface is post-MVP. The former admin "Edit profile / rebranding on request" path is removed, not deferred.
- **Email invite delivery** — the channel ships as a UI stub ([#105](https://github.com/apshenichniy/praximo/issues/105)); the Cloudflare Email Service sender is a follow-up (facts: [#114](https://github.com/apshenichniy/praximo/issues/114)).
- **Full coach onboarding companion** in the manager Mini App — MVP ships a stub via role dispatch ([#106](https://github.com/apshenichniy/praximo/issues/106)); the companion is [#112](https://github.com/apshenichniy/praximo/issues/112).
- **Practice aggregates** (client/session counts on list and details) — muted placeholders in MVP; scoped in [#113](https://github.com/apshenichniy/praximo/issues/113).

## Prototype note

The prototype on branch `prototype/admin-surface` (`prototypes/admin-surface-bot.html`) modeled the operation set, the notification loop, and the delete-by-typed-name confirmation as a **manager-bot conversation**. The surface decision moved to a BotFather-style Mini App, so that prototype is **superseded as a UI reference** but kept as a primary source for the operation set and semantics it validated. Concrete Mini App screens are fixed by the [Admin UX redesign artifact](https://claude.ai/code/artifact/e0dd5959-2b86-4415-9a11-cd58dbc58e69) (2026-07-24).
