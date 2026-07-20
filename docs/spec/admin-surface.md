# Admin Surface — Workspace Creation and Coach On/Offboarding

The operator's surface for creating and managing coach workspaces in MVP. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); it composes with the manual-onboarding provisioning flow in [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) and the deletion semantics in [privacy-retention.md](privacy-retention.md). Decided in wayfinder ticket [#34](https://github.com/apshenichniy/praximo/issues/34).

## Principle

**The simplest surface that ships MVP, built to grow.** No admin web-app and no separate admin bot in MVP: the operator surface is an **admin mode inside the existing manager bot** ([ADR 0004](../adr/0004-bot-per-coach-provisioning.md)) — that bot already exists, is already platform-owned (provisioning + service notices), and needs no new auth surface or Worker. The richer surfaces (an admin section in the Mini App or a web-app) arrive post-MVP, when an assignable admin role exists.

## The surface: manager bot, admin mode

- The manager bot exposes admin commands **only to the operator's Telegram id** (the admin). Any non-admin update to the manager bot gets the existing provisioning/coach behavior; admin commands are invisible to non-admins.
- Two entry points, and no others:
  - `/new` — a step-by-step conversation (grammY conversations) to create a workspace.
  - `/workspaces` — the workspace list, rendered as one inline-keyboard card per workspace, plus a trailing count line.
- Loading avatars is a native Telegram photo upload; no web form is involved.

## Admin identity and auth

- The admin is the **solo operator** (the repo owner) in MVP. There is no admin-role model and no list of admins in the product.
- **Who is admin lives in the database**, not in config: an admin flag / record keyed by Telegram id, **seeded by the reset/seed script** (below) from a value in the root `.env`. This is deliberately the same shape a future assignable role will use — seeding is simply the only way to grant it in MVP, so no migration is needed when the role graduates.
- A coach **may also be an admin** (dogfooding): role is resolved per incoming Telegram id, exactly as [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) routes coach vs client inside a coach bot. Being an admin is orthogonal to owning a workspace.

## Operations (MVP set)

| Operation | Surface | Notes |
|---|---|---|
| **Create** | `/new` conversation | Collects the workspace profile, provisions nothing itself — hands back a deep link. |
| **List + status** | `/workspaces` cards | Each card shows bot status, coach language, bot username, terms-accepted, and the four dates below. |
| **Re-issue deep link** | inline button | Mints a fresh single-use token (TTL 7 days), **annuls the previous one**, updates `invited` date. |
| **Rename** | inline button → text reply | Renames the workspace only. The bot's Telegram name is **not** changed automatically — it is the coach's property. |
| **Edit profile** | inline button → conversation | Edit avatar / description / short description; on save, **re-applies branding** to the coach's bot if it is already `connected` (this is the "rebranding on request" of [ADR 0004](../adr/0004-bot-per-coach-provisioning.md)), otherwise branding applies at provisioning. |
| **Delete** | inline button → typed-name confirmation | Irreversible hard cascade; see below. |

**Block / unblock is not a distinct MVP state.** "A coach stops working in the system" is expressed as **delete** in MVP. A richer block semantics (kill-switch that suspends without deleting) is post-MVP — see the map's Out of scope.

### Create flow (`/new`)

1. **Workspace name** (required) — the practice name; the basis for the bot's suggested username and branding.
2. **Coach language** (required) — chosen from reply-keyboard buttons `English / Українська / Русский` (not free text); sets the coach's UI and artifact language ([domain-model.md](domain-model.md) `Member.language`).
3. **Avatar** (skippable) — a photo upload for the coach bot's picture.
4. **Description** (skippable) — the bot's `description`.
5. **Short description** (skippable) — the bot's `short_description`.

On completion the bot creates the workspace in status `provisioning` and returns a **single-use deep link** (TTL 7 days) to the manager bot, formatted ready to forward to the coach. Everything downstream of the coach opening that link is automatic per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) (Managed Bots one-tap, or the paste fallback). Skipped profile fields are simply absent at provisioning and can be filled later via **Edit profile**.

### Deep link lifecycle

Single-use, **TTL 7 days** — the same constant as the client invite ([client-onboarding-auth.md](client-onboarding-auth.md)), one fewer number to reason about. Re-issue creates a new token and expires the old one. The workspace owner (coach) is fixed by whoever first opens the link and completes provisioning; the admin does not need the coach's Telegram id in advance.

### Delete flow

- Triggered from the card's **Delete** button; the bot asks the admin to reply with the **exact workspace name** to confirm (inline yes/no is too easy to hit by accident for an irreversible hard cascade). A wrong name is rejected; an explicit **Cancel** button aborts.
- On confirmation: hard cascade per [privacy-retention.md](privacy-retention.md) (clients, sessions, recordings, artifacts physically removed; R2 objects removed by the async cleanup job; any in-flight pipeline run cancelled first) **and** bot release per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) (`deleteWebhook`, wipe token + bot record; the bot itself stays the coach's property).
- The manager bot sends the coach a **farewell message**; clients are notified of nothing — the coach's bot simply stops responding (it is now the coach's own bot). No pre-delete block is required.

## Status fields on the list card

Per workspace, `/workspaces` shows the bot connection status (`provisioning` → `connected` → `needs re-link`), coach language, bot username, terms-accepted, and four dates:

- **`invited`** — when the current deep link was issued (updated on re-issue).
- **`created`** — workspace creation.
- **`last_login`** — the coach's most recent Mini App authentication.
- **`last_activity`** — the coach's most recent action (session/invite creation, bot command, Mini App login); a cheap touch-update at those call sites.

## Notifications — closing the onboarding loop

The manager bot proactively notifies the admin of the events that a solo operator would otherwise have to poll `/workspaces` for:

- **Coach opened the link → bot provisioned** (`connected`) — or the coach chose the paste fallback.
- **Coach's first Mini App login → terms accepted** — onboarding complete, workspace fully active.
- **`needs re-link`** — a coach bot returned 401 (token revoked); status flips and the coach is notified per [ADR 0004](../adr/0004-bot-per-coach-provisioning.md). Consistent with [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md), there is no manual retry surface in the product; recovery is coach-side re-linking.

## Dev tooling: reset + admin seed

A repo-level script (e.g. `bun run db:reset`) supports MVP development: it **refuses to run against `prod`** (hardcoded stage guard, [ADR 0003](../adr/0003-alchemy-iac-structure.md) stages `dev_<user>` / `prod`), recreates/clears the dev Neon branch, runs Drizzle migrations, and **seeds the admin** from the root `.env` (the admin's Telegram id). This is dev tooling, not an operation of the admin surface itself, and it is the sole way an admin flag is granted in MVP.

## Explicitly out of MVP

- **Block/unblock as a suspend-without-delete state** and any richer stop-working semantics — post-MVP.
- **Assignable admin role** (granting admin to another person through the product) — the DB shape is present; only seed-time grant ships.
- **Admin web-app or Mini App admin section** — the surface graduates here post-MVP.
- **Post-onboarding self-service rebranding by the coach** — [ADR 0004](../adr/0004-bot-per-coach-provisioning.md) already defers this; admin Edit profile covers the "on request" path.
