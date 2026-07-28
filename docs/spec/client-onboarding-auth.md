# Client Onboarding and Authentication — MVP Flow

Coach sign-in, client invites, consent capture, and web-room access. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); entity structure in [domain-model.md](domain-model.md); consent policy in [privacy-retention.md](privacy-retention.md). Decided in wayfinder tickets [#14](https://github.com/apshenichniy/praximo/issues/14) (core flow), [#25](https://github.com/apshenichniy/praximo/issues/25) (web-room access), and [#27](https://github.com/apshenichniy/praximo/issues/27) (non-Telegram clients); the non-Telegram flow validated end to end in prototype [#28](https://github.com/apshenichniy/praximo/issues/28) (`prototypes/client-web-flow`).

## Principles

- **The client experiences onboarding as a continuation of the conversation with their coach.** The bot is the coach's assistant, never "a platform"; every message the client sees is branded as the coach's.
- **One auth mechanism per actor — and in MVP both actors reachable through Telegram share one.** Coach: per-launch Ed25519 verification of Telegram Mini App initData, no server session ([ADR 0006](../adr/0006-coach-authentication-in-mvp.md)); the admin surface uses the same per-request model with HMAC against the platform-owned manager-bot token. Client: no account, no credentials — tokenized links only (invite token, then join link). Better Auth arrives with the first actor that has no initData — the post-MVP web app.
- **Channel-agnostic model, three delivery paths in MVP.** The Invite (token, statuses, TTL) is channel-agnostic; only delivery and the acceptance surface are channel-specific. MVP implements Telegram (the ideal path), **email** (first-class — the service delivers itself), and **manual link-forwarding** by the coach for clients on other messengers. Coach surfaces stay Telegram-only; the telegram-first asymmetry is deliberate ([#25](https://github.com/apshenichniy/praximo/issues/25)).
- **Identity attestations now, accounts later.** Every acceptance path captures a durable identity key — Telegram user id, Google `sub`, or email address. Client Better-Auth accounts are a dormant post-MVP branch (client portal: session list, booking, questionnaires) that lights up by matching these keys — an additive migration, nothing to redo. No OAuth tokens are stored: portal sign-in will always be a fresh OAuth/initData flow.

## Coach authentication

- **Entry point:** the coach's own workspace bot — its menu button opens the Mini App (fullscreen via Bot API 8.0 `requestFullscreen`; details in the Mini App prototype, [#15](https://github.com/apshenichniy/praximo/issues/15)). The manager bot is provisioning-only and plays no part in daily use.
- **Per-launch Ed25519 verification, no server session** ([ADR 0006](../adr/0006-coach-authentication-in-mvp.md); research [#5](https://github.com/apshenichniy/praximo/issues/5) supplied the scheme):
  - initData validated with the **Ed25519 `validate3rd`** scheme — needs only the bot id, so the auth path never touches per-coach bot tokens. `signature` is required and `hash` is never consulted: a coach can read their own bot's token, which under HMAC would forge initData for any user id;
  - **the launch carries its own bot id** — the coach bot's Mini App URL is set per bot at provisioning with `?b=<telegramBotId>` — so verification runs *before* any database access, and the signature binds the candidate. Launches without it (a URL the coach pasted into @BotFather themselves) fall back to an indexed lookup by Telegram user id, single-valued by a partial unique index on owner members;
  - the verified `(bot, Telegram user id)` pair resolves the workspace and its Member; unknown identities are **rejected** — no self-registration, coach onboarding is manual. Unknown identity, wrong-bot signature, a stale credential and a workspace being deleted are all refused identically, with no cause disclosed;
  - **the credential travels on the request** (headers), never in server-function arguments or query keys — so a Better-Auth cookie later replaces one client module and nothing else;
  - `auth_date` windows: 24 hours for reads (Telegram never refreshes initData after launch), **15 minutes for state-changing operations**. `member.credentials_valid_from` is the revocation floor an `auth_date` must clear; workspace deletion is its only writer in MVP.
- **First login** shows a blocking ToS acceptance screen; the acceptance fact and a content-derived text version are recorded on Member ([privacy-retention.md](privacy-retention.md)). A version bump does not force re-acceptance in MVP, and a privacy-policy revision is not recorded.
- **Post-MVP:** Better Auth (`user` ↔ `account` 1—N) attaches to `member.telegram_user_id` as its natural key, together with the synthetic email convention `tg-<telegram_user_id>@users.praximo.io`. Nothing about the MVP shape needs redoing.

## Client onboarding

### Invite

- The Invite always carries a **single-use token, TTL 7 days**. Re-issuing creates a new Invite and expires the old one. A click on an expired or used token → a polite "ask your coach for a fresh link" (from the bot or on the web page, depending on the door).
- **Delivery target:** `Invite.delivery = { kind: telegram | email | link, address? }`, chosen by the coach at client creation — `telegram` (default), `email` with the client's address, or `link` (the coach forwards manually). Re-issue copies the delivery target. The Channel is still created only at acceptance — for email invites, from the invite's address — so the "channel exists only after acceptance" invariant holds on every path.
- **Two forms of the same token:** the deep link `t.me/<workspace_bot>?start=inv_<token>` for Telegram delivery, and the future web URL `https://me.praximo.io/i/<token>` for everything else — #57 implements the web acceptance page after #215. Which form to hand out is a delivery-time choice; there is no universal routing page.
- **Optional identity binding:** an Invite may carry an `expected_telegram_user_id`. The bot has two entry doors: `/start inv_<token>`, and a bare `/start` matched by Telegram user id against pending id-bound invites. The same acceptance flow follows either door. **The binding UI (Telegram user picker) is deferred post-MVP** — decided in prototype [#19](https://github.com/apshenichniy/praximo/issues/19); the model field ships so it can be added without migration.
- **MVP delivery forms** (decided in prototype [#19](https://github.com/apshenichniy/praximo/issues/19)) — **two** coach-facing Mini App actions over the same tokenized deep link (`t.me/<workspace_bot>?start=inv_<token>`); the bot cannot message first, so the coach always delivers. Amended by [#56](https://github.com/apshenichniy/praximo/issues/56): the second form below is **no longer an action of its own**. It opened the same native chat picker as the card and needed a paragraph to explain the difference, which every coach paid for and few used; it survives as the **sub-8.0 fallback** of the card, which is the only role it has now.
  1. **Share-card (primary):** `savePreparedInlineMessage` + Mini App `shareMessage` (Bot API 8.0) — native chat picker, branded card lands in the coach–client DM "via @bot". The card's button must be a `url` deep link (`web_app` buttons are not allowed in inline messages); read the prepared message's `expiration_date` from the response; handle `USER_DECLINED`.
  2. **Prefilled personal message:** `openTelegramLink("https://t.me/share/url?url=…&text=…")` — native chat picker, link + editable text land in the input field; the coach sends a fully personal message, no "via @bot" label, zero Bot API calls.
  3. **Copy link (canonical fallback):** `navigator.clipboard` on a user gesture + select-text fallback — there is no `copyTextToClipboard` in the Mini App API. Works outside Telegram; the channel-agnostic base for future channels.
  - Inline mode (`@bot` in the message field) is **not shipped** — it duplicates the share-card with worse ergonomics and requires `/setinline`.
- **No hijack verification:** the first click accepts — the link is delivered privately. The safeguard is visibility: the coach sees which Telegram account accepted (name / username / avatar) and can unbind the channel and re-invite.

### Session-first flow

- Creating a client and scheduling the first session happen in one Mini App flow — **as two steps of one route**, amended by [#56](https://github.com/apshenichniy/praximo/issues/56): the New client screen commits the client and the invitation together, and the session is booked from a sheet on the client's own route, which is the same screen the coach comes back to a day later. The first session defaults to kind `intake` ([domain-model.md](domain-model.md)).
- Creation asks for a **name and the invitation's language**. That language is the language of the *message the coach sends*, recorded on `invite.delivery`; the client still picks their own at acceptance, and the screen says so beside the chips — without that line, "Language" on a screen titled with a person's name reads as *that person's* language, and the coach picks wrong and never finds out.
- **Scheduling while consent is pending is allowed.** The client physically cannot join before accepting: the join link is delivered over the client's channel, and the channel exists only after acceptance (which includes consent). Scheduling is blocked only after **revocation** ([privacy-retention.md](privacy-retention.md)). The client's join link is not exposed to the coach until consent is granted — for manual clients, the coach receives the forwardable join link only once the client has accepted.

### Acceptance sequence — Telegram bot

1. **`/start`** — the client is recognized by token or by id binding.
2. **Language ask** — a compact trilingual message with inline buttons EN / UK / RU, pre-selected from Telegram's `language_code`. Sets `client.language`.
3. **Consent** — the consent text in the chosen language (the five required elements from [privacy-retention.md](privacy-retention.md)) + privacy policy link + a single "I agree" button. Copy is written in prototype [#16](https://github.com/apshenichniy/praximo/issues/16).
4. **Confirmation** — "your coach N set up your profile", plus session details when one is already scheduled.

- **Acceptance is atomic:** Channel created — with a Telegram profile snapshot (name, username, avatar stored in R2) — + Consent Grant appended + Invite → `accepted`. If the client never presses "I agree", nothing is created and the Invite stays `pending` until TTL.
- A bare `/start` from a stranger (no token, no id match) → polite "this is coach N's assistant bot; ask them for an invite". The coach's own `/start` opens the coach menu.

### Acceptance sequence — web page

For invites delivered outside Telegram, the same token will open
`me.praximo.io/i/<token>` in the Client App when #57 lands. The path is `/i/`
rather than `/invite/` so the URL stays within the manual-client forward
template's `copy_text` ceiling. The #215 foundation migration intentionally
does not implement this product flow.

1. **Language** — EN / UK / RU pick; pre-selected from the invite's language (coach-chosen for email invites), falling back to `Accept-Language`. Sets `client.language`.
2. **Profile** — name pre-filled from the coach's entry, editable; optional avatar upload (stored in R2); optional email field, hidden when the invite was delivered to an email address (it is already known). A **Continue with Google** button one-tap fills name, avatar, and email from the Google profile and captures the Google `sub`; basic profile scopes only, the OAuth token is discarded, **no account is created**. Fact-checked in [#28](https://github.com/apshenichniy/praximo/issues/28):
   - Scopes `openid profile email` cover everything; `sub` is always in the ID token, but name/picture are **not guaranteed** there — read the profile from the `userinfo` endpoint. The `picture` URL is fetched server-side at acceptance and snapshotted to R2 (googleusercontent URLs are not stable long-term).
   - The button **must follow Google's branding guidelines** — required to pass OAuth app verification. "Continue with Google" is an approved CTA; localizing it is explicitly encouraged.
   - The import must not discard fields the client already typed: the Google button sits **above** the manual fields (validated in the prototype), and the flow uses a popup-based GIS flow — with a full-page redirect fallback that persists a form draft first.
3. **Consent** — the same consent text in the chosen language + privacy policy link; the single "I agree" button is the commit. Until it is pressed, nothing is persisted — including the avatar: the file stays client-side (object URL) and travels in the single commit request, so atomicity needs no temp storage ([#28](https://github.com/apshenichniy/praximo/issues/28)).
4. **Confirmation** — "your coach N set up your profile", plus session details when one is already scheduled. On-page only; no confirmation email.

- **Acceptance is atomic**, mirroring the bot: one transaction creates the Channel — kind `email` when an address is present (from the invite or the form), else `manual` — stores the profile (name, avatar, email, `google_sub` when given), appends the Consent Grant, and sets the Invite → `accepted`.
- A client without an avatar renders as initials in the web room.
- Token hygiene: `Referrer-Policy: no-referrer` on the page (Worker-wide, see §Web-room access); the invite token is single-use with a 7-day TTL, so it needs no further URL scrubbing.
- The full flow (invite → acceptance → reminder → join) was validated in prototype [#28](https://github.com/apshenichniy/praximo/issues/28) (`prototypes/client-web-flow`, merged in PR [#29](https://github.com/apshenichniy/praximo/pull/29)) and judged to read as a familiar sign-up.

## Web-room access

Decided in wayfinder ticket [#25](https://github.com/apshenichniy/praximo/issues/25). Session lifecycle and join eligibility live in [web-room-sessions.md](web-room-sessions.md); this section owns the credential and token mechanics.

- **Symmetric join links:** per-(session, role) tokens for the coach and the client. In MVP the web room runs entirely on join links — the coach's Mini App credential never has to reach the external browser. The gates are specified as an OR so the Better-Auth branch can light up post-MVP without migration; that branch is **undefined until Better Auth is adopted** ([ADR 0006](../adr/0006-coach-authentication-in-mvp.md)), and lighting it up is part of that adoption, not of the web-room slice:

  ```
  coachGate  = valid coach join link                                        -- MVP
            OR (Better-Auth session AND member of the session's workspace)  -- post-MVP: desktop web-app
  clientGate = valid client join link                                       -- the client's only credential, always
  ```

- **Token mechanics:** opaque random token, ≥128 bits of entropy, base64url; the DB stores a SHA-256 hash per (session, role); validation is a DB lookup in the `client` Worker, which is where the room runs (below). Not signed (no HMAC/JWT): revocation and rotation must be instant and stateful, and the join endpoint is not a hot path.
- Join links are **multi-use** (reconnects after a drop), valid while the session is `scheduled` / `in_progress`, dead in terminal states — revocation is implicit in the session lifecycle (this is the "access not revoked" mechanism referenced by the web-room spec).
- **Stable across rescheduling** — a reschedule mutates the time in place, the link keeps working, nothing is resent.
- **Rotation on compromise:** a coach command — "reissue links", on the session card in the Mini App and in the bot — rotates both (session, role) tokens and re-delivers them through the usual channels; old links die instantly (one UPDATE on the hashed rows).
- **Coach link is a bearer capability — accepted residual risk (MVP):** the coach link authenticates the coach role, including the in-room commands (`extend`, `end_session`, `cancel`). Mitigations: delivery only into the coach's private bot chat; validity bounded by the session lifecycle; `extend`/`end_session` additionally require a server-confirmed live connection in the room; rotation above. Residual: a holder of a leaked coach link can enter the room as the coach — visible to the other participant.
The room will run on `me.praximo.io/room/<token>` in the Client App for both
actors: by [ADR 0006](../adr/0006-coach-authentication-in-mvp.md) the Coach App
credential must never reach an external browser, so the Coach joins from a
browser like anybody else. #64 creates the route after the fresh #57
implementation; #215 creates no room or harness scaffolding.

- **URL-leakage mitigations:** `Referrer-Policy: no-referrer` on all room pages — set once, on every response of that Worker, by a request middleware in `apps/client/src/start.ts`; the pre-join page reads the token into memory and strips it from the URL via `history.replaceState` (`sessionStorage` covers same-tab reconnects). No token→cookie exchange in MVP.
- **Delivery — coach:** bot reminder messages plus a Join button on the session card in the Mini App, both via the web_app trampoline (webview constraint in [web-room-sessions.md](web-room-sessions.md) §14). Cross-device in MVP rides Telegram multi-device: the same bot chat in Telegram Desktop opens the system browser; copy-link is the fallback. PIN sign-in for a browser without Telegram (Better-Auth `device-authorization` plugin) is post-MVP, on the Better-Auth branch of the gate — which means it arrives no earlier than the adoption step in [ADR 0006](../adr/0006-coach-authentication-in-mvp.md).
- **Delivery — client:** over the client's primary channel. Telegram: bot reminder messages via the web_app trampoline. Email: reminder emails carrying the plain https join link — no trampoline needed outside Telegram webviews. Manual: the coach forwards the link from their reminder message (below). Join links are **channel-agnostic** ([#27](https://github.com/apshenichniy/praximo/issues/27)).

## Email channel

First-class: the service delivers itself — unlike Telegram, where the bot cannot message first and the coach always delivers the invite. Decided in [#27](https://github.com/apshenichniy/praximo/issues/27); provider research in [#26](https://github.com/apshenichniy/praximo/issues/26).

- **Invite email** — sent by the service on invite creation to `Invite.delivery.address`, from `no-reply@mail.praximo.io`, written as the coach's assistant (the coach's name in the content, consistent with the bot's branding principle). Language: chosen by the coach at client creation, defaulting to the coach's language; the acceptance page pre-selects it and the client may change it. The coach can always copy the web invite URL as a manual fallback.
- **Reminder emails** — the same reminder events the bot sends to Telegram clients, with the join link. Timing and cadence belong to the reminder-mechanics ticket (map fog); this spec fixes only the routing branch: `telegram → bot, email → email, manual → coach`.
- **The MVP email set is exactly these two.** No acceptance-confirmation email (the confirmation is the page); no artifact delivery over email (artifacts are coach-only, via the bot).
- **Provider: Cloudflare Email Service** (public beta) — `send_email` binding, sending subdomain `mail.praximo.io` provisioned from the Alchemy stack, automatic bounce/complaint suppression (nothing else built for bounces in MVP). Templates: React Email components with a `locale` prop, rendered in-Worker. Template copy interpolating people's names must keep them in the **nominative case** — uk/ru would otherwise demand declension («сесія з Анною», not «з Анна Коваленко»); phrase around the name instead of inflecting it ([#28](https://github.com/apshenichniy/praximo/issues/28)). Resend stays the documented drop-in fallback behind the `EmailChannel` service interface. Details: `docs/research/email-provider.md` (branch `research/email-provider`).

## Manual clients (link-forwarding)

For clients on WhatsApp, Viber, or anything else: the coach forwards the links; the platform's job is to make forwarding effortless. Decided in [#27](https://github.com/apshenichniy/praximo/issues/27).

- **Channel kind `manual`, no address** — created when the client accepts via the web page without leaving an email. Preserves the "exactly one primary channel" invariant and makes reminder routing an explicit branch.
- **Reminders route to the coach:** the coach's bot chat receives the ready-to-forward client-facing message — in the client's language, join link included — marked "forward this to N". A native **copy button** rides under it: `InlineKeyboardButton.copy_text` (Bot API 8.0), which caps the copied text at **256 characters** — the forward template must stay under that, join link included (the prototype's is 196). After a link rotation the old button keeps copying the dead link, so rotation re-sends a fresh reminder message. No delivery tracking in MVP.
- **Sharing UX from the Mini App:** copy-link is canonical (clipboard + textarea fallback, per [#19](https://github.com/apshenichniy/praximo/issues/19)). On iOS only, an additional Share button opens the OS share sheet via `navigator.share` — gated by `Telegram.WebApp.platform === 'ios'`, not feature-detection: Android WebView lacks the API entirely, both Telegram Web clients block it via Permissions Policy, and Desktop's WebView2 fails silently (fact-checked in [#27](https://github.com/apshenichniy/praximo/issues/27)). Per-messenger deep-link buttons (`wa.me`, `viber://`) are not shipped.
- **Self-upgrade:** if the client provides an email on the acceptance page, the channel is `email`, not `manual` — reminders then go direct, and the manual path remains only for clients who skip the field.
