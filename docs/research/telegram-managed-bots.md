# Research: Telegram Managed Bots API for bot-per-coach provisioning

- **Ticket:** [#2](https://github.com/apshenichniy/praximo/issues/2) (feeds ADR ticket [#9](https://github.com/apshenichniy/praximo/issues/9), "bot-per-coach mechanism")
- **Date:** 2026-07-19
- **Sources:** Official Telegram docs (core.telegram.org), Telegram BotNews channel, grammY docs/repo. Secondary sources are marked as such.

## TL;DR

Managed Bots is real and shipped in **Bot API 9.6 (April 3, 2026)**, extended in 10.0. It does **not** let our backend mint bots silently; instead, our **manager bot** prompts the coach to create a bot **in one tap** (keyboard button or deep link), the **coach owns** the new bot, and our manager bot immediately receives an update and can fetch the bot's token via `getManagedBotToken` — no BotFather copy-paste. This is exactly the bot-per-coach provisioning primitive we need. grammY (v1.45.0, Bot API 10.2 coverage) supports it. Recommendation: **Managed Bots as the primary onboarding flow, manual BotFather token paste as fallback**, one Cloudflare Worker serving all bots via per-bot webhook paths + per-bot `secret_token`.

---

## 1. What "Managed Bots" actually is

Introduced in **Bot API 9.6 (April 3, 2026)**; access-control additions in **Bot API 10.0 (May 8, 2026)**.
Primary docs:

- Bot API changelog: https://core.telegram.org/bots/api-changelog
- MTProto-level concept page: https://core.telegram.org/api/bots/managed-bots
- Bot API reference: https://core.telegram.org/bots/api
- Announcements: https://t.me/s/botnews

### Creation & ownership model

- A managed bot is a normal bot account that is **fully owned by the user who created it** (the coach), while being **controlled by a designated "manager bot"** (our platform bot).
- **Bots cannot create bots directly.** Creation is always a user-consent action, via either:
  - a reply-keyboard button: `KeyboardButtonRequestManagedBot` / `request_managed_bot` field on `KeyboardButton` — "pressing the button will ask the user to create and share a bot that will be managed by the current bot" (private chats only); or
  - a deep link: `https://t.me/newbot/{manager_bot_username}/{suggested_bot_username}` (added in 9.6);
  - Mini Apps can use `PreparedKeyboardButton` / `savePreparedKeyboardButton` to trigger the same request.
- Under the hood the client calls MTProto `bots.createBot` (name 1–64 chars; username 5–32 chars ending in `bot`; `bots.checkUsername` for availability). The coach's Telegram client drives this; our server never sees this step.
- Our manager bot then receives:
  - `ManagedBotCreated` (field `managed_bot_created` on `Message`) and/or
  - `Update.managed_bot` (`ManagedBotUpdated`, also fired when the **token or owner of a managed bot changes** — important for token-rotation handling).
- Token retrieval: **`getManagedBotToken(user_id)` → String** (the child bot's token); **`replaceManagedBotToken`** rotates it. With the token, we "control the new bot via the Bot API, receive and respond to messages, change its profile, settings and more" (BotNews).
- The **owner keeps full control via BotFather** (can revoke/regenerate the token — we get `ManagedBotUpdated` and must re-fetch).
- `User.can_manage_bots` (returned in `getMe`): "True, if other bots can be created to be controlled by the bot."

### Per-bot identity / branding

Once we hold the child bot's token, standard Bot API self-management methods apply per bot:

- `setMyName`, `setMyDescription`, `setMyShortDescription` (localizable),
- `setMyProfilePhoto` (static JPG or animated MPEG4 avatar; `InputProfilePhotoStatic` / `InputProfilePhotoAnimated`),
- `setMyCommands`, menu button, etc.

So each coach bot can carry the coach's name, avatar, and description, set programmatically at onboarding.

### Access settings (Bot API 10.0)

- `BotAccessSettings`, `getManagedBotAccessSettings`, `setManagedBotAccessSettings`: restricted-access mode where only the owner (plus an allowlist of up to **10 additional users**, per the MTProto docs) can access the managed bot. Useful for a "private beta" state before a coach launches.

## 2. Requirements, limits, pricing

- **Requirement:** the manager bot must have bot-management enabled "in the @BotFather Mini App" (per the `request_managed_bot` field docs); this sets the `can_manage_bots` flag. No verification/paid tier is documented.
- **Ownership limit is per coach, not per platform:** bot-creation limits come from the account-level config keys `bots_create_limit_default` / `bots_create_limit_premium` (error `BOT_CREATE_LIMIT_EXCEEDED`). Secondary sources (limits.tginfo.me) put this at **20 bots free / 40 with Premium**. Since each coach owns exactly one bot, this is a non-issue for us. **No documented limit on how many bots one manager bot can manage** (absence of a limit is not positively confirmed — see confidence notes).
- **Pricing: none.** No pricing appears in the changelog, the managed-bots docs, or BotNews. Normal Bot API costs apply (e.g., paid broadcasts, below).
- **Messaging rate limits** (per bot, from https://core.telegram.org/bots/faq):
  - ≤ 1 message/second per chat; ≤ 20 messages/minute per group;
  - bulk: ~**30 messages/second free**; optional **paid broadcasts up to 1000 msg/s at 0.1 Stars/message** beyond the free 30/s.
  - Because each coach has their *own* bot, these limits apply **per coach**, which is a major scalability win over a single shared bot.

## 3. Webhook architecture: many bots, one Cloudflare Worker

- `setWebhook` is **per bot** (called with each bot's token). Relevant parameters (https://core.telegram.org/bots/api#setwebhook):
  - `url` — any HTTPS URL (ports 443, 80, 88, 8443). Use a per-bot path on one Worker: `https://bots.praximo.app/tg/{bot_id}`.
  - `secret_token` — 1–256 chars (`A-Z a-z 0-9 _ -`); Telegram echoes it in the `X-Telegram-Bot-Api-Secret-Token` header. Generate a **random secret per bot**, store alongside the bot record, and reject non-matching requests. This is the authentication layer for the shared Worker.
  - `max_connections` — 1–100 simultaneous deliveries, default 40, **per bot**, so fan-out capacity scales with the number of bots.
- Worker routing: extract `{bot_id}` from the path → load bot record (token, secret, coach/tenant id) from D1/KV → verify secret header → instantiate grammY `Bot` for that token → `webhookCallback(bot, "cloudflare-mod")`. Pass cached `botInfo` to the `Bot` constructor to avoid a `getMe` round-trip per request (pattern from https://grammy.dev/hosting/cloudflare-workers).
- Also subscribe the **manager bot** to `allowed_updates` including `managed_bot` so provisioning events arrive.

## 4. grammY support

- Current release: **v1.45.0**; the docs state grammY "supports Telegram Bot API 10.2 which was released on July 14, 2026" (https://grammy.dev). Bot API 10.2 is the latest version as of this research.
- Managed Bots landed in **grammY v1.42.0** ("support Bot API 9.6", grammyjs/grammY PR #892); `managed_bot` is included in `DEFAULT_UPDATE_TYPES` in `src/bot.ts` (https://github.com/grammyjs/grammY).
- Rich Messages (Bot API 10.1/10.2: `sendRichMessage`, `sendRichMessageDraft` for streaming AI replies, `InputRichBlock*`) are covered by the 10.1/10.2 support — relevant later for streaming coach-AI answers.
- First-class Cloudflare Workers adapter: `webhookCallback(bot, "cloudflare-mod")` (https://grammy.dev/hosting/cloudflare-workers).

## 5. Fallback: manual BotFather token

For coaches who decline the one-tap flow, or if Managed Bots misbehaves:

- **UX:** coach opens @BotFather → `/newbot` → picks name + username → copies token → pastes it into our onboarding (web form or DM to the manager bot). We validate with `getMe`, then run the same branding pipeline (`setMyName`, `setMyProfilePhoto`, ...) and `setWebhook`.
- **Constraints:**
  - We **cannot verify who owns the bot** — anyone with a leaked token could register it. Mitigation: require a `/start` handshake from the coach's own Telegram account on the new bot before activation.
  - Coach can revoke/regenerate the token in BotFather at any time with **no notification to us** (unlike managed bots, where `ManagedBotUpdated` fires). Handle 401s from the Bot API by flagging the tenant "needs re-link".
  - Branding is unaffected: once we hold the token, the same `setMyName`/`setMyProfilePhoto` pipeline works. The only manual step is token creation and pasting.
- **Security handling of the token (both flows):** the token is a full-control credential. Never log it; don't put it in URLs; store encrypted at rest (e.g., AES-GCM with a key held in Worker secrets; ciphertext in D1/KV); scope decryption to the webhook/runtime path; support re-fetch (`getManagedBotToken`) or re-paste on rotation. If a token pasted in a Telegram chat with the manager bot, delete that message after ingestion.

## 6. Recommendation for the bot-per-coach ADR (#9)

**Primary: Managed Bots one-tap provisioning.**

1. Enable bot management for the platform bot in the @BotFather Mini App (`can_manage_bots`).
2. Onboarding: manager bot shows a `request_managed_bot` keyboard button (or `t.me/newbot/...` deep link from the web app). Coach taps, names their bot, done.
3. On `Update.managed_bot` / `ManagedBotCreated`: call `getManagedBotToken`, encrypt and store the token, apply branding (`setMyName`, `setMyDescription`, `setMyProfilePhoto`), call `setWebhook` with a per-bot path + random `secret_token`.
4. Runtime: single Cloudflare Worker, path-routed per bot, secret-token verified, grammY `webhookCallback` with cached `botInfo`.
5. Handle `ManagedBotUpdated` (token rotation / ownership change) by re-fetching the token and re-arming the webhook.

**Fallback: manual BotFather token paste** with `getMe` validation + `/start` ownership handshake, same downstream pipeline. Keep it permanently as an escape hatch (coaches with existing bots, or Managed Bots outages).

**Why:** ownership sits with the coach (clean exit story, GDPR-friendly, no platform-side bot cap), per-coach rate limits, zero pricing, and grammY already supports every piece on Cloudflare Workers.

### Confidence notes

- **High confidence (primary sources):** existence and semantics of Managed Bots (Bot API 9.6/10.0 changelog, core.telegram.org/api/bots/managed-bots), `getManagedBotToken`/`replaceManagedBotToken`, `request_managed_bot` + BotFather Mini App requirement, `setWebhook` `secret_token`/`max_connections`, messaging rate limits, grammY 1.45.0 / Bot API 10.2 support.
- **Medium confidence (secondary sources):** exact per-user bot ownership limits (20 free / 40 Premium — from limits.tginfo.me; official docs only expose the config keys `bots_create_limit_default/_premium`); grammY managed-bots support arriving specifically in v1.42.0.
- **Not verifiable from primary sources:** the full field list of `KeyboardButtonRequestManagedBot`, exact `replaceManagedBotToken` parameters, and whether a *manager* bot has any cap on the number of bots it can manage (no limit is documented; test empirically during the spike).

## Sources

- Bot API changelog — https://core.telegram.org/bots/api-changelog
- Managed bots (MTProto docs) — https://core.telegram.org/api/bots/managed-bots
- Telegram Bot API reference — https://core.telegram.org/bots/api
- Bots FAQ (rate limits) — https://core.telegram.org/bots/faq
- BotNews (official announcements) — https://t.me/s/botnews
- grammY — https://grammy.dev (version/API coverage), https://grammy.dev/hosting/cloudflare-workers, https://github.com/grammyjs/grammY
- Secondary: aiogram type reference — https://docs.aiogram.dev/en/latest/api/types/keyboard_button.html; GramIO method reference — https://gramio.dev/telegram/methods/setmyprofilephoto; Telegram limits — https://limits.tginfo.me/en
