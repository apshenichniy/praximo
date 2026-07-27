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
- **New session** — client picker + date/time. Route `/sessions/new`. Scheduling for a client
  the coach is *already looking at* does not go through it: that is a sheet on the client
  route ([#56](https://github.com/apshenichniy/praximo/issues/56)). This screen
  arrives with Today, for the case where the client still has to be chosen. The sheet is the
  same component from both entrances, so duration and kind cannot drift apart, and its month
  dots the days that already carry a session with the client being scheduled.
- **Main Mini App setup** — route `/main-mini-app`: the four @BotFather steps, this coach's own
  Mini App address, and the **Hide** control for the hint row on Today
  ([#61](https://github.com/apshenichniy/praximo/issues/61)). It exists because no Bot API can
  set the chat-list button (ADR 0004 §Mini App entry points).
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

## Theme

The app is in whatever scheme its host is in. Decided in
[#190](https://github.com/apshenichniy/praximo/issues/190), which replaced a
dark-only app: a coach who reads their phone in light mode used to meet one black
rectangle inside a white client, and the Mini App was the only surface on their
phone ignoring a setting they had made.

`Telegram.WebApp.colorScheme` is the answer while the app runs, and the
`themeChanged` event is how it moves — a coach can flip the setting, or their
phone can cross into night, with the app still on screen. Outside a Telegram
launch (a client's browser on the acceptance page, local development) the
browser's own `prefers-color-scheme` stands in for both.

**The first paint is settled before it happens.** The scheme is not knowable on
the server — Telegram publishes it as `tgWebAppThemeParams` in the URL *hash*,
which no request carries — so the document is rendered scheme-less and a blocking
script in `<head>` (`COLOR_SCHEME_BOOTSTRAP` in `apps/web/src/lib/theme.ts`) puts
the class on ahead of the body. Reading the launch's `bg_color` luminance is the
same derivation Telegram's own SDK makes; the critical stylesheet carries both
grounds, because which one it will be is unknown a few bytes earlier.

**Three surfaces answer to a change, and only one is CSS.** The `dark` class on
`<html>` carries the palette. The Telegram chrome — header, webview background,
bottom bar — and the host's own bottom button are painted through bridge calls,
because a page stylesheet does not reach them. `TelegramTheme`, mounted once in
the root shell, keeps all three in step.

**Status is named by meaning, never by hue.** `--success`, `--warning`, `--info`
and the preset's own `--destructive` carry one value per scheme — Tailwind's 300s
on the dark ground, its 600s on the light one. A screen that said
`text-emerald-300` was stating a shade chosen for near-black, and on white the
same shade is a tint rather than a word; `src/__tests__/global-theme.test.tsx`
fails on one reappearing anywhere in `src`.

### Surfaces

**Three, not one** ([#195](https://github.com/apshenichniy/praximo/issues/195)).
The page, the raised surface (card, popover, sheet) and the recessed fill are
distinct grounds, and they have to be distinct in *both* schemes: elevation needs
something to be elevated against. The light ground first shipped with all three
at pure white, and a bottom sheet opened over a screen simply was not there — it
read as the page growing some buttons.

On light the page recedes and the raised surfaces keep the white, which is the
direction light interfaces run in; on dark the page is the darkest and raised
surfaces lift off it. The steps are the same size in both — page→card 1.14:1
dark against 1.11:1 light, card→recessed 1.17:1 in both — so a screen designed in
one scheme keeps its structure in the other.

`src/__tests__/theme-contrast.test.ts` reads the two blocks out of `app.css` and
asserts the steps, the hairline against both of its grounds, and the text
parity. None of these are visible in a diff: the miss that prompted this was one
token copied from the registry.

A **backdrop is not a substitute for a surface.** The drawer has always had one —
`modal` defaults to `true`, and it paints a scrim with a blur — and the sheet was
still invisible, because the scrim separates the sheet from the *content* behind
it, not from the ground it is drawn on. Two more things the sheet needs and now
has: a border of `--border` rather than of its own fill, and its shadow cast
**upward**. Every Tailwind `shadow-*` falls downward, which on a sheet pinned to
the bottom of the screen puts the whole shadow off-screen and leaves the one edge
anybody sees with nothing under it.

The BotFather splash screen stays dark. It is configured outside this repository
and Telegram takes one colour there, not a pair.

## Motion

Decided in #186, after walking the scheduling flow on a phone. The rules are
here rather than in each component because motion is the one thing that reads as
*one app* or as several: a new screen that invents its own timings is what makes
a product feel assembled rather than made.

### Tokens

Four durations and three curves, in `apps/web/src/styles/app.css`. A number
chosen at a call site is a number that drifts from the one beside it.

| Token | Value | For |
| --- | --- | --- |
| `--duration-press` | 120ms | the answer to a press; the colour of the thing just chosen |
| `--duration-swap` | 180ms | one state replacing another inside a section |
| `--duration-move` | 250ms | something that travels or changes size on screen |
| `--duration-screen` | 320ms | one screen replacing another |

| Curve | Value | For |
| --- | --- | --- |
| `--ease-out-strong` | `cubic-bezier(0.23, 1, 0.32, 1)` | entering, leaving |
| `--ease-in-out-strong` | `cubic-bezier(0.77, 0, 0.175, 1)` | moving while staying |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | the host's own popup feel |

`ease-in` is never used. It withholds movement exactly when the coach is looking
hardest, which reads as the app being slow rather than as the animation being
gentle. The built-in `ease-out` is too weak to read as deliberate at these
durations — hence the strong variants.

### What may animate

By how often a coach sees it, not by how good it would look:

| Frequency | Allowed |
| --- | --- |
| Tens of times per booking — a slot, a day, a chip | press `scale(0.97)` and colour, `--duration-press`. No entrances, no travel |
| Once or twice per booking — the day changed, the month opened | one movement, `--duration-swap`/`--duration-move` |
| Once per entry — a screen, a list | `--duration-screen`; the screen transition is the entrance |
| Rarely — booked, refused | say it with a haptic, not with a longer animation |

**One action, one animation.** Tapping a day changes the strip *and* the slot
grid; the grid animates and the strip stays put. Ignoring this is what produced
#186's original defect — a single tap moving the layout three times.

**No staggered lists.** Rows arriving one after another put a second animation on
top of the screen transition that brought them, which is the same rule again — and
on a phone it reads as a wave running down the list. It was tried on the client
picker and removed: that screen is on the way to every booking, so its list is
something a coach scans, not something introduced to them. A stagger would need a
list seen once ever, and this app does not have one.

Only `transform` and `opacity`, which skip layout and paint. `transition-all` is
never written; properties are always named. The exception on the record is the
month's fold, which animates `height` because `grid-template-rows` does not
animate in the WebView Telegram runs on iOS — measured by a `ResizeObserver`, and
documented at the call site.

No springs and no bounce while there is no interruptible gesture in the app: a
spring earns its keep when a finger can change its mind mid-flight, and pays for
itself in nothing otherwise. No animated numbers or counters. No skeleton more
elaborate than a pulse. At most two things moving in a frame.

### Haptics

The host's `HapticFeedback` (Bot API 6.1) through
`features/mini-app/haptics.ts`, which is a no-op on Desktop and on older
clients. On a phone this carries more than any curve, and it is the feedback
that survives a coach turning animations off.

| Event | Call |
| --- | --- |
| One value in a set replacing another: kind, duration, day, slot | `selectionHaptic()` |
| A control that opens or closes something: «Month», «Today» | `impactHaptic("light")` |
| A surface arriving over the screen: a sheet, a confirmation, the host's picker | `useOpenHaptic(open)`, or `impactHaptic()` beside the call that summons it |
| The session was booked | `notifyHaptic("success")` |
| The server refused it | `notifyHaptic("error")` |

Fired on the press, not on the answer — the two exceptions are the outcomes,
which *are* answers. One haptic per action, never for a system event (a fetch
resolving, a prefetch arriving, the strip scrolling itself), and never for a tap
that chose what was already chosen.

### Where the feedback lives

Applying this contract screen by screen is a plan checked by memory, so it is
applied by *kind of thing* instead — and each kind is found by one command:

| Kind | Found by | Where it is implemented |
| --- | --- | --- |
| Anything pressable | `<Button>`, `<button>`, `<Link>` | `ui/button.tsx` for the forty-five buttons; the `pressable-row` utility for full-width rows |
| One value replacing another | `aria-pressed` | `ui/toggle.tsx` covers both chip sets; hand-rolled chips call `selectionHaptic()` themselves |
| An action with an outcome | `acceptOnce(`, `useMutation(` | `notifyHaptic()` on both branches, beside the branch |
| A surface opening over the screen | `Drawer`, `AlertDialog`, `shareMessage` | `useOpenHaptic(open)` inside the surface; the picker's tap says it itself |
| Navigation | — | view transitions, nothing per screen |

**Navigation does not tick.** A row that opens a screen lights up and says
nothing: the platform reserves the Taptic Engine for choices, outcomes and
gestures, and a tick on every tap becomes background — which costs the ticks
that matter their meaning. This is why the scheduling screen buzzes and the
lists do not: one is made of choices, the other of journeys.

Rows take their press as a wash of colour rather than the 0.97 a chip takes:
scaling something the width of the screen reads as the page flexing, and the
platform's own lists light up. That is what `pressable-row` is.

The wash is **ink, not a colour** ([#196](https://github.com/apshenichniy/praximo/issues/196)):
`--pressed` is black or white at a low alpha, so it darkens whatever surface it
is pressed on and reads the same on a card, on the page and inside a sheet. It
was an opaque `bg-accent/70`, picked when the page was white — and when the page
receded to make room for elevation (§Surfaces), that value came to rest on the
page's own colour. A pressed row stopped reading as pressed and started reading
as a hole cut through the card. An absolute colour cannot express a relative
state; the contrast test now asserts the press against both its own surface and
the ground behind it.

The last two rows of that table are invariants, and
`src/__tests__/feedback-invariants.test.ts` holds them: a file that mutates says
how it went, a file with `aria-pressed` ticks. A hook may hand its outcome out
as a value instead — `useInviteShare` does, because only the screen knows what
«dismissed» means there — and says so in a comment the test reads. Neither check
can tell a right haptic from a wrong one; that is what the phone is for.

### Reduced motion

`prefers-reduced-motion` removes movement, not meaning: opacity and colour stay,
`transform` and size changes go, and JavaScript paths ask
`prefersReducedMotion()` from `lib/motion.ts` — the strip's scroll jumps instead
of gliding. Haptics stay: for a coach who has turned animation off, the tick is
what is left.

### Libraries

CSS first, because CSS animations run off the main thread and keep their frames
while the app is fetching and rendering. `@starting-style` for entrances,
`tw-animate-css` for fades and slides, View Transitions for routes, JavaScript
only for scroll position and haptics. A motion library is worth its bundle when —
and not before — the app grows a gesture that can be interrupted mid-flight
(swipe-to-cancel on a session, drag-to-reschedule); the first candidate then is
`motion/mini`, on the Web Animations API, not the full package.

## Typography

Decided in #186, on a phone, for the same reason as §Motion: what was there had
accumulated rather than been chosen. Eight sizes were crowded into the seven
pixels between 10 and 17, half of them written as one-off `text-[13px]`s, and the
smallest of them — the one carrying every field label — sat below the 11pt that
is the smallest style Apple itself ships.

### The scale

Seven steps, in `apps/web/src/styles/app.css`. Tailwind's own `--text-*`
namespace is switched **off**, so this is the only scale there is: `text-sm` and
friends do not exist here.

| Step | Size | Line | For |
| --- | --- | --- | --- |
| `text-caption` | 12px | 16 | labels, counts, state words |
| `text-footnote` | 13px | 18 | descriptions, leads |
| `text-body` | 15px | 21 | running text, buttons, slots |
| `text-emphasis` | 17px | 23 | card titles, the line that matters |
| `text-heading` | 20px | 26 | dialog and section headings |
| `text-title` | 24px | 30 | screen titles |
| `text-display` | 30px | 34 | the one number a screen is about |

Two numbers deserve their reasons. **The floor is 12px** because a native app's
11pt is not our 11px: the scale was set against Nunito Sans, which had neither SF
Pro's x-height nor its optical sizing, and 12 was where that face started being
read rather than decoded. **Body is 15px, not 14**, which is the single change
with the widest reach — it is the size of nearly every sentence, button and slot
in the app.

### The face

**Inter**, in the `opsz` build ([#194](https://github.com/apshenichniy/praximo/issues/194)),
replacing Nunito Sans. Nunito is a rounded, low-contrast face built for warmth,
and it spends that warmth on the two things this app asks of type most often:
holding 12px labels and holding secondary greys. It was the light scheme that
made this visible — the same strings that read on near-black went thin and
papery on white — but the weakness was there in both.

Inter was drawn for screens at UI sizes and brings the x-height Nunito lacked.
The `opsz` axis (14–32) is why the optical-size build is imported rather than the
weight-only one: with `font-optical-sizing: auto`, a caption gets the wide, open
text cut and a screen title gets the tight display one, with no screen asking.
It costs about 35 KB more across the two subsets served, once, cached.

The seven steps are **unchanged** by the swap. Inter's larger x-height means the
floor now has headroom it did not have, so retuning the scale down is available —
but that is its own decision, taken by looking, not a side effect of changing the
face.

Running text is **450, not 400, in the light scheme only** — light type on a dark
ground blooms, so a weight settled in the dark comes out a half step thin the
moment the ground flips. It sits in Tailwind's `base` layer, so every explicit
`font-medium` and `font-semibold` still wins, and the places that say
`font-normal` to mean *de-emphasised* keep saying it.

Font smoothing is deliberately **unset**. `-webkit-font-smoothing` is a macOS-only
property — a no-op in the iOS client most coaches are in — and where it does
apply, `antialiased` renders type *thinner*, which is the opposite of what a light
ground needs.

### Rules

- **Nothing outside the scale.** `src/__tests__/type-scale.test.ts` fails on a
  retired utility or an arbitrary `text-[…]`, in components as well as screens. A
  component pulled fresh from the shadcn CLI is the likeliest way one returns,
  and switching the namespace off means it would otherwise render at the
  inherited size instead of failing.
- **Size carries weight, not opacity.** A caption is small enough already; the
  strip's weekday was `text-[10px]` *and* `opacity-70`, and the free-slot count
  added `text-muted-foreground/70` on top of `font-normal`. Small text takes the
  full foreground colour, and emphasis comes from weight.
- **Tracking belongs to the small end only.** `tracking-widest` earns its place
  under 12px and makes a word loose above it; uppercase labels take
  `tracking-wide`.
- **Touch targets are 44px**, per the platform, regardless of the type inside
  them: `min-h-11` on anything a thumb chooses — slots, chips, rows.
