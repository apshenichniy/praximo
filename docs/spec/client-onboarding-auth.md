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
- **Optional identity binding:** an Invite may carry an `expected_telegram_user_id`. The bot has two entry doors: `/start inv_<token>`, and a bare `/start` matched by Telegram user id against pending id-bound invites. The same acceptance flow follows either door. **The binding UI (Telegram user picker) is deferred post-MVP** — decided in prototype [#19](https://github.com/apshenichniy/praximo/issues/19); the model field ships so it can be added without migration.
- **MVP delivery forms** (decided in prototype [#19](https://github.com/apshenichniy/praximo/issues/19)) — three Mini App actions over the same tokenized deep link (`t.me/<workspace_bot>?start=inv_<token>`); the bot cannot message first, so the coach always delivers:
  1. **Share-card (primary):** `savePreparedInlineMessage` + Mini App `shareMessage` (Bot API 8.0) — native chat picker, branded card lands in the coach–client DM "via @bot". The card's button must be a `url` deep link (`web_app` buttons are not allowed in inline messages); read the prepared message's `expiration_date` from the response; handle `USER_DECLINED`.
  2. **Prefilled personal message:** `openTelegramLink("https://t.me/share/url?url=…&text=…")` — native chat picker, link + editable text land in the input field; the coach sends a fully personal message, no "via @bot" label, zero Bot API calls.
  3. **Copy link (canonical fallback):** `navigator.clipboard` on a user gesture + select-text fallback — there is no `copyTextToClipboard` in the Mini App API. Works outside Telegram; the channel-agnostic base for future channels.
  - Inline mode (`@bot` in the message field) is **not shipped** — it duplicates the share-card with worse ergonomics and requires `/setinline`.
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

Decided in wayfinder ticket [#25](https://github.com/apshenichniy/praximo/issues/25). Session lifecycle and join eligibility live in [web-room-sessions.md](web-room-sessions.md); this section owns the credential and token mechanics.

- **Symmetric join links:** per-(session, role) tokens for the coach and the client. In MVP the web room runs entirely on join links — the coach's Mini App session never has to reach the external browser. The gates are specified as an OR so the Better-Auth branch can light up post-MVP without migration:

  ```
  coachGate  = valid coach join link                                        -- MVP
            OR (Better-Auth session AND member of the session's workspace)  -- post-MVP: desktop web-app
  clientGate = valid client join link                                       -- the client's only credential, always
  ```

- **Token mechanics:** opaque random token, ≥128 bits of entropy, base64url; the DB stores a SHA-256 hash per (session, role); validation is a DB lookup in the `web` Worker. Not signed (no HMAC/JWT): revocation and rotation must be instant and stateful, and the join endpoint is not a hot path.
- Join links are **multi-use** (reconnects after a drop), valid while the session is `scheduled` / `in_progress`, dead in terminal states — revocation is implicit in the session lifecycle (this is the "access not revoked" mechanism referenced by the web-room spec).
- **Stable across rescheduling** — a reschedule mutates the time in place, the link keeps working, nothing is resent.
- **Rotation on compromise:** a coach command — "reissue links", on the session card in the Mini App and in the bot — rotates both (session, role) tokens and re-delivers them through the usual channels; old links die instantly (one UPDATE on the hashed rows).
- **Coach link is a bearer capability — accepted residual risk (MVP):** the coach link authenticates the coach role, including the in-room commands (`extend`, `end_session`, `cancel`). Mitigations: delivery only into the coach's private bot chat; validity bounded by the session lifecycle; `extend`/`end_session` additionally require a server-confirmed live connection in the room; rotation above. Residual: a holder of a leaked coach link can enter the room as the coach — visible to the other participant.
- **URL-leakage mitigations:** `Referrer-Policy: no-referrer` on all room pages; the pre-join page reads the token into memory and strips it from the URL via `history.replaceState` (`sessionStorage` covers same-tab reconnects). No token→cookie exchange in MVP.
- **Delivery — coach:** bot reminder messages plus a Join button on the session card in the Mini App, both via the web_app trampoline (webview constraint in [web-room-sessions.md](web-room-sessions.md) §14). Cross-device in MVP rides Telegram multi-device: the same bot chat in Telegram Desktop opens the system browser; copy-link is the fallback. PIN sign-in for a browser without Telegram (Better-Auth `device-authorization` plugin) is post-MVP, on the Better-Auth branch of the gate.
- **Delivery — client:** bot reminder messages via the trampoline. Join links are **channel-agnostic**: for non-Telegram clients the same token URL is delivered over their channel or forwarded manually by the coach — no trampoline needed outside Telegram webviews ([#27](https://github.com/apshenichniy/praximo/issues/27)).

## Other channels

Scope redrawn in [#25](https://github.com/apshenichniy/praximo/issues/25): non-Telegram clients are **in MVP** — a web acceptance page (same invite token, same language + consent steps), manual link-forwarding by the coach for messenger clients, and a first-class email channel. Nothing in the Invite / Channel / Consent Grant model changes. Specified in wayfinder ticket [#27](https://github.com/apshenichniy/praximo/issues/27) (provider research: [#26](https://github.com/apshenichniy/praximo/issues/26)); this document gains the flow once that ticket resolves.
