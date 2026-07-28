# Praximo

Multi-tenant platform for coaches: session scheduling, video calls, recording, transcription, and LLM analysis that amplifies the coach — briefs, debriefs, and ICF-style mentor reviews. Single bounded context in MVP.

## Language

### Platform actors

**Platform Admin**:
A person with the independent platform capability to operate workspaces and
coach onboarding through the Admin App. This is not a Workspace Member role. A
person may also be a Coach, but the two job contexts never cross-navigate.
_Avoid_: admin member, workspace admin

**Manager Bot**:
The platform-owned Telegram bot that opens the Admin App and sends
platform-operation messages. `@PraximoBot` is the active identity in the
single disposable development environment; `@PraximoDevBot` is reserved and
unused.
_Avoid_: admin bot, mother bot, PraximoMother

**Admin App**:
The Platform Admin console and Manager Bot onboarding companion at
`admin.praximo.io`.
_Avoid_: admin section, admin tree

**Coach App**:
The Coach's practice workspace, opened from the Workspace's Bot at
`coach.praximo.io`. Telegram is its only deployed MVP host, but Telegram
presentation concerns stay behind a host boundary.
_Avoid_: web app, coach web app

**Client App**:
The browser application at `me.praximo.io`. During the #215 foundation
migration it is only a minimal deployable shell; Client product work begins
with #57.
_Avoid_: client portal

### Tenancy

**Workspace**:
A coach's practice and the unit of tenancy; every client, session, and artifact belongs to exactly one workspace.
_Avoid_: tenant, organization, account

**Awaiting Setup**:
A workspace created by the operator whose coach has not yet completed onboarding and taken ownership. Its onboarding Invite may be current or expired; no coach Bot is connected yet.
_Avoid_: provisioning workspace, provisioned workspace, unclaimed workspace, pending workspace

**Member**:
A person with a role inside a workspace. The only MVP role is the owning coach; the role set is open (assistant, co-coach later).
_Avoid_: user

**Coach**:
The workspace's owning member — the professional who conducts sessions and receives all analysis artifacts.
_Avoid_: practitioner

**Bot**:
The workspace's dedicated Telegram bot — the delivery channel for reminders, join links, and artifacts.

**Candidate Bot**:
A bot a coach offered for their workspace that is not connected yet — created in one tap through Managed Bots, or identified by a @BotFather token pasted into the manager chat. It becomes the workspace's Bot only once it is configured and activated.
_Avoid_: pending bot, unclaimed bot

**Ownership Proof**:
The handshake that lets a pasted credential connect a Candidate Bot: the coach opens that bot with a one-shot nonce only their manager chat received, from the same Telegram account that pasted the token. Possession of a token is not proof it is the coach's to hand over.
_Avoid_: verification, confirmation code

**Creation Prompt**:
The one message in the coach's manager chat whose button opens Telegram's bot-creation dialog. It is **armed** while that button is live and **disarmed** once the button is taken off it. At most one armed prompt exists in a chat at any moment, and none once the workspace has a Bot — so a prompt still armed means provisioning has not completed and re-tapping is the way to resume.
_Avoid_: create button, keyboard, invite message
_Note_: **armed** is also said of a *webhook* — a bot pointed at us with a secret we hold the hash of. Same word, unrelated subject: a prompt is armed for the coach to tap, a webhook is armed for Telegram to deliver to. Say which when it is not obvious from the sentence.

**Setup Announcement**:
The first thing a coach's own bot says, sent while it is still being configured and **edited in place** into the ready greeting once it is. It exists because Telegram offers a **Start bot** button the moment the bot exists, so the coach is already waiting; a send that Telegram refuses means they have not opened the chat, which is the platform's only way of knowing.
_Avoid_: loading message, placeholder, please wait

### Clients and onboarding

**Client**:
A person being coached, scoped to one workspace; has no account of their own. The same human working with two coaches is two clients.
_Avoid_: coachee, customer, user

**Channel**:
A client's way of being reached — `telegram`, `email`, or `manual` in MVP (open set). Reminders and join links go to the client's primary channel; a manual client's go to the coach, ready to forward.
_Avoid_: contact, messenger

**Invite**:
A tokenized invitation from coach to client. Accepting it — in the bot or on the Acceptance Page — creates the client's channel and captures their consent.
_Avoid_: invite link (that's a Join Link)

**Acceptance Page**:
The web page where a non-Telegram client accepts an invite: language, profile (name, optional avatar and email, optional Google import), consent. The bot conversation is its Telegram equivalent.
_Avoid_: sign-up page, registration (no account is created)

**Consent Grant**:
An append-only record that a client agreed to session recording and processing, captured during onboarding.
_Avoid_: consent flag

### Sessions

**Session**:
A scheduled 1:1 coaching conversation between the coach and one client. Has a kind — `intake` or `regular` (open set).
_Avoid_: meeting, call, appointment

**Intake**:
The session kind for a client's first session — clarifying goals and the coaching contract; drives its own debrief prompt. Not the industry's *chemistry* / *discovery* session, which is the unpaid mutual-fit call before any engagement exists: in MVP that happens off-platform, and the client-facing word for an intake is «первая встреча», never «знакомство».
_Avoid_: first session (as a term), discovery call, chemistry session

**Web Room**:
The browser page where the coach and client meet for a session's call.
_Avoid_: room (the underlying video room is infrastructure, not a domain concept)

**Join Link**:
The tokenized URL through which a client enters a session's web room — the client's only credential.
_Avoid_: room link, invite link

**Pre-Join**:
The browser preparation phase before entering the web room — camera preview, device checks, countdown. Not presence: nothing starts here.
_Avoid_: lobby, waiting room (waiting happens inside the room)

**Joint Join**:
The first moment the coach and client are present in the room simultaneously — the instant the session starts and recording begins.
_Avoid_: session start (ambiguous with the scheduled time)

**Grace Period**:
The unplanned overtime after a session's effective end during which those already inside may continue but nobody may enter or rejoin.
_Avoid_: overtime, buffer

**Extension**:
The coach-only command that adds 15 minutes to a session's effective end, available only during a grace period.
_Avoid_: prolongation, overtime request

### Recording and transcription

**Recording**:
The audio capture of a session, made of one track per participant. No video is stored.

**Track**:
One participant's audio within a recording.

**Track Transcript**:
The raw, timecoded transcription of a single track, in the STT provider's format.
_Avoid_: raw transcript

**Transcript**:
The session's single combined transcript — speaker-attributed utterances merged from the track transcripts, compact enough to feed to an LLM. "Transcript" with no qualifier always means this one.
_Avoid_: combined transcript, merged transcript

**Utterance**:
A contiguous block of one speaker's speech within the transcript.
_Avoid_: segment, turn

### Analysis

**Artifact**:
An LLM-generated analysis document tied to a session. The set of kinds is open; MVP ships Brief, Debrief, and Mentor Review. Versioned and regenerable, never hand-edited.
_Avoid_: report, document

**Brief**:
The pre-session artifact that prepares the coach, drawn from the client's previous sessions' artifacts.
_Avoid_: agenda, preparation

**Debrief**:
The post-session artifact analyzing what happened in the session, written for the coach.
_Avoid_: summary

**Mentor Review**:
The post-session artifact assessing the coach's own work against ICF Core Competencies and PCC Markers.
_Avoid_: feedback, review (unqualified)
