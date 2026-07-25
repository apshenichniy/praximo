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
  - ⚠️ **The launch mechanism matters, verified 2026-07-25.** Creation can be
    triggered two ways, and they are not equally supported: the
    `request_managed_bot` **reply-keyboard button** does not work on Telegram iOS
    — the client degrades an unknown button type into a share action, poisoning
    the whole keyboard, so even a plain text button beside it stops responding —
    while the **deep link** `t.me/newbot/{manager_bot}/{suggested_username}`
    opens the creation dialog correctly on iOS. Both drive the same MTProto
    `bots.createBot` and produce the same `managed_bot` update, and our claim is
    keyed on the coach's Telegram id rather than the keyboard's `request_id`, so
    the launch mechanism is interchangeable without touching the fence. **The
    deep link, on an inline `url` button, is what ships**
    ([#134](https://github.com/apshenichniy/praximo/issues/134)) — inline `url` is
    the most basic inline type there is and renders on every client, so it cannot
    hit the failure above.
  - **At most one live creation button exists in the coach's chat at any moment,
    and none once the bot is connected** ([#134](https://github.com/apshenichniy/praximo/issues/134)).
    The keyboard button was `oneTime()` and vanished after a tap; a link in a
    message is permanent, and `/start` is a documented resume path, so without
    this the chat accumulates armed buttons. The attempt row therefore records its
    `prompt_message_id`: a `/start` that offers creation strips the keyboard from
    the previously recorded prompt *before* sending the new one, and a completed
    activation edits that prompt in place — keyboard removed, text confirming the
    connected bot. **Edited, never deleted**: the coach is looking at exactly that
    message expecting confirmation. A partial provisioning failure deliberately
    leaves the button armed, because re-tapping is how the runbook says to resume,
    and a failed edit is logged rather than allowed to fail provisioning. This
    reduces exposure; it does not replace the server-side fence
    ([#135](https://github.com/apshenichniy/praximo/issues/135)) — a coach can
    still tap twice before the edit lands.
- **No shared-single-bot mode**, not even as a degraded state: it breaks branding and forfeits per-coach rate limits.

### Bot roles

- The **manager bot** (platform-owned; Telegram display name `PraximoMother`, dev instance suffixed) does provisioning and service notifications — to the coach ("bot needs re-link", permanent pipeline failures) and to the invite issuer, whose own bot cannot carry them. After onboarding it is mostly silent.
- The **coach's own bot is the single surface** for both the coach (Mini App entry, briefs / debriefs / mentor reviews as messages) and their clients. This is the "workspace bot" of the client-onboarding spec.

### Provisioning flow (within manual coach onboarding)

1. Admin creates the workspace manually and hands the coach a personal deep link to the manager bot.
2. Manager bot sends one message carrying a `t.me/newbot/{manager}/{suggested}` deep link on an inline `url` button, with a **suggested username derived from the workspace name plus a short tag derived from its id** — the bare stem of a short name (`demo_bot`) is long since registered on Telegram, and the suggestion now rides in a URL the coach reads, while the tag stays stable across the repeated `/start` that re-sends the prompt ([#147](https://github.com/apshenichniy/praximo/issues/147)). The coach picks the final name and display name in Telegram's own dialog (the deep-link form carries only the username).
3. On `Update.managed_bot` / `ManagedBotCreated`, everything is automatic: `getManagedBotToken` → `setChatMenuButton` pointing at the Mini App → **tell the coach their bot is being set up** → branding → the activation transaction → **turn that first message into the ready greeting** → `setWebhook` with a fresh per-bot secret. No manual steps after the tap.
   - **The menu button goes on first, before the coach is told anything** ([#156](https://github.com/apshenichniy/praximo/issues/156)). A Telegram client caches a bot's menu button when it opens the chat, and the coach opens theirs by tapping **Start bot** the moment the bot exists — the same moment this update arrives. Setting it at the end of configuration left them with no **Open** button until they reopened the chat: verified by `getChatMenuButton` returning the right `web_app` button while the coach saw none. This wins that race rather than removing it, since their tap and our first call are simultaneous; what makes that acceptable is the greeting's own inline **Open** button, which works regardless. The step also validates `COACH_MINI_APP_URL`, so an unusable one fails before any promise is made.
   - **The coach is told, because they are already waiting.** Telegram ends its creation dialog with a **Start bot** button, so they tap it seconds before there is anything to answer with; several of those seconds are ours (an avatar upload, two descriptions, the activation CTE). Silence there reads as failure, and a coach who taps again is how #135's second bot gets created ([#154](https://github.com/apshenichniy/praximo/issues/154)). The one step ahead of the announcement is the menu button, and a failure there costs the coach the announcement too — bounded by the redelivery that retries the whole update.
   - **No `/start` is needed to know they are there.** A bot may message a user who has started it and only such a user, so a send that succeeds proves the coach is sitting in the chat and a refusal proves they are not — which makes the announcement, and the greeting that replaces it, a pair of best-effort sends rather than a reaction to an update we may never receive. Only a `403` (or `chat not found`) means "not there"; every other failure is a send that should have landed, and is logged as one, because the message may even have arrived without us learning its id.
   - **The greeting is delivered before the webhook is armed.** Once the route is live the bot's own `/start` handler greets whoever taps Start, and that handler speaks the Telegram client's language rather than the workspace owner's — so editing after arming would risk greeting one tap twice, in two languages.
   - **`setWebhook` passes `drop_pending_updates`** on this path only. The one thing Telegram is holding is that early `/start`, and it has already been answered. Not on the BotFather path (#95), where a queued update may be the proof handshake itself, and not when re-configuring an installed bot, whose queue is the coach's and their clients' ordinary messages.
   - **One message is the intent, not a guarantee.** If the announcement's id is lost — the send failed, or failed after arriving — the greeting is its own message instead of an edit. The coach is greeted either way; only the tidiness is lost.

Opening `/start` does not reserve the workspace. It records a resumable request;
the first subsequent `managed_bot` update from a requester atomically claims the
still-current invite. The bot id is persisted before Telegram configuration
begins, and a repeated update resumes the same installation. Only the final
database transaction sets the owner and `connected`, consumes the invite, and
queues the manager-bot notification.

A `managed_bot` update for a coach with **no open attempt** — the second bot of a
coach who tapped twice — is a terminal, expected outcome, not a failure: the
webhook answers `200` so Telegram stops redelivering, and the coach is told the
extra bot is not connected and can be removed in @BotFather
([#135](https://github.com/apshenichniy/praximo/issues/135)). Genuine
infrastructure failures on the same path stay `500`, because those *are*
retryable; collapsing the two is what left the manager bot's webhook failing
forever. One shape is knowingly left behind: a coach whose attempt is still open
on an invitation an administrator reset gets a refusal that is equally
deterministic and still answers `500`. It is deliberately not folded into the
same 200 — the coach's bot really is unconnected there, so the reassuring copy
would be a lie, and what to say instead is a copy decision this ADR does not
take. The distinction matters more now that the entry point is a deep link
([#134](https://github.com/apshenichniy/praximo/issues/134)): a link stays in the
chat, where the `oneTime()` keyboard button it replaced vanished after a tap.

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
4. From the proof on it is the one-tap path, in the same order: the same claim,
   menu button, branding, activation transaction, greeting, webhook, and admin
   notification. Activation wipes the parked envelope and both proof hashes.

Every refusal — no open attempt, invalid token, a bot another workspace runs, a
foreign identity, a partial configuration failure — leaves the workspace
unconnected, and a fresh paste supersedes the previous nonce and secret.

### Webhook architecture and storage

- One `bot` Worker serves all bots, path-routed: `api.praximo.io/telegram/{bot_id}` per coach bot, `api.praximo.io/telegram/manager` for the manager bot (subscribed to `managed_bot` in `allowed_updates`).
- Every inbound request is verified against the bot's `secret_token` via the `X-Telegram-Bot-Api-Secret-Token` header. Coach-bot rows retain only its SHA-256 hash; the plaintext secret never leaves the provisioning call that minted it — it is held in memory from that moment until the webhook is armed at the end of the same invocation, and stored nowhere.
- **Only the hash of a secret is ever persisted, which is what fixes the order of the last two steps.** Re-configuring a bot mints a new secret, so the row and Telegram disagree for as long as one has been updated and the other has not, and the two directions do not cost the same. A bot being connected for the first time arms **after** the activation transaction — it has no working secret to lose, and arming earlier is what opened #150's window. A bot being re-configured arms **before** its row is rewritten — it has no window to close, and committing a new hash Telegram has not accepted would leave a healthy bot answering 401 to its own coach.
- Bot records live in **Postgres (Neon)**: bot id, encrypted token, webhook-secret hash, workspace id, status, cached `botInfo` (passed to the grammY `Bot` constructor to skip the per-request `getMe`). The Worker keeps a **per-isolate in-memory cache** of bot records, invalidated on token rotation. No KV/D1 tier in MVP.
- **A bot being connected for the first time has its webhook armed last, after the activation transaction** ([#150](https://github.com/apshenichniy/praximo/issues/150)). It used to be armed partway through configuration, which left a window where the bot delivered updates while the `bot` row did not exist yet — and the coach's very first `/start` lands exactly there, because Telegram shows them the freshly created bot the moment it exists. An update in that window matched neither the installed route nor the ownership-proof route. Arming last removes the window instead of deciding what to do inside it: an update Telegram holds because no webhook is set is delivered once one is, and by then the installation is there to serve it.
  - **The trade, knowingly taken.** A failure at the arming step now leaves a *connected* workspace whose bot is deaf, where the old order left an unconnected workspace whose bot was armed. It is repaired by the redelivery the rest of this design already depends on — the webhook answers 500, Telegram repeats the `managed_bot` update, and the already-installed branch reconfigures and re-arms — and this direction is the one that cannot cost a coach the greeting they are waiting for.
  - **Do not build on a status code meaning "retry".** Telegram makes no such distinction: it "will repeat the request and give up after a reasonable amount of attempts" for any response outside `2XY` (Bot API, `setWebhook`). 401 and 500 are retried alike, so ordering — not the answer — is what closes a window. The route still answers 500 rather than 401 for a bot it can see is mid-provisioning, but as honesty about what it knows and as a tripwire in the log, not as a mechanism.
  - **The symptom to expect if arming has diverged from the row** is not silence but `401` on every coach update, since the bot delivers and the presented secret no longer matches the stored hash. The route logs it by bot id.

### Token security

- Per-coach tokens are full-control credentials: **AES-GCM at rest**, ciphertext in Postgres, key held as a Worker secret (root `.env` → `Config.redacted`, per ADR 0003). Decryption happens only in the `bot` Worker's runtime path; tokens are never logged and never appear in URLs.
- The **manager bot's token is a stack secret** (platform key in `.env`), unlike per-coach tokens.

### Token lifecycle

- `ManagedBotUpdated` fires **only when a bot is created** — it carries the creating user and the new bot, nothing else. There is no owner-side rotation update, and a revoked token also stops inbound webhooks, so a coach who regenerates a token in @BotFather produces no signal in either direction. Discovery is therefore active: a daily `getMe` sweep over connected bots on the `bot` Worker's cron ([#55](https://github.com/apshenichniy/praximo/issues/55)).
- A 401 is **repaired before it is reported**. `getManagedBotToken` returns a fresh, immediately working credential for a bot created through Managed Bots — **management rights survive the owner's `/revoke`** (verified live on the dev stage, 2026-07-25) — so the token is re-encrypted, the bot fully reconfigured, and the workspace never leaves `connected`.
- Only an unrepairable bot becomes **"bot needs re-link"**: deleted (`getManagedBotToken` answers `403 Forbidden: user is deactivated`), or connected through the paste flow, where we never held management rights. Coach and invite issuer are both notified via the manager bot. No manual retry surface in the product, consistent with ADR 0001; recovery is coach-side re-linking.
- The stored token does **not** discriminate — a revoked bot and a deleted one both answer `401 Unauthorized`, never 404. `getManagedBotToken` is the only discriminator between "repairable" and "gone".

### Role routing inside the coach bot

Resolve the incoming update's Telegram user id: workspace owner → coach experience; a client bound via invite → client experience; anyone else → a polite stub ("this is coach X's assistant, contact the coach") with **no onboarding path** — the invite stays the only door for clients.

### Branding

- Name and username are the coach's choice in the one-tap dialog. Avatar, description, and short description are set **programmatically at provisioning**. The avatar is the stage's single stored branding object in R2 (`DEFAULT_COACH_BOT_AVATAR_R2_KEY`), replaced by upload rather than by deploy ([#138](https://github.com/apshenichniy/praximo/issues/138)); a workspace that still carries its own avatar key keeps it, and any failure to install the picture — no object, an R2 error, an image Telegram refuses — costs the bot its photo but never the coach their onboarding. The description and short description are templated in English from the coach's own Telegram name.
- **Superseded by [#108](https://github.com/apshenichniy/praximo/issues/108)**: branding was originally taken from the workspace profile the admin filled in during manual onboarding, and admin profile updates reapplied avatar, description, and short description through the bot Worker's internal RPC. Admin-side branding editing — and that RPC path — are gone; the coach rebrands their own bot in @BotFather.

### Client-side experience

Clients interact with the coach-branded bot through plain messages plus tokenized web-room links. **No client-facing Mini App in MVP** — the Mini App (schedule, sessions/clients) is coach-only, attached to every coach bot via `setChatMenuButton` with the same TanStack Start URL; the workspace is resolved from `initData` (the bot id is available to the `validate3rd` auth path).

### Mini App entry points and the Main Mini App gap

Each bot can surface its Mini App two ways, both shown to the user as **"Open"** (the BotFather pattern):

- **In-chat menu button** (`setChatMenuButton`, `web_app`) — an ordinary Bot API call, set **programmatically** with the bot's token: on the manager bot at setup (`scripts/set-menu-button.ts`, [#80](https://github.com/apshenichniy/praximo/issues/80)) and on each coach bot at provisioning (step 3 above), labelled `"Open"`.
- **Chat-list "Open" button** (Telegram's *Main Mini App*) — as of **Bot API 10.2 (July 2026) there is no API to set it**; `has_main_web_app` is read-only in `getMe`, and the URL is configured **only in @BotFather, per bot, by the bot's owner**. Managed (coach) bots appear in the owner's @BotFather, so a coach *can* enable it — but the platform cannot do it for them.

Consequence for provisioning: the automated pipeline sets the **menu button** for every coach bot; the chat-list "Open" is **optional coach self-service** and onboarding is never blocked on it ([#86](https://github.com/apshenichniy/praximo/issues/86)) — the @BotFather steps to hand a coach who wants it are in the [coach onboarding runbook](../runbooks/coach-onboarding.md). For the platform-owned manager bot the operator enables the Main Mini App once, by hand ([#84](https://github.com/apshenichniy/praximo/issues/84)). This is a Telegram limitation, not deferred work.

### Explicitly skipped

- **Restricted-access mode** (Bot API 10.0 `BotAccessSettings`): onboarding is manual, a "private beta" state per coach bot buys nothing in MVP.

### Offboarding

On workspace deletion: `deleteWebhook`, wipe the token and the bot record. The bot itself remains the coach's property (in the Managed Bots model the coach is the owner) — we only release control. The operator flow lives in admin-surface.md §Delete flow; the [coach onboarding runbook](../runbooks/coach-onboarding.md) points at it from the coach's side.

## Consequences

- grammY (v1.45+, Bot API 10.x) with `webhookCallback(bot, "cloudflare-mod")` is the bot framework; pinned and upgraded deliberately.
- One-time manual prerequisite: create the manager bot and enable bot management for it in the @BotFather Mini App (`can_manage_bots`) — a coach-runbook / implementation-setup step, not IaC.
- Telegram messaging rate limits apply **per bot, i.e. per coach** — a scalability win that a shared bot would forfeit.
- Facts the research could not verify from primary sources (exact `KeyboardButtonRequestManagedBot` field list, `replaceManagedBotToken` parameters, any cap on bots per manager bot) are checked empirically during the bot Worker's implementation spike; none of them gate this decision.
- A coach switching between flows (paste → managed or back) is out of MVP; re-onboarding covers it manually.
- **Revisit:** the Main Mini App (chat-list "Open") has no programmatic setter (Bot API 10.2). Watch the [Bot API changelog](https://core.telegram.org/bots/api-changelog) ([#83](https://github.com/apshenichniy/praximo/issues/83)); if Telegram ships a setter, fold it into provisioning so coach bots get the chat-list "Open" automatically.
