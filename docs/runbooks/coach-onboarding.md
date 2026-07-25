# Runbook — Coach onboarding

Coach onboarding is **manual by design**: there is no self-registration
([README](../spec/README.md) §The product flow, end to end). The admin drives it from the
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
  **Verify it rather than assume it** — `bun run manager-bot:set-menu <web-origin>`
  reports both manual @BotFather flags. With bot management off the coach's tap
  cannot produce a bot, and nothing fails server-side — the attempt simply sits at
  `requested` waiting for a `managed_bot` update Telegram never sends — so the only
  other way to notice is a phone.
- The stage is deployed and `COACH_MINI_APP_URL` points at its coach Mini App
  origin — this is the URL every coach bot's menu button will open.
- The operator's Telegram id carries the admin flag, so the `/admin` route opens
  ([admin-surface.md](../spec/admin-surface.md) §Admin identity and auth).

## 1. Invite the coach

In the admin Mini App, from the coaches list, tap the **Invite a coach**
MainButton. The screen collects one optional field — the internal label you know
the coach by. Delivering creates the workspace (`awaiting setup`) and the
single-use invite lazily, in the same gesture; the pending card then appears in
the coaches list ([admin-surface.md](../spec/admin-surface.md) §Invite a coach).

Two channels work in MVP: **Send in Telegram** (native chat picker; the
recipient is never revealed to the bot) and **Copy invite** (the forwardable
message with the deep link, for any other channel). **Send by email is a UI stub
in MVP** — it answers "coming soon" and creates nothing, so it cannot be used to
onboard anyone until delivery lands
([#105](https://github.com/apshenichniy/praximo/issues/105),
[#114](https://github.com/apshenichniy/praximo/issues/114)).

## 2. The coach connects their bot

The coach opens the link, which lands in the manager bot as `/start <code>`. The
manager bot reserves the invitation and sends one message with a **Create coach
bot** button on it — an inline link into Telegram's own managed-bot dialog, with a
username suggested from the workspace name. The coach picks the final name and
username there; one tap is the whole step.

The suggestion carries a short tag, so "Ada Coaching" is offered as
`ada_coaching_3pue_bot` rather than `ada_coaching_bot`: without it a plausible
short name is almost always one somebody registered years ago, and the coach
would have to think up a replacement inside Telegram's dialog
([#147](https://github.com/apshenichniy/praximo/issues/147)). The tag is derived
from the workspace, so reopening the link offers the same username again. It is a
suggestion either way — a coach who wants a different one just edits the field.

> **The button is a `t.me/newbot/…` deep link, on iPhone and on Desktop alike**
> ([#134](https://github.com/apshenichniy/praximo/issues/134)). The
> `request_managed_bot` **reply-keyboard** button this replaced never worked on
> Telegram iOS — the tap became a share sheet that never completed — so if you are
> reading an older transcript that says to use the token path from a phone, that
> workaround is no longer needed.

**Exactly one of those buttons is ever live.** A coach who reopens their link
gets a fresh message, and the previous one loses its button as the new one is
sent; once the bot is connected, the message the coach tapped is edited in place
into a confirmation naming the bot, and no armed button is left anywhere in the
chat. Two things follow for the operator:

- A prompt that still carries a button after a coach reports being stuck means
  provisioning did **not** complete — that is the resume path, and tapping it
  again is the right advice.
- A message the coach deleted, or one older than Telegram's 48-hour edit window,
  cannot be edited. Provisioning succeeds regardless and logs a warning naming the
  message; the coach may simply keep a stale-looking button, which the claim fence
  refuses anyway ([#135](https://github.com/apshenichniy/praximo/issues/135)).

Everything downstream is automatic — nothing here is an operator action:

- the bot's token is fetched and stored AES-GCM-encrypted;
- default Praximo branding is applied — the stage's stored branding image from
  R2, plus an English description and short description templated from the
  coach's own Telegram name. The text is a pure function of its seed, so a retry
  reproduces it exactly; the picture is whatever the key holds **at that moment**,
  so a re-provisioning after the image was replaced installs the new one
  ([#108](https://github.com/apshenichniy/praximo/issues/108),
  [#138](https://github.com/apshenichniy/praximo/issues/138)). Provisioning always
  sets the photo, so a coach who rebranded in @BotFather and is then re-provisioned
  gets the platform image back — rebranding is coach-side and is theirs to redo.
  **To change the picture every future coach bot starts with**, upload a new one —
  no code change, no deploy:

  ```sh
  bun run branding:avatar:set --stage dev_apshenichniy --file ./avatar.png \
    --key branding/default-coach-avatar.jpg
  ```

  Any JPEG/PNG/WebP/SVG source is normalized to the square 512×512 JPEG the key
  must hold, and only that key is replaced. The photo step is best-effort end to
  end: a stage that never uploaded an image, an R2 error, or an object Telegram
  refuses all leave the bot without a photo and a warning in the Worker log
  naming the key — never a coach who cannot finish onboarding;
- the webhook is armed with a fresh per-bot secret;
- the **in-chat menu button** is set to a `web_app` button labelled **"Open"**,
  pointing at `COACH_MINI_APP_URL`;
- the workspace flips to `connected`, the invite is consumed, and the manager
  bot notifies the admin.

**What the coach sees is one message.** Telegram's dialog ends with a **Start bot**
button, so they tap it while the steps above are still running. The bot answers
immediately — *"Настраиваю вашего бота — это займёт несколько секунд"*, in their
language — and when activation completes **that same message becomes** *"Praximo
готов"* with the **Open** button
([#154](https://github.com/apshenichniy/praximo/issues/154)). One tap, no silence,
and no second greeting: the early `/start` is dropped from Telegram's queue
because it has already been answered. If the log says an announcement was
**undelivered**, the coach may see the greeting as a separate message instead of
an edit — cosmetic, and they are still greeted.

A coach who has *not* opened the bot gets nothing at that point, by design —
Telegram refuses a message to a user who never started the bot, which is exactly
how the platform learns they are not there. Their later `/start` is greeted
normally.

The webhook is armed **last**, after the workspace flips to `connected`
([#150](https://github.com/apshenichniy/praximo/issues/150)), so no update can
reach the bot's route before the row that serves it exists. Two operator
consequences:

- If a coach reports that **Start did nothing**, check the Worker log for the bot
  id. Every refusal on a coach bot's route now logs — no installation, no
  candidate, secret mismatch, or an attempt still configuring — so the reason is
  one `grep` away rather than a reconstruction from database timestamps.
  **`alchemy logs` cannot read them yet**: the observability telemetry query
  answers `403` while the rest of the token works, so the account API token is
  missing its Workers Observability permission group. Adding it is a dashboard
  action on a dashboard-minted token — ADR 0003's human carve-out.
- A failure at the arming step leaves a workspace **`connected` with a bot that
  hears nothing**. Telegram repeats the `managed_bot` update and the retry
  re-arms, so it normally heals itself; if a coach's bot stays mute while the
  admin surface says `connected`, that is the shape to suspect, and re-running
  provisioning is the repair. Two log lines tell the two cases apart: *no
  installation* means the row is missing, while **`webhook secret does not match`
  means the bot is delivering and being refused** — its stored secret and the one
  Telegram presents have diverged, and only re-provisioning re-aligns them.

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

**A coach who ends up with two bots.** Tapping the creation entry point a second
time makes Telegram create a second bot, and by then the coach has no open
attempt left, so the platform does not connect it
([#135](https://github.com/apshenichniy/praximo/issues/135)). Nothing is broken:
the first bot stays connected and the workspace is untouched. The manager bot
tells the coach so, names the unconnected bot, and offers @BotFather removal as
optional — bots cannot delete bots, so only the coach can. Nothing is required
of the operator, and nothing appears in the admin surface.

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
   already uses, **including its `?b=` parameter**, e.g.
   `https://stage.praximo.io/?b=9100777`.

The parameter is per bot: it names which bot the launch came from, so the app can
verify the launch signature against that bot before it reads anything (ADR 0006).
Only the app knows the number, so the coach's own home screen displays the exact
URL to paste. A URL pasted without it still works — the app falls back to
resolving the launch by the coach's Telegram identity — but paste the full one.

The chat-list **Open** button then appears next to the bot. Both surfaces open
the same app under the same word; nothing else in the workspace changes, and
skipping this costs the coach only that shortcut.

## Offboarding

Deleting a workspace releases the bot: the webhook is removed and the token and
bot record are wiped, but the bot itself stays the coach's property — we only
give up control (ADR 0004 §Offboarding). The operator flow and its two-step
confirmation live in
[admin-surface.md](../spec/admin-surface.md) §Delete flow.
