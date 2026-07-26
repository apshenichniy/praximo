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

Until the Today dashboard ships, acceptance lands on the **client list**
([#56](https://github.com/apshenichniy/praximo/issues/56)) — deliberately not the manager
Mini App's onboarding companion, which lives under a different credential and answers a
different question. That home is, top to bottom: the re-link banner while the coach's bot is
down, the clients with «New client» as the list's own first row, and the optional @BotFather
hint last, under no heading of its own. The host's bottom button stays **empty** there: §Home
screen below has already promised it to «New session», and teaching a coach a control only to
move it is worse than not teaching it.

## Navigation model

Hub-and-spoke, no tab bar. One home dashboard; every other screen is a
drill-in with a back affordance. Screen inventory:

- **Home ("Today")** — the dashboard, described below.
- **Sessions list** — upcoming + past, flat, grouped by day.
- **Session detail** — client, time, lifecycle actions, artifact list.
- **Clients list** — all clients with invite status.
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

1. **Greeting** with today's session count.
2. **Next-session hero card**: client, kind, time, countdown; a "Brief ready —
   read before the session" chip when the Brief is `ready` (opens the reader),
   or a "Brief is being prepared" note while `generating`; the join button when
   the join window is open (T−15m per
   [web-room-sessions.md](web-room-sessions.md)), otherwise a "Session
   details" link.
3. **Needs attention**: artifact generation failures and pending invites, each
   row deep-linking to the relevant session or client. Empty section is hidden.
4. **Fresh artifacts feed**: latest post-session artifacts (Debrief / Mentor
   Review), newest first, each opening the reader.
5. **Bottom actions**: primary full-width **New session**; below it two
   secondary buttons — **All sessions** and **Clients**. Creation is the
   dominant affordance; navigation is secondary.

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
