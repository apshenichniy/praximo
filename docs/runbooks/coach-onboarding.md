# Runbook — Coach onboarding

Coach onboarding is **manual by design**: there is no self-registration
([README](../spec/README.md) §The product flow). The admin drives it from the
admin Mini App; everything after the coach's tap is automatic
([ADR 0004](../adr/0004-bot-per-coach-provisioning.md)). This runbook is the
operator's checklist for one coach, end to end, plus the one **optional** step
the coach can do for themselves afterwards.

Audience: the platform operator (admin). The only step that needs the coach at a
keyboard is the tap that creates their bot — and the optional Main Mini App step
below.

## Prerequisites

- The stage's manager bot (`PraximoMother`, dev instance suffixed) exists, has
  bot management enabled in the @BotFather Mini App (`can_manage_bots`), and its
  token is in `MANAGER_BOT_TOKEN` ([#84](https://github.com/apshenichniy/praximo/issues/84)).
- The stage is deployed and `COACH_MINI_APP_URL` points at its coach Mini App
  origin — this is the URL every coach bot's menu button will open.
- The operator's Telegram id carries the admin flag, so the `/admin` route opens
  ([admin-surface.md](../spec/admin-surface.md) §Admin identity and auth).

## 1. Invite the coach

In the admin Mini App, from the coaches list, tap the **Invite a coach**
MainButton. The screen collects one optional field — the internal label you know
the coach by — and offers three delivery actions (Telegram share, email, copy
the invite). Tapping one creates the workspace (`awaiting setup`) and the
single-use invite lazily and delivers in the same gesture; the pending card
appears in the coaches list
([admin-surface.md](../spec/admin-surface.md) §Invite a coach).

## 2. The coach connects their bot

The coach opens the link, which lands in the manager bot as `/start <code>`. The
manager bot reserves the invitation and offers a **Create coach bot** button
(Telegram's own managed-bot dialog, with a username suggested from the workspace
name). The coach picks the final name and username there; one tap is the whole
step.

Everything downstream is automatic — nothing here is an operator action:

- the bot's token is fetched and stored AES-GCM-encrypted;
- default Praximo branding (avatar, description, short description) is applied
  in the coach's language ([#108](https://github.com/apshenichniy/praximo/issues/108));
- the webhook is armed with a fresh per-bot secret;
- the **in-chat menu button** is set to a `web_app` button labelled **"Open"**,
  pointing at `COACH_MINI_APP_URL`;
- the workspace flips to `connected`, the invite is consumed, and the manager
  bot notifies the admin.

**Fallback — the coach already owns a bot.** Instead of tapping, the coach sends
that bot's @BotFather token as a private message to the manager bot. The message
is deleted, the token validated, and the coach proves ownership by opening the
candidate bot through a one-time confirmation link. From the proof on it is the
same pipeline, including the "Open" menu button
([#95](https://github.com/apshenichniy/praximo/issues/95), ADR 0004 §BotFather
token fallback). Both paths end in the same `connected` workspace and the same
admin notification.

## 3. Verify

- The workspace's bot connection status moves `awaiting setup` → **`connected`**,
  and the manager bot has sent the admin the "…is connected" notification.
- Opening the coach bot's chat shows the menu button labelled **"Open"**, and it
  launches the coach Mini App.

A partial failure (Telegram refused a configuration call) leaves the workspace
unconnected on purpose; the coach re-taps or re-sends the token and the same
installation resumes. There is no operator retry surface.

## 4. Optional — the coach enables the chat-list "Open"

**This step is optional and belongs to the coach. Onboarding is complete without
it: step 3 already reports `connected`, and the in-chat menu button is the entry
point the platform guarantees.**

Telegram has two "Open" surfaces per bot (ADR 0004 §Mini App entry points). The
platform sets the in-chat menu button at provisioning. The second one — the
**Main Mini App**, the "Open" button next to the bot in the chat list, the way
@BotFather itself opens — has **no Bot API setter** as of Bot API 10.2:
`has_main_web_app` is read-only in `getMe`, and the URL is configured only in
@BotFather, per bot, by the bot's **owner**. In the Managed Bots model the coach
is the owner, so their bot appears in their own @BotFather and only they can do
this ([#83](https://github.com/apshenichniy/praximo/issues/83) tracks a setter
should Telegram ever ship one).

What to tell a coach who wants it:

1. Open **@BotFather** → `/mybots` → pick your Praximo bot.
2. **Bot Settings → Configure Mini App → Enable Mini App**.
3. Paste the coach Mini App URL — the same address the in-chat **Open** button
   already uses (the stage's `COACH_MINI_APP_URL`, e.g. `https://stage.praximo.io/`).

The chat-list **Open** button then appears next to the bot. Both surfaces open
the same app under the same word; nothing else in the workspace changes, and
skipping this costs the coach only that shortcut.

## Offboarding

Deleting a workspace releases the bot: the webhook is removed and the token and
bot record are wiped, but the bot itself stays the coach's property — we only
give up control (ADR 0004 §Offboarding). The operator flow and its two-step
confirmation live in
[admin-surface.md](../spec/admin-surface.md) §Delete flow.
