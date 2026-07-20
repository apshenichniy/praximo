# Mini App — Screens and Navigation (MVP)

The coach's minimal Telegram Mini App: schedule, sessions, clients. Same
TanStack Start app as the web UI. Decided in wayfinder ticket
[#15](https://github.com/apshenichniy/praximo/issues/15) by prototyping three
structurally different variants (`prototypes/mini-app-screens`); the
hub-and-spoke "Today" variant won. Vocabulary follows
[CONTEXT.md](../../CONTEXT.md); entity semantics follow
[domain-model.md](domain-model.md).

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
- **New session** — client picker + date/time.

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
