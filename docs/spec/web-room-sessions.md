# Web Room Sessions — Entry, Timing, Grace, Reconciliation, No-Show

Executable specification for the meeting lifecycle of a scheduled 1:1 Session: pre-join, join eligibility, presence, timing, grace and extension, room closure, reconciliation, and terminal classification. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); entity structure in [domain-model.md](domain-model.md); consent posture in [privacy-retention.md](privacy-retention.md). Decided in wayfinder ticket [#24](https://github.com/apshenichniy/praximo/issues/24), refining the pre-existing handoff baseline.

Out of MVP scope: group sessions, booking/RSVP/rescheduling mechanics, media processing, AI processing, and session **video** recording (video shareable to an external mentor is post-MVP backlog; MVP records audio only).

## 1. Policy constants

| Constant | Value | Meaning |
|---|---|---|
| `PLANNED_DURATIONS` | 30, 45, 60 min | allowed planned session lengths |
| `JOIN_OPEN_BEFORE_START` | 15 min | join window opens this long before `plannedStartAt` |
| `GRACE_LENGTH` | 15 min | unplanned overtime after `effectiveEndAt` |
| `EXTENSION_BLOCK` | 15 min | one accepted extension adds exactly this |
| `EMPTY_ROOM_IDLE` | 3 min | empty-room courtesy delay before close |
| `EMPTY_ROOM_ARM_WINDOW` | 15 min | empty-room completion armed only in the last part of the effective interval |
| `ROOM_CAP` | 120 min | hard room-lifetime cap from first successful entry |
| `SWEEPER_INTERVAL` | 15 min | safety-net cron re-arming lost reconciler alarms |

## 2. States and transitions

```
scheduled ──→ in_progress ──→ completed(closeReason)
    └──────────────────────→ cancelled(cancelReason)
```

- `completed` and `cancelled` are terminal and irreversible. Media/processing failure never reopens or regresses a terminal Session.
- `closeReason` ∈ `coach_end | empty_room_idle | grace_due | room_cap | next_session_start` — exactly one per completion.
- `cancelReason` ∈ `coach_cancelled | no_show(detail) | room_unavailable`. `no_show` detail ∈ `both_absent | coach_absent | client_absent | no_overlap`.
- `coach_cancelled` is the only manual cancellation and is available **only from `scheduled`** (an in-progress session is ended with Coach end-session, never cancelled). Cancelling revokes room access and deletes the provider room if one exists.
- `ready_to_join` is **derived, never persisted** (§4). No other states exist; waiting-alone is `scheduled` + presence, not a state.
- `scheduled → in_progress` happens exactly once, at joint join (§5). Disconnects never regress it. A session that reached `in_progress` can never be classified `no_show`.
- The **sole writer of terminal transitions is the reconciler** (§9) — participant actions and provider observations only establish due thresholds.

## 3. Time model

All intervals are **half-open `[start, end)`**: an instant belongs to the interval iff `start <= t < end`. At exactly `effectiveEndAt` entry is closed and grace has begun; at exactly `graceCloseDueAt` the room is due for closure.

| Quantity | Definition |
|---|---|
| `plannedStartAt`, `plannedDuration` | the scheduled slot; `plannedDuration ∈ PLANNED_DURATIONS` |
| `effectiveEndAt` | `plannedStartAt + plannedDuration + acceptedExtensionCount × EXTENSION_BLOCK`. Upper boundary of ordinary entry and rejoin. A late `startedAt` does **not** move it. |
| `startedAt` | server time at which joint presence was first established in the reduced presence model (§5) |
| `firstEntryAt` | server time of the first successful physical entry by either participant; starts room-lifetime accounting |
| `roomCapAt` | `firstEntryAt + ROOM_CAP`; undefined (+∞) until first entry |
| `nextSession` | the earliest non-terminal Session of the **same workspace** with a later `plannedStartAt`. Scheduling validation forbids overlapping sessions within a workspace, and extension may not cross `nextSession.plannedStartAt`, so `effectiveEndAt <= nextSession.plannedStartAt` always holds. |
| `graceCloseDueAt` | `min(effectiveEndAt + GRACE_LENGTH, nextSession.plannedStartAt, roomCapAt)` |
| `completedAt` | the **logical close moment** — the timestamp of the threshold or command that closed the session (§9), not the reconciler tick |
| `roomClosedAt` | server time the provider room deletion was confirmed |
| Conversation duration | sum of joint-presence intervals; excludes pre-join, waiting alone, solo tails, time after physical close. A reporting metric, not a recording boundary. |
| Lifecycle elapsed | `startedAt → completedAt`; includes solo waiting, gaps, grace |
| Room lifetime | `firstEntryAt → roomClosedAt` |
| Recording window | `[startedAt, roomClosedAt)` — egress runs continuously once started; solo tails are recorded and transcribed (§11). Trimming to joint intervals is **not** performed. |

**Clock ownership.** The application server (the session's reconciler, §9) owns all domain timestamps: they are recorded as server receipt/processing time. Provider (LiveKit) timestamps are used only diagnostically and for ordering within the provider stream — never written to domain fields, never used in due-threshold arithmetic.

## 4. Join eligibility

Two layers, deliberately distinct:

- **Authentication into the browser experience** — resolving who this browser is: the coach via their authenticated app session, the client via the join-link token (their only credential, per [client-onboarding-auth.md](client-onboarding-auth.md)). Sufficient for the pre-join page at any time.
- **Authorization to connect to the physical room** — minting a LiveKit access token. Granted only when `ready_to_join` derives to true.

```
ready_to_join(participant, session, now) =
      session.state ∈ {scheduled, in_progress}
  AND participantGatePassed            -- coach: authenticated workspace member
                                       -- client: valid join-link token (implies accepted invite + consent)
  AND plannedStartAt − JOIN_OPEN_BEFORE_START <= now < effectiveEndAt
  AND roomNotClosed                    -- no close requested/executed, access not revoked
```

Decision table (`gate` = participantGatePassed):

| state | gate | time | room | ready_to_join |
|---|---|---|---|---|
| scheduled/in_progress | ✓ | `now < plannedStartAt − 15m` | open | **no** — pre-join only, countdown shown |
| scheduled/in_progress | ✓ | `plannedStartAt − 15m <= now < effectiveEndAt` | open | **yes** |
| in_progress | ✓ | `effectiveEndAt <= now` (grace) | open | **no** — entry and rejoin closed; extension reopens by moving `effectiveEndAt` |
| any | ✗ | any | any | **no** |
| terminal | — | — | — | **no** |
| any | — | — | closed / close requested | **no** |

Consequences: a participant who disconnects during grace cannot rejoin; an accepted extension turns the former grace into main interval, reopening entry until the new `effectiveEndAt`. Room access is revoked by cancellation, completion, the applicable client lifecycle actions, or Coach end-session.

**Room creation.** The provider room is created lazily (create-if-missing) server-side at the first authorized join. The **logical session room is stable across physical recreation**: if the provider room disappears mid-session, an eligible participant's join recreates it; recreation never creates another Session, never resurrects a logically closed room, and never resets `firstEntryAt` or `roomCapAt`.

**LiveKit token.** Minted per authorized join attempt; identity = `(sessionId, role)`; TTL to `effectiveEndAt + GRACE_LENGTH` (covers connection resume across brief network blips; entry-closure enforcement is server-side eligibility plus physical closure, not token expiry).

## 5. Presence reduction and joint join

Each person occupies **one logical seat** (`coach` | `client`). All provider observations for a session are processed **serially** by the session's reconciler actor (§9), which maintains, per seat, the set of live provider connections (keyed by participant identity + connection sid):

- `participant_joined(sid)` → add sid to the seat's set (idempotent);
- `participant_left(sid)` → remove sid (removing an unknown sid is a no-op — handles duplicates, reordering, and misses without negative presence);
- a new device connection uses the same identity → same seat; the server disconnects the older connection (replace, never a second domain participant);
- provider events are deduped by provider event id;
- **occupancy** = seat set non-empty; the reduced model is corrected at any time by an authoritative live `ListParticipants` snapshot, which overrides accumulated webhook state — and is always consulted before any emptiness-based terminal decision.

Opening a link, pre-join, holding a token, connecting devices, or publishing a track is **not** presence. Presence begins at the first successful physical room entry, which also sets `firstEntryAt` (once), leaves the session `scheduled`, puts the participant in waiting, and starts no canonical recording.

**Joint join** — the first instant both seats are occupied in the reduced model:

```
scheduled → in_progress
startedAt = server time of the observation that made both seats occupied
```

Executed exactly once: the actor is single-threaded and the DB write is guarded by `WHERE started_at IS NULL`. Duplicate or replayed observations cannot produce a second joint start. At the same boundary, atomically: the **consent snapshot** is fixed (reference to the client's active Consent Grant + consent-text version — a record, not a gate: per [privacy-retention.md](privacy-retention.md) recording is unconditional and a client without consent never has a join link), the first joint-presence interval begins, and recording starts (§11).

## 6. Grace period

Grace is the unplanned overtime `[effectiveEndAt, graceCloseDueAt)`. During grace: participants already inside continue; joint conversation still counts toward conversation duration and stays in the recording; entry and rejoin are closed; a lone client may remain (and cannot extend); the next session's start or the room cap may shorten grace to zero.

Boundary behavior at exact instants (half-open convention):

| Instant | Behavior |
|---|---|
| `effectiveEndAt` | entry/rejoin close; extension becomes available (if coach connected); an empty room becomes due for closure immediately |
| `effectiveEndAt + GRACE_LENGTH` | if this is the min bound: room due, closeReason `grace_due` |
| `nextSession.plannedStartAt` | if this is the min bound: room due, closeReason `next_session_start` |
| `roomCapAt` | room due, closeReason `room_cap` — the cap also applies before grace |

## 7. Extension

Coach-only command from inside the room, available during the current grace:

```
precondition:  effectiveEndAt <= now < graceCloseDueAt
           AND coach has a server-confirmed live connection
           AND effectiveEndAt + EXTENSION_BLOCK <= roomCapAt
           AND effectiveEndAt + EXTENSION_BLOCK <= nextSession.plannedStartAt
effect:        acceptedExtensionCount += 1        -- hence effectiveEndAt += 15m
```

- The client may be absent. One accepted command adds exactly 15 minutes; the former grace becomes main interval, reopening entry/rejoin; another extension is only available in the **next** grace (structurally guaranteed: after acceptance `now < effectiveEndAt` again).
- Idempotent by client-generated command id: a retry of an accepted command is a no-op success returning the recorded result.
- Race resolution (all commands and observations serialize through the session actor, §9): validated against current state at processing time — session terminal or room closed/close-requested → rejected; coach presence is checked at validation, a disconnect after acceptance does not undo it; extension processed before a due terminal write wins (thresholds and the alarm recompute), processed after → rejected. First writer wins, deterministically, because there is exactly one writer thread per session.

## 8. Empty-room idle threshold

Applies only to an `in_progress` session whose room is currently empty (authoritative occupancy, never a webhook counter):

```
emptyRoomIdleDueAt = min(
  max(lastParticipantLeftAt + EMPTY_ROOM_IDLE,
      effectiveEndAt − EMPTY_ROOM_ARM_WINDOW),
  effectiveEndAt
)
```

- Armed only in the last 15 minutes of the effective interval: mid-session emptiness (both dropped) waits at least until `effectiveEndAt − 15m`, giving reconnects room.
- The outer `min` makes an empty room past `effectiveEndAt` due **immediately** (the 3-minute courtesy does not extend past the effective end).
- Return of either participant before the threshold cancels it.
- Recalculated from scratch on every occupancy change, on extension (`effectiveEndAt` moved), after provider-room recreation, and after any observation correction — it is a pure function of `(lastParticipantLeftAt, effectiveEndAt)` over authoritative occupancy, so recalculation is re-derivation, never adjustment.

## 9. Reconciliation

**Architecture: one Durable Object per session** (id = session id) is the reconciler actor — see [ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md). It serializes everything for its session: provider webhooks, coach commands, due-threshold evaluation, and it is the **sole writer of terminal transitions**. Due thresholds arm a DO alarm at the earliest due instant; a safety-net cron sweeper (every `SWEEPER_INTERVAL`) scans Postgres for non-terminal sessions with an overdue threshold and pings their DO, recovering lost alarms.

**Due-threshold precedence** (highest first), used both to pick among simultaneously due thresholds and to select the close reason on equal timestamps:

```
coach_end > room_cap > next_session_start > grace_due > empty_room_idle
```

`completedAt` = the threshold's own timestamp (`roomCapAt`, `nextSession.plannedStartAt`, `graceCloseDueAt`, `emptyRoomIdleDueAt`, or the coach_end command acceptance time) — deterministic, independent of reconciler latency. The write time is recorded separately for audit.

Reconciler pseudocode (runs on alarm, on sweeper ping, and immediately after a close-requesting command):

```
reconcile(session):
  s = load(session)                        -- DB row, CAS-guarded writes below
  if s.state is terminal: ensureRoomDeleted(s); return
  occ = liveOccupancy(s)                   -- authoritative provider snapshot

  if s.state == scheduled:
    if incidentInJoinWindow(s):                        -- §12
        if now >= effectiveEndAt: terminalize(cancelled(room_unavailable))
    else if occ.empty  AND now >= s.effectiveEndAt:    -- next tick after effectiveEndAt
        terminalize(cancelled(no_show, classify(s)))   -- §10
    else if now >= graceCloseDueAt(s):                 -- one waiter ran out grace
        terminalize(cancelled(no_show, classify(s)))
    else: armAlarm(nextDueInstant(s)); return

  if s.state == in_progress:
    due = duesReached(s, occ, now)          -- ordered by precedence
    if due.empty: armAlarm(nextDueInstant(s)); return
    reason = first(due)
    closeRoom(s)                            -- idempotent provider deletion, retried
    terminalize(completed(reason, completedAt = thresholdTime(reason)))

terminalize(t):
  -- single transaction: conditional UPDATE … WHERE state NOT IN (terminal)
  -- + outbox row  ⇒ exactly one logical completion event
  if updated == 0: return                   -- first writer already won
  emitCompletionEvent(t)                    -- triggers the processing pipeline for
                                            -- completed sessions with a recording
```

- **First-writer-wins** is enforced twice: by actor serialization (normal path) and by the conditional UPDATE (covers DO migration/restart anomalies).
- **Exactly-once completion event:** the outbox row is written in the terminal transaction; the pipeline workflow instance id = session id, so provider-side dedupe absorbs any replay ([ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md) — the pipeline is triggered by this event, not directly by LiveKit webhooks).
- **Retry semantics / partial-failure recovery:** `closeRoom` and `terminalize` are independently idempotent. Room closed but terminal write failed → alarm/sweeper re-runs `reconcile`, occupancy is empty, terminal write retries. Terminal written but provider deletion failed → `ensureRoomDeleted` retries on subsequent pings until confirmed (access is already revoked — eligibility derives to false for terminal states — so nothing can happen in the orphan room; LiveKit's empty-room timeout is the backstop).
- A delayed provider observation arriving after terminal is ignored (terminal states absorb).

## 10. No-show classification

Possible only when `startedAt` was never recorded. Details of `cancelled(no_show)`, not separate states — derived at terminalization from attendance facts (`everEntered` per seat, over the whole pre-terminal history):

| coach ever entered | client ever entered | joint presence | detail |
|---|---|---|---|
| no | no | never | `both_absent` |
| no | yes | never | `coach_absent` |
| yes | no | never | `client_absent` |
| yes | yes | never | `no_overlap` |

Timing (per pseudocode §9): room empty at `effectiveEndAt` → cancelled on the next due evaluation; exactly one participant still inside → the room lives until `graceCloseDueAt` — a **connected coach** may extend during grace, reopening Join (the session stays `scheduled` while extended waiting continues); a client cannot extend. Repeated short entries and a participant leaving moments before the other's entry change nothing: only overlap creates `in_progress`, and `no_overlap` records that both tried.

## 11. Recording control

- Canonical recording = **two audio Track Egress jobs** (one per seat), started by the reconciler actor at joint join (`scheduled → in_progress`). Nothing is recorded during waiting, whatever tracks are published.
- A reconnect publishes a new track → the actor starts a new egress job for the new publication; a Track may therefore consist of **multiple R2 segments**, ordered by start time and merged downstream (media processing, out of scope here).
- Recording stops with physical room closure (room deletion terminates egress). Solo tails after one participant leaves are recorded — trimming to joint intervals is deliberately not done (§3).
- **Egress failure mid-call never touches the meeting lifecycle** (provider failure after `startedAt` never yields `room_unavailable`): the actor attempts a bounded restart of a replacement job for a still-published track; the failure and any coverage gap are recorded on the Recording's processing status (separate lifecycle, [ADR 0001](../adr/0001-processing-pipeline-on-cloudflare-workflows.md)).
- A recording indicator is always visible in the web room (recording is unconditional, [privacy-retention.md](privacy-retention.md)).

## 12. Room-unavailable evidence

`cancelled(room_unavailable)` requires **server-side observed provider failure**, recorded as an incident on the session at the moment it happened: room creation / token minting / LiveKit API failure (5xx, timeout, unreachable) during an **authorized** join attempt within the join window. Client-side failures (network, device permissions, webview limitations) are never evidence; nor are participant absence, incomplete onboarding, or recording/storage failure.

Classification: joint presence never reached AND ≥ 1 incident in the join window → `room_unavailable` takes precedence over `no_show`. After `startedAt`, provider failure leaves the session eligible for `completed`; degradation belongs to the media lifecycle.

## 13. Idempotency and command contracts

| Surface | Key | Semantics |
|---|---|---|
| Coach commands (`extend`, `end_session`, `cancel`) | client-generated command UUID | actor stores processed ids + results until terminal + retention window; replay returns the recorded result |
| Provider webhooks | provider event id | dedupe inside the actor; set-based presence reduction makes redelivery harmless anyway |
| Terminal transition | conditional UPDATE on state | first writer wins |
| Completion event → pipeline | workflow instance id = session id | provider dedupe, exactly one run |

**Coach end-session contract.** Preconditions: `in_progress` (never reached joint presence → unavailable; a waiting coach just leaves) AND coach has a server-confirmed connection; client presence not required. Processing, in order: (1) commit point — record `closeRequested(coach_end, commandId)` and revoke room access atomically (eligibility derives to false); (2) delete the provider room (idempotent, retried; recording stop follows physical closure as always); (3) run `reconcile` immediately → `completed(coach_end)`, `completedAt` = command acceptance time. Irreversible; no-op success on an already-terminal session; provider failure after the commit point cannot reopen access — retries drive steps 2–3 to completion.

**Extension contract:** §7.

## 14. Delivery and in-room UI (MVP scope)

**Webview constraint.** WebRTC calls inside Telegram's in-app browser / Mini App webview are **not supported** — verified unreliable (iOS in-app browser: camera permission loop, [livekit#2846](https://github.com/livekit/livekit/issues/2846); iOS Mini App: black `getUserMedia` stream, [tma#748](https://github.com/Telegram-Mini-Apps/telegram-apps/issues/748); Android: repeated permission prompts, [DrKLO/Telegram#1947](https://github.com/DrKLO/Telegram/pull/1947)). Join links are delivered as a **web_app button → trampoline page → `Telegram.WebApp.openLink(roomUrl)`** — documented to always open the system browser. The pre-join page additionally detects in-app webviews by user agent and shows an "open in your browser" screen instead of Join.

**Pre-join** (reachable whenever the link authenticates, any time before terminal): local camera preview, mic/camera selection, permission diagnostics, Join countdown until the window opens, schedule-change notice, and the informational recording notice ([privacy-retention.md](privacy-retention.md)). Creates no presence, starts nothing, records nothing.

**In-room UI:** LiveKit Components React defaults — mute, camera toggle, device selection, screen share (on; not recorded — audio-only egress), leave; chat off; recording indicator always on; waiting state ("waiting for the other party") while `scheduled`. Coach-only: **End session** and **Extend +15** (visible during grace). No name entry anywhere — identities come from the token; both participants are shown with their domain names and avatars (Telegram profile photos: client's captured at invite acceptance, coach's at Mini App login). UI language per role: client link → `client.language`, coach → coach's `Member.language`. Mobile browsers are supported (clients arrive from Telegram on phones).

## 15. Acceptance criteria (scenario-based)

Attendance combinations (`plannedStartAt = T`, duration 60m, no next session, no extension):

1. **Neither enters.** Room never created, `firstEntryAt` unset. At `T+60m` (next evaluation): `cancelled(no_show: both_absent)`.
2. **Coach waits alone, leaves at T+20m.** Room empty at `T+60m` → `cancelled(no_show: client_absent)`; `completedAt` n/a, room closed on cancel.
3. **Client waits alone until closure.** Client cannot extend; at `graceCloseDueAt = T+75m` → `cancelled(no_show: coach_absent)`.
4. **Both enter, never overlap** (coach T+5..T+10, client T+20..T+25). Empty at `T+60m` → `cancelled(no_show: no_overlap)`.
5. **Repeated short entries without overlap** → still `no_overlap`; set-based reduction counts each entry, `everEntered` both true.
6. **Client leaves 1s before coach enters** → no joint instant → `no_overlap`. If observations arrive out of order, reduction of sid-sets yields the same result.
7. **Joint presence for 30s, then both leave at T+2m.** `in_progress`; empty-room threshold armed only from `T+45m` → alarm at `T+45m`; if nobody returned: `completed(empty_room_idle)`, `completedAt = T+45m`. Never no-show.
8. **Coach-only extension during grace.** Joint session; client leaves; at `T+60m` coach still inside → grace; coach extends at `T+62m` → `effectiveEndAt = T+75m`, client may rejoin; next grace at `T+75m`.
9. **Extension while waiting (never joint).** Session still `scheduled`; a connected coach may extend during grace, reopening Join for the client (scenario: client's link delivery delayed).
10. **Room cap truncates grace.** First entry `T−15m` → `roomCapAt = T+105m`. After one extension `effectiveEndAt = T+75m`, `graceCloseDueAt = min(T+90m, ∞, T+105m) = T+90m`; a second extension (`T+90m <= T+105m`) is allowed; a third (`T+105m <= T+105m`) fits exactly, making `effectiveEndAt = roomCapAt = T+105m` — the room closes there as `completed(room_cap)` (precedence over `grace_due` on the equal timestamp), and no further extension is possible.
11. **Next session truncates grace.** `nextSession.plannedStartAt = T+70m` (validation allows: no overlap with `[T, T+60m)`) → `graceCloseDueAt = T+70m`, `completed(next_session_start)`; extension is rejected (`T+75m > T+70m`).
12. **Coach end-session.** `in_progress`, coach connected → room closes immediately, rejoin impossible even before the reconciler writes; `completed(coach_end)`, `completedAt` = command time. Retried command id → same success. After terminal → no-op success.
13. **Extension races the due close.** Both due at `T+75m`: whichever the actor processes first wins deterministically; a rejected extension returns "session ended".
14. **Provider room lost mid-session.** `in_progress`, LiveKit room vanishes; eligible participant rejoins → room recreated, same logical session, `roomCapAt` unchanged; occupancy re-derived from live snapshot.
15. **Provider down at join.** Token mint fails 5xx at `T+2m` (incident recorded); nobody ever joint → at `T+60m`: `cancelled(room_unavailable)`, wins over no-show.
16. **Egress dies mid-call.** Session unaffected; replacement job attempted; gap recorded on Recording.
17. **Duplicate / out-of-order webhooks.** Replayed `participant_joined`, unknown-sid `participant_left`, delayed events after terminal — all absorbed (§5, §9); never negative presence, never a second `startedAt`, never a second completion event.
18. **Boundary instants.** At exactly `effectiveEndAt`: join denied, extension allowed. At exactly `graceCloseDueAt`: closure due. At exactly `plannedStartAt − 15m`: join allowed.
