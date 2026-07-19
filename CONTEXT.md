# Praximo

Multi-tenant platform for coaches: session scheduling, video calls, recording, transcription, and LLM analysis that amplifies the coach — briefs, debriefs, and ICF-style mentor reviews. Single bounded context in MVP.

## Language

### Tenancy

**Workspace**:
A coach's practice and the unit of tenancy; every client, session, and artifact belongs to exactly one workspace.
_Avoid_: tenant, organization, account

**Member**:
A person with a role inside a workspace. The only MVP role is the owning coach; the role set is open (assistant, co-coach later).
_Avoid_: user

**Coach**:
The workspace's owning member — the professional who conducts sessions and receives all analysis artifacts.
_Avoid_: practitioner

**Bot**:
The workspace's dedicated Telegram bot — the delivery channel for reminders, join links, and artifacts.

### Clients and onboarding

**Client**:
A person being coached, scoped to one workspace; has no account of their own. The same human working with two coaches is two clients.
_Avoid_: coachee, customer, user

**Channel**:
A client's way of being reached (Telegram in MVP; other kinds later). Reminders and join links go to the client's primary channel.
_Avoid_: contact, messenger

**Invite**:
A tokenized invitation from coach to client. Accepting it creates the client's channel and captures their consent.
_Avoid_: invite link (that's a Join Link)

**Consent Grant**:
An append-only record that a client agreed to session recording and processing, captured during onboarding.
_Avoid_: consent flag

### Sessions

**Session**:
A scheduled 1:1 coaching conversation between the coach and one client.
_Avoid_: meeting, call, appointment

**Web Room**:
The browser page where the coach and client meet for a session's call.
_Avoid_: room (the underlying video room is infrastructure, not a domain concept)

**Join Link**:
The tokenized URL through which a client enters a session's web room — the client's only credential.
_Avoid_: room link, invite link

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
