# Domain Model — MVP Entity Outline

Outline of entities, relationships, and state machines for the MVP spec. Vocabulary follows [CONTEXT.md](../../CONTEXT.md); this document adds structure and lifecycle, not new terms. Decided in wayfinder ticket [#7](https://github.com/apshenichniy/praximo/issues/7).

## Principles

- **Workspace is the tenancy boundary.** Every row that isn't the workspace itself carries a `workspace_id` (directly or through its parent). No cross-workspace identity: the same human coached by two coaches is two independent Clients.
- **Session lifecycle and processing status are separate dimensions.** The session state machine tracks the human-facing lifecycle; each derived entity (recording, transcripts, artifacts) tracks its own processing status. There is no god-status on Session.
- **Content lives in object storage (R2), metadata in Postgres.** Track transcripts and the combined Transcript are R2 objects; the database holds references, statuses, and metadata. Utterance-level DB queries are not an MVP need.
- **Channel-agnostic client model, three kinds in MVP.** `telegram`, `email`, and `manual` (coach-forwarded links) ship in MVP; the kind set stays open. One Invite/acceptance model covers all paths ([#27](https://github.com/apshenichniy/praximo/issues/27)).

## Entities

### Workspace

The unit of tenancy. One coach's practice.

- `id`, `name`, timestamps
- **Bot** (1:1 child): the workspace's Telegram bot — Telegram id, username,
  cached `botInfo`, versioned AES-256-GCM credential envelope, webhook-secret
  hash, and connection status. A separate provisioning attempt records a
  request without reserving the workspace; its first valid Managed Bots update
  becomes the resumable claim. Completion, owner assignment, invite consumption,
  and the durable manager-notification job commit atomically. See
  [ADR 0004](../adr/0004-bot-per-coach-provisioning.md).

### Member

A person inside a workspace, with a role.

- `workspace_id`, auth identity (`telegram_user_id` — the coach authenticates by Ed25519 Mini App `initData`, [ADR 0006](../adr/0006-coach-authentication-in-mvp.md); unique among owners, and the natural key a post-MVP Better-Auth `user` attaches to)
- `terms_accepted_at` / `terms_version`, `last_login_at`, `last_activity_at`, and `credentials_valid_from` — the revocation floor an `auth_date` must clear
- `role`: `owner` only in MVP; open set (`assistant`, `co_coach` reserved for group coaching)
- `language`: `en | uk | ru` — chosen at coach onboarding; the language of the coach's UI and of all artifacts delivered to them
- `avatar`: R2 object — Telegram profile photo, captured/refreshed at each Mini App login; shown in the web room
- One coach = one workspace in MVP; the membership table is the extension point, not a promise of multi-workspace support.

### Client

A coached person, scoped to one workspace. No account, no credentials.

- `workspace_id`, `name` (the coach sets only the name at creation; the client may edit it on the web acceptance page)
- `language`: `en | uk | ru` — chosen by the **client** during invite acceptance (pre-selected from Telegram's `language_code`, or from the invite's language on the web page); the language of messages to the client, and the STT fallback hint
- `avatar`: R2 object — Telegram profile photo captured at invite acceptance, or uploaded / imported from Google on the web acceptance page (the displayed avatar lives on the person); shown in the web room, initials when absent
- `google_sub`: optional — captured when the client used **Continue with Google** on the web acceptance page; no OAuth token is stored
- **Identity keys, dormant:** the Telegram channel's user id, the email channel's address, and `google_sub` are the durable keys a post-MVP client portal matches against to attach Better-Auth accounts additively ([client-onboarding-auth.md](client-onboarding-auth.md) §Principles)

### Channel

How a client is reached.

- `client_id`, `kind`: `telegram | email | manual` (MVP) — open set
- kind-specific address: Telegram user/chat id, or email address; `manual` carries none
- `telegram` carries the profile snapshot captured at acceptance: name, username, avatar (R2 object)
- exactly one primary channel per client; reminders and join links are delivered to it — for `manual`, they route to the **coach** as a ready-to-forward message ([client-onboarding-auth.md](client-onboarding-auth.md))

### Invite

The onboarding entry point, uniform across current and future channel kinds.

- `workspace_id`, `client_id`, `token` — single-use, TTL 7 days; re-issuing creates a new Invite and expires the old one, copying the delivery target
- `status`: `pending → accepted`, or `expired`
- `delivery`: `{ kind: telegram | email | link, address? }` — how the invite reaches the client: Telegram deep link, an invite email the service sends itself, or a web URL the coach forwards manually
- optional `expected_telegram_user_id` — enables recognition on a bare `/start`; the UI that sets it (Telegram user picker) is deferred post-MVP, the field ships so it can be added without migration ([client-onboarding-auth.md](client-onboarding-auth.md))
- The same token has two forms: the bot deep link and the future web URL
  `me.praximo.io/i/<token>`. Accepting is atomic on either door — it creates the
  client's Channel, appends the Consent Grant, and sets the client's language
  and profile. The web door is owned by #57 and is not implemented by #215.

### Consent Grant

Append-only consent record; "does the client have consent" is derived from the latest grant.

- `client_id`, scope (recording + processing), consent-text version, channel it was given through, `granted_at`
- Captured once at onboarding, minimum friction; revocation is a coach action that appends a revocation grant. Scheduling is blocked only **after revocation**; while consent is pending (invite outstanding) scheduling is allowed — the client cannot join before accepting. Texts, retention, and deletion semantics: [privacy-retention.md](privacy-retention.md) (decided in ticket #6).

### Session

A scheduled 1:1 conversation, coach ↔ one client.

- `workspace_id`, `client_id`, `scheduled_at`, duration
- `kind`: `intake | regular` — open set, chosen by the coach at creation; defaults to `intake` for a client's first session. Kind selects the debrief prompt (intake: goals, coaching contract, agreements); the mentor review prompt is the same for all kinds.
- `state`: see [Session states](#session-states)
- Join Link tokens, one per (session, role) — coach and client each have their own; multi-use, valid while the session is `scheduled`/`in_progress`, dead in terminal states, stable across rescheduling ([client-onboarding-auth.md](client-onboarding-auth.md))
- Rescheduling mutates `scheduled_at` in place; no reschedule history in MVP.
- No language attribute: STT auto-detects, with `client.language` as the fallback hint; the detected language is recorded on the Transcript.

### Recording

1:1 with a completed session. Audio only.

- `session_id`, egress metadata, processing status
- **Track** (child): one per participant — `participant` (`coach | client`), duration. Per-track capture gives deterministic speaker attribution. A track may consist of **multiple R2 segments** (a reconnect starts a new egress job for the new publication); segments are ordered by start time and merged downstream. Egress starts at joint join and stops at physical room closure ([web-room-sessions.md](web-room-sessions.md)).
- Recording is unconditional — no per-session opt-out. Audio is auto-deleted 30 days after the Transcript is generated; rows keep metadata plus a deleted-by-retention fact ([privacy-retention.md](privacy-retention.md)).

### Track Transcript

1:1 with a track. The raw STT output.

- `track_id`, provider (`deepgram` first; provider-agnostic), provider metadata, processing status
- Content: provider-format JSON with timecodes, stored in R2.

### Transcript

1:1 with a session. Derived by a deterministic merge of the track transcripts.

- `session_id`, `detected_language`, processing status
- Content: compact speaker-attributed utterance format in R2 — this exact rendering is what LLM prompts consume.
- Regeneration replaces it wholesale; no versioning (versions exist only on artifacts).

### Artifact

An LLM-generated analysis document.

- `session_id`, `kind`: `brief | debrief | mentor_review` — open set, new kinds must be addable without migration
- `version`: append-only; the current artifact per `(session, kind)` is the latest version
- generation status, model/prompt metadata
- Written in the **coach's** language; delivered as bot messages
- Brief is generated *before* its session, from the client's prior sessions' artifacts; when no prior artifacts exist (typically an intake session), the Brief is skipped. Debrief and Mentor Review are generated *after*, from the Transcript. Same entity, different generation moment.
- No manual editing in MVP.

## Session states

```
scheduled ──→ in_progress ──→ completed(closeReason)
    └───────────────────────→ cancelled(cancelReason)
```

- `completed` and `cancelled` are terminal and irreversible. `closeReason` ∈ `coach_end | empty_room_idle | grace_due | room_cap | next_session_start`; `cancelReason` ∈ `coach_cancelled | no_show(detail) | room_unavailable`, with no-show detail `both_absent | coach_absent | client_absent | no_overlap`. Full semantics, timing model, and reconciliation: [web-room-sessions.md](web-room-sessions.md) (decided in ticket [#24](https://github.com/apshenichniy/praximo/issues/24)).
- `ready_to_join` is **derived, never persisted**; there are no other states — waiting alone is `scheduled` plus presence.
- The transition `scheduled → in_progress` happens exactly once at joint join (`startedAt`); terminal transitions are written only by the per-session reconciler ([ADR 0005](../adr/0005-session-reconciler-on-durable-objects.md)).
- "Processed" is **not** a session state — processing progress lives on Recording / Track Transcript / Transcript / Artifact statuses.

## Relationships at a glance

```
Workspace 1─1 Bot
Workspace 1─* Member (owner in MVP)
Workspace 1─* Client 1─* Channel (one primary)
Client    1─* Invite
Client    1─* Consent Grant (append-only)
Workspace 1─* Session *─1 Client
Session   1─1 Recording 1─* Track
Track     1─1 Track Transcript
Session   1─1 Transcript
Session   1─* Artifact (versioned; one current per kind)
```

## Language rules

| Attribute | Set when | Drives |
|---|---|---|
| `Member.language` (coach) | coach onboarding | UI language; language of all artifacts |
| `Client.language` | client onboarding | bot messages to the client; STT fallback hint |
| `Transcript.detected_language` | transcription | record of what was actually spoken |

Supported: `en`, `uk`, `ru`.

## Open edges (deferred, with owners)

- **Processing-status shape and retries** — pipeline platform ADR (ticket #10).
- **Artifact content storage** (DB text vs R2 object) — implementation detail, no domain impact; decide with the pipeline.
