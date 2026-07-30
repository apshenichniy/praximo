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

Before any screen below renders, the coach meets **two blocking steps and then one optional
one** — a state of the entry, deliberately not a route of its own, so there is no URL to
bookmark past it. Stepping back between the two blocking steps is the host's own back button,
which on this screen would otherwise close the app. Only the first two can hold a coach up:
the third is offered after acceptance and is one tap from gone.

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

**Step 3 — working hours, optional** ([#210](https://github.com/apshenichniy/praximo/issues/210)).
After acceptance, and only there, the coach is offered the hours they work: one window and
seven day chips, with **Skip** beside the host's bottom button. It is the one moment a coach
is setting the practice up rather than using it, and it is the only step of the three that
blocks nothing — Skip is a single tap, and the same control lives at `/availability` forever.
Skipping is not a failure state: nothing nags afterwards, and the step is deliberately not
restored on a later launch. A coach who closes the app on it meets Today next time and finds
the control where it permanently lives.

Past that step — taken or skipped — first login lands on **Today**
([#61](https://github.com/apshenichniy/praximo/issues/61)) — deliberately not the manager
Mini App's onboarding companion, which lives under a different credential and answers a
different question. Between #56 and #61 that landing was the client
list, which Today displaces; the list now has a route of its own at `/clients`.

## Navigation model

Hub-and-spoke, no tab bar. One home dashboard; every other screen is a
drill-in with a back affordance. Screen inventory:

- **Home ("Today")** — the dashboard, described below. Route `/`.
- **Sessions list** — upcoming + past, flat, grouped by day. Route `/sessions`. Grouping
  shipped with the list ([#61](https://github.com/apshenichniy/praximo/issues/61)) rather than
  after it: three to five sessions a day appear in the first week, and adding grouping to a
  flat list afterwards means rewriting it. **Past is not there yet** — no session can be
  `completed` before #42, and history on both this list and the client route is
  [#232](https://github.com/apshenichniy/praximo/issues/232), split out of #62 so the two
  lifecycle writes could ship without it.
- **Session detail** — client, time, lifecycle actions, artifact list. Route
  `/sessions/$sessionId`. #61 shipped it as a deliberate **stub** — the facts and no actions —
  so the list rows and Today's cards led somewhere complete-looking;
  [#62](https://github.com/apshenichniy/praximo/issues/62) made it the real screen. It states
  what became of a session only once something has — `completed`, or `cancelled` with its
  reason in words — by the same rule the invitation row follows: an ordinary session says
  nothing about itself, or the eye stops reading the line that matters. `scheduled` and
  `in_progress` are both silent, the second because a running session's story belongs to the
  room rather than to a past-tense line. The artifact list is #44's.
- **Clients list** — all clients with invite status. Route `/clients`.
- **Client detail** — profile (channel, language, consent), invite banner,
  session history.
- **Artifact reader** — full-screen render of one artifact version.
- **New session** — client picker + date/time. Route `/sessions/new`. Scheduling for a client
  the coach is *already looking at* skips the picker by naming them in the URL
  (`?client=`), so both entrances are the same route and the same screen. **Amended by
  [#186](https://github.com/apshenichniy/praximo/issues/186)**, which replaced #56's drawer:
  a sheet was local state, so Telegram's BackButton and a swipe down disagreed about what
  "back" meant, and a mis-swipe cost the whole draft. One screen from both entrances is what
  keeps duration and kind from drifting apart, and its month dots the days that already carry
  a session with the client being scheduled.
- **Reschedule** — route `/sessions/$sessionId/reschedule`
  ([#62](https://github.com/apshenichniy/praximo/issues/62)): the same scheduling screen,
  opened on a session that already exists. It asks for date, time and length and **not** for
  the kind — whether this is a client's first session is a fact about their history, not about
  the slot it is being moved into. Its own hour is not drawn as busy, or the commonest move
  there is — fifteen minutes later — would be refused by the screen the server would have
  accepted it from.
- **Main Mini App setup** — route `/main-mini-app`: the four @BotFather steps, this coach's own
  Mini App address, and the **Hide** control for the hint row on Today
  ([#61](https://github.com/apshenichniy/praximo/issues/61)). It exists because no Bot API can
  set the chat-list button (ADR 0004 §Mini App entry points).
- **Client route** — one client: header, invitation while unaccepted, upcoming
  sessions, profile, danger zone (#56). It arrives *before* the Today dashboard.
- **Availability** — route `/availability`
  ([#210](https://github.com/apshenichniy/praximo/issues/210)): when this coach is
  reachable. **Working hours** first, because every coach has them and they are already in
  force; the **calendar connection** second, because it is optional and may never be made.
  Both are about *time*, which is why they share a screen — grouping them is not the same as
  shipping them together, and the connection arrives with its own slice.
  - `/availability/hours` — one shared window and seven day chips. It **commits on change**,
    with no Save: the host's back control is permanent chrome, and pairing it with a Save
    button makes "tap back" a way to destroy an edit silently. Every change is one labelled
    tap, the line at the foot restates the result, and hours narrow the grid rather than the
    server — so a mis-tap can hide an option but never block a booking.
  - `/availability/hours/days` — the seven entries as rows, for a week that is not the same
    every day. A screen rather than a fold, because a picker opened inside seven rows wants
    more height than the phone has.

  Named for what it holds rather than «Settings»: a settings route would reopen the question
  §First login has already answered, which is that the onboarding chips are the only language
  control in MVP. Reached from Today as a row that **states the hours** rather than a third
  navigation button — three equal buttons would claim three equal errands, and this one is
  opened twice a year while All sessions and Clients are weekly.

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
   reads as a screen that failed to load — **except on an empty practice**, where the checklist
   below is the whole screen and «No sessions today» would be the first of the three ways of
   saying nothing that the checklist exists to replace.
3. **Today's sessions as cards**, grouped by time, each one tapping through to the session
   screen. A session whose client never accepted carries the state word, its consequence —
   «Invitation not accepted — N cannot get a link yet» — and the action that fixes it, in
   amber. Red belongs to the bot being down.
4. **Needs attention**, as amended above. Hidden when empty, and it never repeats a client
   whose card is already on the screen above: that card says it for today, the sessions list
   says it for the rest, and a third place would undo the point of rule two.
5. **Bottom navigation**: two quiet buttons — **All sessions** and **Clients**. They are
   navigation, not action.
6. **Availability**, as one row stating the hours — «Mon–Fri 09:00–19:00»
   ([#210](https://github.com/apshenichniy/praximo/issues/210)). A row rather than a third
   button: three equal buttons claim three equal errands, and the labels do not survive
   Ukrainian or Russian at a third of the row each. It earns its place on the days nobody
   presses it, by answering «what are my hours» without being opened — which is the question
   a coach has when the sheet stops offering Saturday.
7. **Main Mini App hint**, last: one row reading as its payoff — «Add an Open button to your
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
- **Reschedule** — mutates `scheduled_at` and the length in place; no history. Only a
  `scheduled` session moves: a running one is the room's, and a terminal one is a record.
- **Cancel** — coach cancellation (`coach_cancelled`), behind a confirmation, and **not in the
  danger zone** ([#62](https://github.com/apshenichniy/praximo/issues/62)). It is a routine
  part of running a practice — clients move, coaches fall ill — and spending the destructive
  heading on the commonest action there leaves none of its weight for Reset and Delete on the
  client route. Both actions are ordinary rows in a card of their own; the host's fixed bottom
  slot stays free for **Join**.
- **Both are silent to the client.** Nothing is sent on a move or a cancellation; the
  cancellation sheet says so where it asks, because that is the one of the two a coach cannot
  take back. Telling the client is still theirs to do. Reminders and re-delivery after a move
  are [#41](https://github.com/apshenichniy/praximo/issues/41)'s.
- **Join** — visible only while the join window is open.
- **Reissue join links** — token rotation per
  [client-onboarding-auth.md](client-onboarding-auth.md) §Web-room access.
- **No manual no-show.** The ticket's original "mark no-show" action is
  obsolete: terminal states are written only by the reconciler
  ([ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md)); the UI
  shows an automatic cancellation with its reason.

## Theme

Coach follows its Telegram presentation host. The host adapter owns theme
subscription, safe-area values, Back/Main Button integration, host chrome, and
feedback. Feature code and shared primitives call no raw Telegram API. Local
browser preview falls back to `prefers-color-scheme` and uses safe no-op host
capabilities while retaining the real signed development authentication flow.

The first paint is settled before the body appears: the Coach App head bootstrap
derives the Telegram launch scheme when present and otherwise uses the system
preference. The shared light/dark palette and status families come only from
`@praximo/ui/styles.css`.

Status is named by meaning: `success`, `warning`, `error`, and `info`
each own base, foreground, surface, and border tokens. `destructive` remains
an action semantic.

### Where a dangerous question is asked

Every confirmation arrives from the bottom of the screen through the shared
confirmation primitive. A destructive confirmation makes Cancel the large,
comfortable target and the destructive action the quiet action beneath it.
Merely lossy actions may keep their action primary. Arming behavior remains
feature-owned: deleting a Workspace may count down; resetting an Invite must not
inherit that cost.

## Motion

`@praximo/ui` owns the motion foundation. #215 starts from clean Maia
components and audits them before adding movement.

- Prefer CSS and `data-state` transitions for primitive state changes.
- Animate named `transform` and `opacity` properties; never
  `transition-all`.
- One action gets one animation. High-frequency choices do not receive entrance
  motion, lists do not stagger, and screens do not mount with decorative motion
  by default.
- Add a motion library only when a proven interruptible layout or screen
  transition needs one.
- Tune committed durations and easings in UI Lab and on a real device.

### Haptics and feedback

The semantic intent survives the visual reset:

| Event | Feedback |
| --- | --- |
| One value in a set replaces another | selection |
| A control opens or closes a surface | light impact |
| A mutation succeeds | success notification |
| A mutation is refused | error notification |

The Coach presentation-host adapter maps these semantics to Telegram
`HapticFeedback`. Browser preview and non-Telegram consumers use the shared
no-op adapter. One action produces at most one haptic; system events and
navigation do not tick. Mutation outcomes remain in feature code.

Shared interactive primitives emit only host-neutral press/open/selection
feedback. An application wrapper is justified only when its API or composition
differs, not merely because its host side effect differs.

### Reduced motion

`prefers-reduced-motion` removes transform and size movement while preserving
state, opacity, focus, and color meaning. JavaScript-driven paths query the
shared reduced-motion helper. Haptics remain available because they are feedback,
not visual movement.

## Typography

`@praximo/ui` owns interface typography. The semantic roles are `display`,
`page-title`, `section-title`, `card-title`, `body`, `body-small`,
`label`, and `caption`; `mono` is a family modifier.

Each recipe owns family, size, line height, weight, and tracking. Tone remains
independent. Shared `Heading` and `Text` primitives keep semantic HTML
independent from visual role, and shadcn component slots consume the same
recipes. Callers do not reconstruct recipe typography in `className`.

The old private `--text-*` namespace, `text-body`-style utilities,
arbitrary interface sizes, and custom `tailwind-merge` extension are retired.
Inter is the interface face and Geist Mono is the transcription/code/value face.
UI Lab, not the old scale, is where the new values are tuned in Latin and
Cyrillic across mobile/desktop widths and both themes.
