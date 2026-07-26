# Mini App — Screens and Navigation (MVP)

The coach's minimal Telegram Mini App: schedule, sessions, clients. Same
TanStack Start app as the web UI. Decided in wayfinder ticket
[#15](https://github.com/apshenichniy/praximo/issues/15) by prototyping three
structurally different variants (`prototypes/mini-app-screens`); the
hub-and-spoke "Today" variant won. Vocabulary follows
[CONTEXT.md](../../CONTEXT.md); entity semantics follow
[domain-model.md](domain-model.md).

The Mini App opens **fullscreen** (Bot API 8.0 `Telegram.WebApp.requestFullscreen()`, with `fullscreenChanged` handling and safe-area insets in the layout) — decided in
[#14](https://github.com/apshenichniy/praximo/issues/14).

Vertical swipes inside the webview are **disabled** (Bot API 7.7
`Telegram.WebApp.disableVerticalSwipes()`, called during host initialization before
`ready()`), so swiping page content never minimizes the shell — BotFather-style. Telegram's
native header stays available to minimize or close the Mini App; that host affordance is not
(and cannot be) overridden. Pre-7.7 clients keep the default swipe behavior.

The coach reaches the app from **their coach bot**, shown as **"Open"** — the in-chat
menu button (set at provisioning, [ADR 0004](../adr/0004-bot-per-coach-provisioning.md),
[#86](https://github.com/apshenichniy/praximo/issues/86)) and, if the coach enables it in
@BotFather, the chat-list Main Mini App "Open" button. The menu button is always present; the
Main Mini App is optional coach self-service, since no Bot API can set it (ADR 0004 §Mini App
entry points) — the @BotFather steps live in the
[coach onboarding runbook](../runbooks/coach-onboarding.md). This mirrors the admin's two
"Open" surfaces on the manager bot ([admin-surface.md](admin-surface.md) §Entry points).

## First login

Before any screen below renders, the coach meets a **blocking two-step onboarding** — a
state of the entry, deliberately not a route of its own, so there is no URL to bookmark past
it. Stepping back between the two is the host's own back button, which on this screen would
otherwise close the app.

**Step 1 — language.** Praximo introduces itself and states, in the first person and in the
language currently selected, what that selection means: *"I will write to you in **English** —
here and in your bot."* Three chips sit under that sentence, each language named in its own
tongue, pre-selected from what the invite claim seeded out of the coach's Telegram client
([#130](https://github.com/apshenichniy/praximo/issues/130)). Tapping one re-renders the
introduction in it — the sentence is the control's label, not a caption beside it, because
this choice governs the **bot** as well as the app, and a switcher on a page of legal text
reads as "translate this page". Continuing writes `member.language`, the one column every
coach-facing surface reads. It is the only language control in MVP; a settings screen for
changing it later is not part of it.

**Step 2 — the terms**, in the language just settled. A short summary of what the coach is
agreeing to, links to the full terms and the privacy policy as in-app routes (an external
link would eject them from the Mini App mid-acceptance) carrying that language, and the
host's own bottom button as the single action. There is no Decline control — closing the
Mini App is the refusal.

Acceptance records the fact and the text version on Member, and notifies the invite issuer
that onboarding is complete. The version identifies the *document*, not the rendering: the
three languages are structurally identical translations of one text under one version, so
changing language afterwards never asks for re-acceptance. Every coach operation other than
acceptance itself is refused until it lands. Authentication mechanics are in
[client-onboarding-auth.md](client-onboarding-auth.md) §Coach authentication and
[ADR 0006](../adr/0006-coach-authentication-in-mvp.md).

Acceptance lands on **Today** ([#61](https://github.com/apshenichniy/praximo/issues/61)) —
deliberately not the manager Mini App's onboarding companion, which lives under a different
credential and answers a different question. Between #56 and #61 that landing was the client
list, which Today displaces; the list now has a route of its own at `/clients`.

## Navigation model

Hub-and-spoke, no tab bar. One home dashboard; every other screen is a
drill-in with a back affordance. Screen inventory:

- **Home ("Today")** — the dashboard, described below. Route `/`.
- **Sessions list** — upcoming + past, flat, grouped by day. Route `/sessions`. Grouping
  shipped with the list ([#61](https://github.com/apshenichniy/praximo/issues/61)) rather than
  after it: three to five sessions a day appear in the first week, and adding grouping to a
  flat list afterwards means rewriting it. **Past is not there yet** — no session can be
  `completed` before #42, so #62 brings history with the rest of the session screen.
- **Session detail** — client, time, lifecycle actions, artifact list. Route
  `/sessions/$sessionId`. #61 ships it as a deliberate **stub** — the facts and no actions — so
  the list rows and Today's cards lead somewhere complete-looking; #62 is the named creditor.
- **Clients list** — all clients with invite status. Route `/clients`.
- **Client detail** — profile (channel, language, consent), invite banner,
  session history.
- **Artifact reader** — full-screen render of one artifact version.
- **New session** — client picker + date/time. Scheduling for a client the coach
  is *already looking at* does not go through it: that is a sheet on the client
  route ([#56](https://github.com/apshenichniy/praximo/issues/56)). This screen
  arrives with Today, for the case where the client still has to be chosen.
- **Client route** — one client: header, invitation while unaccepted, upcoming
  sessions, profile, danger zone (#56). It arrives *before* the Today dashboard.

## Home screen, top to bottom

Amended by [#61](https://github.com/apshenichniy/praximo/issues/61), which built it. Two
changes, both the owner's call over the shape sketched here:

- **A set of cards for the day, not a hero plus a folded-away line.** A set of cards is what a
  person expects from a day and reads without instruction; «and 3 more» on a four-row
  dashboard is economy for its own sake. A solo coach rarely has more than five sessions in a
  day, so all of them are shown, unclipped.
- **Needs attention carries invitations only, and only the urgent ones** — expiring within two
  days, or already lapsed. *Every* pending invitation would make this the biggest section on a
  fresh practice and a duplicate of the clients list wearing the word «attention»: a coach who
  has just invited five people would be looking at a list of problems.

Ordered by how often each thing is needed:

1. **Re-link banner** while the coach's bot is down
   ([#55](https://github.com/apshenichniy/praximo/issues/55)) — first, destructive-toned,
   never dismissible.
2. **Greeting**: the coach's name and one factual line — «Two sessions today» / «No sessions
   today». No time-of-day greeting, and no greeting *word*: it would want the vocative in
   Ukrainian and no column holds a declined form. The zero is spoken, because silence about it
   reads as a screen that failed to load.
3. **Today's sessions as cards**, grouped by time, each one tapping through to the session
   screen. A session whose client never accepted carries the state word, its consequence —
   «Invitation not accepted — N cannot get a link yet» — and the action that fixes it, in
   amber. Red belongs to the bot being down.
4. **Needs attention**, as amended above. Hidden when empty.
5. **Bottom navigation**: two quiet buttons — **All sessions** and **Clients**. They are
   navigation, not action.
6. **Main Mini App hint**, last: one row reading as its payoff — «Add an Open button to your
   chat list · Optional · 4 steps in @BotFather» — opening a screen that carries the steps, the
   per-bot address and **Hide**. Today itself carries no dismiss control: a row a coach can put
   away from the dashboard is a row they put away without reading, and `has_main_web_app`
   already dismisses it for everybody who did the steps.

The host's bottom button is **New session** — on an empty practice it reads **New client**
instead, because New session there opens a client picker with nothing in it.

**On an empty practice Today shows a three-step checklist** instead of three ways of looking
at nothing: *Your bot is live* (already ticked — the coach finished it a minute ago, and a
checklist that opens at zero reads as work waiting rather than work done), *Add your first
client*, *Schedule the intake*. It disappears entirely once a client exists rather than
becoming a list of ticks.

Three of the blocks this section originally listed are **absent rather than present-and-empty**
until the tickets that fill them ship: the fresh-artifacts feed and artifact generation
failures ([#44](https://github.com/apshenichniy/praximo/issues/44)), and the join button
([#42](https://github.com/apshenichniy/praximo/issues/42)). A section that exists and is always
empty promises something the coach then hunts for; a greyed-out Join is a promise we cannot
keep for two more tickets. When they ship, they take their places above: the feed after needs
attention, the join button on the session card whose window is open.

## Artifacts relative to bot messages

The bot remains the delivery channel (artifacts arrive as bot messages, per
the pipeline ADR); the Mini App is the **archive and reading surface**. Every
artifact row shows its version and a "delivered by the bot" note; the reader
offers "Open in chat" as its only action.

**No "Regenerate" button in MVP.** A visible regenerate control invites
aimless taps and unbounded LLM spend. Regeneration stays a system capability
(artifacts are versioned, per [domain-model.md](domain-model.md)) without a
user-facing button; if a real need emerges post-MVP it returns as a deliberate,
possibly rate-limited action.

Artifact statuses render as: `ready` (openable, versioned), `generating`
("being prepared"), `failed` (surfaced in Needs attention), `skipped` (Brief
for a first session: "no history yet").

## Session lifecycle actions in the UI

- **Schedule** — the New session screen (client + date/time). Clients with a
  pending invite are schedulable (consent blocks only after revocation, per
  [client-onboarding-auth.md](client-onboarding-auth.md)).
- **Reschedule** — mutates `scheduled_at` in place; no history.
- **Cancel** — coach cancellation (`coach_cancelled`).
- **Join** — visible only while the join window is open.
- **Reissue join links** — token rotation per
  [client-onboarding-auth.md](client-onboarding-auth.md) §Web-room access.
- **No manual no-show.** The ticket's original "mark no-show" action is
  obsolete: terminal states are written only by the reconciler
  ([ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md)); the UI
  shows an automatic cancellation with its reason.
