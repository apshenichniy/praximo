# Client Onboarding and Authentication — MVP Flow

Coach sign-in, client invites, consent capture, and web-room access. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); entity structure in [domain-model.md](domain-model.md); consent policy in [privacy-retention.md](privacy-retention.md). Decided in wayfinder ticket [#14](https://github.com/apshenichniy/praximo/issues/14).

## Principles

- **The client experiences onboarding as a continuation of the conversation with their coach.** The bot is the coach's assistant, never "a platform"; every message the client sees is branded as the coach's.
- **One auth mechanism per actor.** Coach: Better-Auth session established from Telegram Mini App initData. Client: no account, no credentials — tokenized links only (invite token, then join link).
- **Channel-agnostic model, Telegram-only implementation.** The Invite (token, statuses, TTL) is channel-agnostic; only delivery and the acceptance surface are channel-specific.

## Coach authentication

- **Entry point:** the coach's own workspace bot — its menu button opens the Mini App (fullscreen via Bot API 8.0 `requestFullscreen`; details in the Mini App prototype, [#15](https://github.com/apshenichniy/praximo/issues/15)). The manager bot is provisioning-only and plays no part in daily use.
- **First-party Better-Auth plugin `telegram-mini-app`** (per research [#5](https://github.com/apshenichniy/praximo/issues/5)):
  - initData validated with the **Ed25519 `validate3rd`** scheme (`@telegram-apps/init-data-node`) — needs only the bot id, so the auth path never touches per-coach bot tokens;
  - the sign-in endpoint resolves workspace by bot, then matches the Telegram user id against an existing Member; unknown users are **rejected** — no self-registration, coach onboarding is manual;
  - session cookies via `tanstackStartCookies`; **Bearer plugin fallback** for Telegram Web, where the Mini App iframe blocks third-party cookies;
  - **organization plugin**: workspace = organization, Member = membership.
- **Synthetic email convention:** `tg-<telegram_user_id>@users.praximo.io`, `emailVerified = false`. A real email is attachable later via explicit account linking — no migration needed.
- **First login** shows a blocking ToS acceptance screen; the acceptance fact and text version are recorded on Member ([privacy-retention.md](privacy-retention.md)).

## Client onboarding

### Invite

- The Invite always carries a **single-use token, TTL 7 days**. Re-issuing creates a new Invite and expires the old one. A click on an expired or used token → the bot politely asks the client to request a fresh link from the coach.
- **Optional identity binding:** an Invite may carry an `expected_telegram_user_id` (captured when the coach picks the client via Telegram's user picker). The bot has two entry doors: `/start inv_<token>`, and a bare `/start` matched by Telegram user id against pending id-bound invites. The same acceptance flow follows either door.
- **MVP UI ships the tokenized deep link** (`t.me/<workspace_bot>?start=inv_<token>`), copied from the Mini App and sent to the client by the coach personally — the bot cannot message first. The delivery *form* (share-card via prepared inline messages vs inline mode vs plain link) and whether the id-binding picker makes MVP scope are compared in prototype [#19](https://github.com/apshenichniy/praximo/issues/19); the model supports all variants without migration.
- **No hijack verification:** the first click accepts — the link is delivered privately. The safeguard is visibility: the coach sees which Telegram account accepted (name / username / avatar) and can unbind the channel and re-invite.

### Session-first flow

- Creating a client (**name only** — language is chosen by the client at acceptance) and scheduling the first session happen in one Mini App flow. The first session defaults to kind `intake` ([domain-model.md](domain-model.md)).
- **Scheduling while consent is pending is allowed.** The client physically cannot join before accepting: the join link is delivered through the bot, and the channel exists only after acceptance (which includes consent). Scheduling is blocked only after **revocation** ([privacy-retention.md](privacy-retention.md)). The client's join link is not exposed to the coach until consent is granted.

### Acceptance sequence

1. **`/start`** — the client is recognized by token or by id binding.
2. **Language ask** — a compact trilingual message with inline buttons EN / UK / RU, pre-selected from Telegram's `language_code`. Sets `client.language`.
3. **Consent** — the consent text in the chosen language (the five required elements from [privacy-retention.md](privacy-retention.md)) + privacy policy link + a single "I agree" button. Copy is written in prototype [#16](https://github.com/apshenichniy/praximo/issues/16).
4. **Confirmation** — "your coach N set up your profile", plus session details when one is already scheduled.

- **Acceptance is atomic:** Channel created — with a Telegram profile snapshot (name, username, avatar stored in R2) — + Consent Grant appended + Invite → `accepted`. If the client never presses "I agree", nothing is created and the Invite stays `pending` until TTL.
- A bare `/start` from a stranger (no token, no id match) → polite "this is coach N's assistant bot; ask them for an invite link". The coach's own `/start` opens the coach menu.

## Web-room access

- **Symmetric join links:** per-(session, role) tokens for the coach and the client; the web room is fully outside Better-Auth. The coach's Mini App session never has to reach the external browser.
- Join links are **multi-use** (reconnects after a drop), valid while the session is `scheduled` / `in_progress`, dead in terminal states.
- **Stable across rescheduling** — a reschedule mutates the time in place, the link keeps working, nothing is resent.
- Delivered through the bot in reminder messages. No early-join window in MVP; join-flow states (`ready_to_join`, no-show detection) are deferred to web-room implementation prep.

## Future channels

A future email channel delivers the same invite token as a link to a web acceptance page carrying the same language + consent steps; reminders and join links go to that channel instead. Nothing in the Invite / Channel / Consent Grant model changes.
