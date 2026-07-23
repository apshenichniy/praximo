# Admin Surface — Workspace Creation and Coach On/Offboarding

The operator's surface for creating and managing coach workspaces in MVP. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); it composes with the manual-onboarding provisioning flow in [ADR 0004](../adr/0004-bot-per-coach-provisioning.md), the coach Mini App auth in [client-onboarding-auth.md](client-onboarding-auth.md), and the deletion semantics in [privacy-retention.md](privacy-retention.md). Decided in wayfinder ticket [#34](https://github.com/apshenichniy/praximo/issues/34).

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

**Known limitation:** a non-admin who has the manager-bot chat — e.g. a coach who received their deep link there — sees the chat-list "Open", lands on the admin app, and is rejected by the admin-flag gate. Accepted in MVP (the admin set is one or two people; see [Rollout phases](#rollout-phases)).

## Language

**The admin surface is English-only.** The admins are a tiny internal set (see [Admin identity and auth](#admin-identity-and-auth)); the trilingual (`en | uk | ru`) machinery that serves coaches and clients does not apply to admin routes. Admin routes never touch the i18n layer, and admin copy is authored in English only. (Coach-language selection *within* the Create form is data about the coach being provisioned — [domain-model.md](domain-model.md) `Member.language` — not the language of the admin UI.)

The manager bot is **not** the management surface. It retains exactly two jobs it is uniquely good at, and no admin commands:

- **Proactive notifications** that close the onboarding loop (a Mini App cannot push).
- **Delivering the deep link** as a forwardable message the admin passes to the coach.

## The surface: admin section in the Mini App

Structure follows the BotFather Mini App:

- **Workspace list** — every workspace as a row with its name and bot status; the equivalent of BotFather's bot list.
- **Workspace page** (tap a row) — the profile as an editable form (name, avatar, description, short description), the status panel (bot connection, dates, terms-accepted), and actions (re-issue deep link, delete). The equivalent of BotFather's per-bot "Edit Bot" page.
- **Create** — a form that collects the workspace profile and yields a deep link.

Concrete screen layouts are worked out at implementation; this spec fixes the surface, the operation set, and the semantics, not the pixels.

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
| **Create** | Mini App create form | Collects the workspace profile; on submit the workspace is `awaiting setup` and the manager bot delivers the deep link (below). |
| **List + status** | Mini App workspace list / page | Bot connection (`awaiting setup`→`connected`→`needs re-link`), coach language, bot username, terms-accepted, and the four dates below. |
| **Re-issue deep link** | Mini App action | Mints a fresh single-use token (TTL 7 days), **annuls the previous one**, updates the `invited` date; the manager bot re-delivers it as a forwardable message. |
| **Rename** | Mini App profile form | Renames the workspace only. The bot's Telegram name is **not** changed automatically — it is the coach's property. |
| **Edit profile** | Mini App profile form | Edit avatar / description / short description; on save, **re-applies branding** to the coach's bot if it is already `connected` (the "rebranding on request" of [ADR 0004](../adr/0004-bot-per-coach-provisioning.md)), otherwise branding applies at provisioning. |
| **Delete** | Mini App action → typed-name confirmation | Irreversible hard cascade; see below. |

**Block / unblock is not a distinct MVP state.** "A coach stops working in the system" is expressed as **delete** in MVP. A richer block semantics (kill-switch that suspends without deleting) is post-MVP — see the map's Out of scope.

### Create

The create form collects:

1. **Workspace name** (required) — the practice name; the basis for the bot's suggested username and branding.
2. **Coach language** (required) — `en | uk | ru`; sets the coach's UI and artifact language ([domain-model.md](domain-model.md) `Member.language`).
3. **Avatar** (optional) — the coach bot's picture.
4. **Description** (optional) — the bot's `description`.
5. **Short description** (optional) — the bot's `short_description`.

On submit the workspace is created in status `awaiting setup`. The **manager bot then sends the admin the single-use deep link** (TTL 7 days) as a message, formatted ready to forward to the coach; the Mini App also surfaces the link to copy. Everything downstream of the coach opening that link is automatic per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) (Managed Bots one-tap, or the paste fallback). Omitted profile fields are simply absent at provisioning and can be filled later via **Edit profile**.

### Default coach-bot avatar operations

The platform default is one private R2 object per stage, addressed by
`DEFAULT_COACH_BOT_AVATAR_R2_KEY`. Workspaces with no custom branding avatar
reference that default at provisioning time; the object is not copied into each
workspace.

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

Single-use, **TTL 7 days** — the same constant as the client invite ([client-onboarding-auth.md](client-onboarding-auth.md)), one fewer number to reason about. Re-issue creates a new token and expires the old one. The workspace owner (coach) is fixed by whoever first opens the link and completes provisioning; the admin does not need the coach's Telegram id in advance. The link always reaches the coach as a **forwardable manager-bot message** — the one delivery job the bot keeps.

### Delete flow

- Triggered from the workspace page's **Delete** action; the Mini App requires the admin to type the **exact workspace name** to confirm (a plain button is too easy to hit by accident for an irreversible hard cascade).
- On confirmation: hard cascade per [privacy-retention.md](privacy-retention.md) (clients, sessions, recordings, artifacts physically removed; R2 objects removed by the async cleanup job; any in-flight pipeline run cancelled first) **and** bot release per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) (`deleteWebhook`, wipe token + bot record; the bot itself stays the coach's property).
- The manager bot sends the coach a **farewell message**; clients are notified of nothing — the coach's bot simply stops responding (it is now the coach's own bot). No pre-delete block is required.

## Status fields on the workspace page

Per workspace: the bot connection status (`awaiting setup` → `connected` → `needs re-link`), coach language, bot username, terms-accepted, and four dates:

- **`invited`** — when the current deep link was issued (updated on re-issue).
- **`created`** — workspace creation.
- **`last_login`** — the coach's most recent Mini App authentication.
- **`last_activity`** — the coach's most recent action (session/invite creation, bot command, Mini App login); a cheap touch-update at those call sites.

## Notifications — closing the onboarding loop

The manager bot proactively notifies the admin of the events that the Mini App cannot push and that a solo operator would otherwise have to poll for:

- **Coach opened the link → bot provisioned** (`connected`) — or the coach chose the paste fallback.
- **Coach's first Mini App login → terms accepted** — onboarding complete, workspace fully active.
- **`needs re-link`** — a coach bot returned 401 (token revoked); status flips and the coach is notified per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md). Consistent with [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md), there is no manual retry surface in the product; recovery is coach-side re-linking.

## Dev tooling: reset + admin seed

A repo-level script (e.g. `bun run db:reset`) supports MVP development: it **refuses to run against `prod`** (hardcoded stage guard, [ADR 0003](../adr/0003-alchemy-iac-structure.md) stages `dev_<user>` / `prod`), recreates/clears the dev Neon branch, runs Drizzle migrations, and **seeds the admins** from the root `.env` (`ADMIN_TELEGRAM_IDS`, a comma-separated list of one or more positive decimal Telegram ids — [#85](https://github.com/apshenichniy/praximo/issues/85)). Whitespace around ids is ignored; empty or malformed entries abort before the database is reset. This is dev tooling, not an operation of the admin surface itself, and it is the sole way an admin flag is granted in MVP.

`bun run db:reset --demo` performs the same guarded reset and additionally
seeds three deterministic workspace-list fixtures: **Praximo Lab** (no owner or
bot), **North Star Coaching** (owner plus Awaiting Setup bot connection), and **Quiet Harbor**
(owner plus a username-bearing bot that needs re-linking). The ordinary command
never creates workspaces. Demo bot tokens are always absent; no fixture pretends
to be connected to Telegram.

## Explicitly out of MVP

- **Block/unblock as a suspend-without-delete state** and any richer stop-working semantics — post-MVP.
- **Assignable admin role** (granting admin to another person through the product) — the DB shape is present; only seed-time grant ships.
- **Post-onboarding self-service rebranding by the coach** — [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) already defers this; admin Edit profile covers the "on request" path.

## Prototype note

The prototype on branch `prototype/admin-surface` (`prototypes/admin-surface-bot.html`) modeled the operation set, the notification loop, and the delete-by-typed-name confirmation as a **manager-bot conversation**. The surface decision moved to a BotFather-style Mini App, so that prototype is **superseded as a UI reference** but kept as a primary source for the operation set and semantics it validated. Concrete Mini App screens are worked out at implementation.
