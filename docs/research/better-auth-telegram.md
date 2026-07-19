# Research: Better-Auth × Telegram integration paths

- **Ticket:** [#5](https://github.com/apshenichniy/praximo/issues/5) (part of #1)
- **Date:** 2026-07-19
- **Context:** praximo — coaching platform. Coach authenticates via Telegram (Mini App `initData`); clients have no accounts in MVP. Web app on TanStack Start; Better-Auth chosen with future extensibility to email/OAuth. Bot-per-coach architecture (each coach workspace has its own Telegram bot, driven by grammY).

---

## 1. Validating Telegram Mini App `initData` server-side

### 1a. HMAC-SHA256 scheme (first-party, requires bot token)

Source: [Validating data received via the Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)

Algorithm (exact steps):

1. Parse `initData` (a URL-encoded query string) into key/value pairs; remove the `hash` field.
2. Build the **data-check-string**: all remaining fields sorted alphabetically, formatted as `key=<value>`, joined with `\n` (0x0A). Example: `auth_date=<auth_date>\nquery_id=<query_id>\nuser=<user>`.
3. Derive the **secret key**: `secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)` — i.e. the HMAC-SHA-256 signature of the bot token with the constant string `WebAppData` used as key.
4. Compute `hex(HMAC_SHA256(key = secret_key, message = data_check_string))` and compare with the received `hash`. Match ⇒ data originates from Telegram.
5. Additionally check `auth_date` (Unix time) for freshness to prevent replay (Telegram recommends this; the window is app-defined — 5 min to 24 h are common choices).

### 1b. Ed25519 signature (third-party validation, no bot token needed)

Source: [Validating data for third-party use](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use)

Since Bot API 7.10, `initData` also carries a `signature` field (base64url Ed25519 signature). Validation:

1. Build the data-check-string as: `"<bot_id>:WebAppData"` + `\n` + all fields **except `hash` and `signature`**, sorted alphabetically as `key=<value>`, joined with `\n`. Example: `12345678:WebAppData\nauth_date=...\nquery_id=...\nuser=...`.
2. Verify the Ed25519 `signature` against that string using Telegram's public keys:
   - Production: `e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d`
   - Test env: `40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec`
3. Check `auth_date` freshness.

You need the `bot_id` (but **not** the bot token). Relevant for bot-per-coach: the auth endpoint can validate initData for any coach's bot knowing only the bot id, without loading that bot's secret token into the auth path.

### Ready-made libraries (both verified current)

| Package | Functions | Ed25519 | Weekly downloads (Jul 2026) |
|---|---|---|---|
| [`@telegram-apps/init-data-node`](https://www.npmjs.com/package/@telegram-apps/init-data-node) v2.0.10 | `validate`, `isValid`, `validate3rd`, `isValid3rd`, `parse`, `sign`, `signData`, `hashToken` (exports verified from the published bundle) | Yes (`validate3rd`) | ~9.8k |
| [`@grammyjs/validator`](https://github.com/grammyjs/validator) | `validateWebAppData(botToken, URLSearchParams)`, `checkSignature` (Login Widget) | No | ~2.6k |

`init-data-node` is the stronger choice: typed `parse()` of the user payload, hashed-token support, Ed25519 third-party validation, works from the token or a pre-hashed secret. grammY itself (bot framework) does not bundle initData validation; `@grammyjs/validator` is a small separate package (HMAC only, modestly maintained — ~21 commits, 20 stars).

## 2. Turning validated initData into a Better-Auth session

**Better-Auth core has no Telegram provider and no generic "custom credential" provider.** Telegram is not OAuth (no authorization-code flow, no token endpoint), so `genericOAuth` cannot model it. The feature request for a native Telegram Mini App provider was **closed as not planned**: [better-auth#1813](https://github.com/better-auth/better-auth/issues/1813); the Login Widget request [better-auth#3526](https://github.com/better-auth/better-auth/issues/3526) is also closed.

The sanctioned path is the **plugin API** ([docs: Plugins](https://better-auth.com/docs/concepts/plugins)):

- Server plugin = object satisfying `BetterAuthPlugin` with an `id`, `endpoints` built via `createAuthEndpoint` (from `better-auth/api`), optional `schema` extensions to `user`/`account`, and `hooks`.
- Inside an endpoint handler, `ctx.context.internalAdapter` gives DB access: find-or-create the user + account, then `await ctx.context.internalAdapter.createSession(userId, ctx)` and set the session cookie (`setSessionCookie` helper; respects `__Secure-` prefixes). Community-confirmed pattern: [discussion #2125 "Is it possible to manually create a session?"](https://github.com/better-auth/better-auth/discussions/2125).
- A matching client plugin (`BetterAuthClientPlugin` with `$InferServerPlugin`) gives a typed `authClient.telegram.signIn(...)` on the front end.

So the shape of our integration: `POST /telegram/sign-in` endpoint that takes raw `initData` (+ workspace/bot context), validates it (Section 1), maps `user.id` from the Telegram payload to a Better-Auth `user` + `account` row (`providerId: "telegram"`, `accountId: <telegram user id>`), creates a session, sets the cookie, and (with the Bearer plugin enabled) returns a `set-auth-token` header.

## 3. Existing plugins / community solutions

| Project | State | Notes |
|---|---|---|
| [`vcode-sh/better-auth-telegram`](https://github.com/vcode-sh/better-auth-telegram) ([npm](https://www.npmjs.com/package/better-auth-telegram)) | **Active.** v1.5.0 (2026-03-10), 91 stars, MIT, pushed May 2026, ~1.9k downloads/wk, 261 tests / 100% coverage, CI + codecov | Login Widget + Mini App initData + Telegram OIDC. HMAC via Web Crypto (Node ≥ 22, edge-compatible). Endpoints: `/telegram/miniapp/signin`, `/telegram/miniapp/validate`, `/telegram/signin`, link/unlink. Client: `signInWithMiniApp(initData)`, `autoSignInFromMiniApp()`. Adds `telegramId`/`telegramUsername`(/`telegramPhoneNumber`) to `user` and `account`. Rate-limited endpoints, `maxAuthAge` replay protection, `mapMiniAppDataToUser` hook. |
| [`vitalygashkov/telegram-better-auth`](https://github.com/vitalygashkov/telegram-better-auth) | Unmaintained (17 stars) | Superseded by the above. |

**The blocker for praximo: `better-auth-telegram` is single-bot.** Config takes exactly one `botToken`/`botUsername` (verified against the full README config table — no multi-bot option). Bot-per-coach means initData must be validated against *the coach's* bot token (or that bot's id via Ed25519), resolved per request. We would have to fork or wrap it. Also: no Ed25519 third-party validation, and Node ≥ 22 required.

**What we'd build ourselves** (small, well-bounded): one server plugin (~an endpoint + schema extension + user-mapping), one thin client plugin. Validation itself is delegated to `@telegram-apps/init-data-node`. The community plugin remains a useful reference implementation (MIT) for the user/account mapping and replay-protection details.

## 4. One session across the Mini App webview and the regular web app

Cookie reality inside Telegram clients:

- **Native apps (iOS/Android/Desktop):** the Mini App loads our origin top-level in a WebView — our session cookie is **first-party**. Standard Better-Auth `httpOnly` cookies work; `SameSite=Lax` is fine because all auth calls are same-origin XHR from our own page. Caveat (community-reported, not officially documented): iOS `WKWebView` cookie persistence across app restarts can be flaky; the webview is also a separate cookie jar from the user's browser. See e.g. [dev.family on Mini App testing specifics](https://dev.family/blog/article/telegram-mini-app-development-and-testing-specifics-from-initialisation-to-launch) and [WKWebView cookie-store isolation](https://medium.com/axel-springer-tech/synchronization-of-native-and-webview-sessions-with-ios-9fe2199b44c9).
- **Telegram Web (web.telegram.org):** the Mini App is embedded in an **iframe** → our cookies are third-party there and are blocked by Safari/ITP and increasingly by Chrome. Cookie-based sessions cannot be relied on in Telegram Web.
- **Mitigation Better-Auth supports out of the box:** the [Bearer plugin](https://better-auth.com/docs/plugins/bearer) — after sign-in the server returns the session token in a `set-auth-token` response header; the client stores it (in-memory or `sessionStorage`) and sends `Authorization: Bearer <token>`. Docs warn to use it deliberately (XSS exposure if kept in `localStorage`). Since the Mini App re-receives fresh `initData` on every launch, silent re-auth is cheap — token loss is a non-event.
- **"One session" across contexts:** the Telegram webview and the user's normal browser have separate cookie jars, so it is one **user/account** with multiple concurrent Better-Auth sessions (supported natively — sessions are rows in the `session` table), not one shared cookie. If a "continue in browser" handoff is ever needed, mint a one-time short-lived token deep link; do not try to share the cookie.
- **TanStack Start:** mount `auth.handler` in `src/routes/api/auth/$.ts`, add the `tanstackStartCookies` plugin (last in the plugin array) so Better-Auth cookies flow through Start's server functions; read sessions via `auth.api.getSession({ headers })`. Source: [TanStack integration docs](https://better-auth.com/docs/integrations/tanstack).

## 5. Linking a Telegram identity to a workspace/tenant (bot-per-coach)

Model identity and tenancy as orthogonal:

- **Identity (global):** one Better-Auth `user` per human; one `account` row with `providerId = "telegram"`, `accountId = <telegram user id>`. The Telegram user id is stable across all bots — the *same* `accountId` regardless of which coach's bot opened the Mini App. So a human authenticates once as themselves, no per-bot identities.
- **Tenancy:** the [organization plugin](https://better-auth.com/docs/plugins/organization) gives `organization` (workspace), `member` (user × org × role), `invitation`, optional `team` tables, plus an *active organization* on the session. One workspace per coach; the coach is `owner` of their org; the same human can later be `member`/`client` in another org — exactly the "coach in one workspace, client elsewhere" requirement. Roles are customizable.
- **Bot → workspace resolution:** store `botId` (+ encrypted bot token for grammY) on the workspace. The Mini App launch URL is workspace-scoped (path or query param, or `start_param`), so the sign-in endpoint resolves workspace → bot, validates initData with that bot's token (HMAC) or bot id (Ed25519), then sets the session's active organization to that workspace. Membership is granted by invitation/first-launch policy, not by mere authentication.

## 6. Extensibility: adding email/OAuth accounts later

Better-Auth's model is built for this ([Users & Accounts docs](https://better-auth.com/docs/concepts/users-accounts)):

- `user` 1—N `account`; each `account` has `providerId` + `accountId`. Adding Google/email later = new `account` rows on the same `user`. No table migrations needed beyond what plugins add.
- Linking: automatic linking is email-verification-based by default; since **Telegram provides no email**, enable `account.accountLinking.allowDifferentEmails` (and/or explicit `linkSocial()` flows) for linking OAuth to a Telegram-first user. `setPassword` (server API) adds email/password credentials to an existing user.
- **Email placeholder decision (required now):** Better-Auth's `user.email` is non-null. Telegram-first users need a synthetic unique email (e.g. `tg-<telegramId>@users.praximo.app`, `emailVerified: false`) that is replaced/augmented when a real email is linked post-MVP. This is what community Telegram plugins do implicitly; make it explicit in our mapper.
- **Drizzle:** `drizzleAdapter(db, { provider: "pg" })`; `npx @better-auth/cli generate` emits the Drizzle schema **including plugin schema extensions** (our plugin's `telegramId` field on `user`/`account`, organization tables), then normal `drizzle-kit generate`/`migrate`. Source: [Drizzle adapter docs](https://better-auth.com/docs/adapters/drizzle).

---

## Recommended integration approach

1. **Write a small first-party Better-Auth plugin (`telegram-mini-app`)** instead of adopting `better-auth-telegram` — its single-bot config conflicts with bot-per-coach, and the plugin surface we need is small. Crib its mapping/replay details (MIT).
2. **Validate with `@telegram-apps/init-data-node`**: `validate(initDataRaw, botToken, { expiresIn })` (HMAC) after resolving the workspace's bot; keep `validate3rd` (Ed25519, bot-id-only) as an option if we later want the auth path token-free. Enforce a short `auth_date` window (e.g. 1 h).
3. **Endpoint flow:** `POST /telegram/sign-in { initDataRaw, workspaceSlug }` → resolve workspace → validate → upsert `user` (+`account` `providerId:"telegram"`, synthetic email) → `internalAdapter.createSession` + `setSessionCookie` → organization membership check / active-org set.
4. **Sessions:** cookies as primary (first-party in native Telegram webviews and the regular web app, via `tanstackStartCookies`); enable the **Bearer plugin** as fallback for Telegram Web's iframe context, with the token kept out of `localStorage` and silent re-auth from fresh `initData` on each Mini App launch.
5. **Tenancy:** Better-Auth **organization plugin** for workspaces; global Telegram identity, per-workspace membership + role; `botId`/token stored on the workspace.
6. **Future-proofing:** rely on the native multi-account model; enable `allowDifferentEmails` when OAuth arrives; define the synthetic-email convention now.

## Risks

- **Telegram Web (iframe) cookie blocking** — must ship the Bearer fallback or declare Telegram Web unsupported for MVP; test explicitly.
- **Webview cookie persistence on iOS** — community-reported flakiness only, **not verifiable from official docs**; mitigated by cheap re-auth from `initData`. Needs empirical testing on real devices.
- **No email from Telegram** — synthetic email is a workaround; collisions/UX when a real email is linked later must be designed (verification, `allowDifferentEmails` weakens automatic-linking safety — prefer explicit linking flows).
- **Per-coach bot tokens in the auth path** — secrets sprawl; encrypt at rest, or move to Ed25519 `validate3rd` (needs only bot id). Note Ed25519 `signature` is only present on Bot API ≥ 7.10 clients.
- **initData replay** — bounded by `auth_date` window; a stolen fresh `initData` within the window can mint a session. Standard for the ecosystem; keep the window tight and rate-limit the endpoint.
- **Better-Auth internals (`internalAdapter`, `setSessionCookie`) are semi-public API** — used widely by community plugins and in maintainer discussions, but not a stability-guaranteed contract; pin versions and cover with an integration test.
- **Unverified items:** exact per-client (iOS/Android/Desktop) webview cookie behavior; long-term status of Telegram's OIDC flow (irrelevant for Mini App auth but an option for the browser-side coach login later — the BotFather OIDC switch is reportedly one-way/permanent per the community plugin's README).

## Sources

- Telegram Mini Apps — initData validation (HMAC + Ed25519): https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app and https://core.telegram.org/bots/webapps#validating-data-for-third-party-use
- Better-Auth plugin API: https://better-auth.com/docs/concepts/plugins
- Better-Auth users & accounts / linking: https://better-auth.com/docs/concepts/users-accounts
- Better-Auth Bearer plugin: https://better-auth.com/docs/plugins/bearer
- Better-Auth organization plugin: https://better-auth.com/docs/plugins/organization
- Better-Auth TanStack Start integration: https://better-auth.com/docs/integrations/tanstack
- Better-Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Manual session creation discussion: https://github.com/better-auth/better-auth/discussions/2125
- Core Telegram-provider requests (closed): https://github.com/better-auth/better-auth/issues/1813, https://github.com/better-auth/better-auth/issues/3526
- Community plugin: https://github.com/vcode-sh/better-auth-telegram (npm: better-auth-telegram); legacy: https://github.com/vitalygashkov/telegram-better-auth
- Validation libraries: https://www.npmjs.com/package/@telegram-apps/init-data-node, https://github.com/grammyjs/validator
- Webview cookie context: https://dev.family/blog/article/telegram-mini-app-development-and-testing-specifics-from-initialisation-to-launch, https://medium.com/axel-springer-tech/synchronization-of-native-and-webview-sessions-with-ios-9fe2199b44c9
