# ADR 0001: Processing pipeline on Cloudflare Workflows

- **Status:** accepted
- **Date:** 2026-07-19
- **Decided in:** wayfinder ticket [#10](https://github.com/apshenichniy/praximo/issues/10), grounded in research [#3](https://github.com/apshenichniy/praximo/issues/3) ([full write-up](../../docs/research/cf-workflows-pipeline.md) on branch `research/cf-workflows-pipeline`)

## Context

Every completed session runs through record → transcribe → analyze → deliver: LiveKit Egress captures per-track audio, an STT provider (Deepgram first, provider-agnostic module) produces track transcripts, a deterministic merge yields the Transcript, LLM calls generate Artifacts, and the workspace's bot delivers them to the coach. The pipeline is I/O-bound end to end — audio moves server-to-server (Egress → R2, Deepgram fetches from R2 by URL), so no media bytes ever need to pass through our code.

The stack is already committed to Cloudflare (Workers, R2, AI Gateway, Alchemy 2 IaC) and to Effect 4 beta. The domain model ([domain-model.md](../spec/domain-model.md)) mandates that processing progress lives on the derived entities (Recording, Track Transcript, Transcript, Artifact), never as a god-status on Session.

The alternative considered was a separate always-on container worker (Fly/Railway/VPS): it buys freedom from platform limits (ffmpeg, CPU-heavy media work) at the cost of DIY durability, a second ops surface, and a second IaC path — none of which an I/O-bound pipeline needs.

## Decision

### Platform

**Cloudflare Workflows is the pipeline orchestrator.** R2 is the artifact store. **Strict pass-by-reference**: workflow event payloads, step results, and queue messages carry R2 keys and row ids, never content bodies (hard 1 MiB payload/step-result limit; rule of thumb — anything ≥ ~100 KB moves by reference).

**No Queues in MVP.** At MVP volume (a handful of sessions per day) webhooks trigger workflows directly and delivery is a workflow step; Workflows already provides durability and retries. Queues (always with a DLQ — messages that exhaust retries without one are deleted permanently) is the sanctioned tool for when a genuine buffering or fan-out need appears, most likely reminders.

**No container worker.** If in-pipeline media processing (e.g. ffmpeg) ever becomes a requirement, add a single containerized step invoked from a workflow step — do not move the pipeline.

### Trigger and identity

The LiveKit webhook handler verifies the signed JWT against the raw body, records egress events, and — once the session's recording is complete — creates the post-session workflow instance with **instance id = session id**. Duplicate webhook deliveries and re-triggers dedupe for free; exactly one instance per session. The precise "recording complete" condition (track egress per participant, reconnects producing multiple tracks, `room_finished`) is deferred to web-room/egress implementation prep.

### Stages of the post-session workflow

1. **STT, per track, in parallel.** For each track: presign an R2 GET URL → submit to Deepgram (`transcribeUrl`) with a callback URL carrying an unguessable token path segment → `step.waitForEvent` for that track. The callback handler authenticates via the URL token + `dg-token` header, correlates `request_id`, writes the raw transcript JSON to R2, and delivers `{request_id, r2Key}` as the event. Wait timeout: 30 minutes per track; Deepgram has no polling endpoint for async jobs, so the timeout fallback is **bounded re-submission**, not polling.
2. **Merge.** Deterministic merge of track transcripts into the Transcript (compact speaker-attributed rendering) in R2; `detected_language` recorded.
3. **Debrief ∥ Mentor Review.** Generated in parallel, independent failure — one failing does not block the other.
4. **Brief for the next scheduled session.** Runs strictly after step 3 (the brief consumes the client's prior artifacts *including the two just generated*). Target: the client's next scheduled session. If it already has a brief (scheduled before this session completed), a new version supersedes it. If no next session is scheduled, the step is skipped — the same generator runs via a second, lightweight trigger when that session is created. A client's first session has no brief (no prior artifacts).
5. **Delivery.** A workflow step sends artifacts as bot messages via grammY directly — no delivery queue.

Each stage boundary updates the owning entity's processing status in Postgres (Recording, Track Transcript, Transcript, Artifact) — statuses live on derived entities per the domain model.

### Failure handling, retries, idempotency

At-least-once semantics everywhere (LiveKit retries, Deepgram retries ×10, workflow step replays) — every handler and step is idempotent.

Retry classes (starting values, not dogma):

| Class | Policy |
|---|---|
| Cheap steps (presign, merge, status writes) | 5 attempts, exponential from 10 s |
| STT (submit + wait cycle) | 4 full submission cycles, backoff 1 → 10 → 60 min |
| LLM calls, Telegram delivery | 8 attempts, exponential from 1 min, capped at 1 h (~half-day window — survives a provider outage) |

On exhaustion: the entity's status becomes `failed` and the bot **proactively notifies the coach** in the coach's language. There is deliberately **no manual retry/regenerate control in the product** — no clear user story for it yet; long backoff does the recovering. The ops recovery path is re-running the workflow instance via the Workflows API / wrangler.

### Prompt caching

A design-for-cacheability principle, not a cost dependency: prompts are structured with a stable prefix ordering — static system prompt + paraphrased ICF materials, then the transcript, then the task-specific instruction — provider caching is enabled through the Vercel AI SDK where supported, and the artifact calls of one run execute within one time window so the shared prefix can hit the cache TTL. Pipeline economics must not rely on cache hits (at MVP volume, cross-session hits are unlikely).

### Effect 4

Proceed on `effect@beta` behind a thin adapter: per-request `ManagedRuntime` built from `env`, no cross-request fibers (Workflows owns long-running orchestration), Web-API platform code only. A **1-day spike** — v4-beta on workerd via `wrangler dev`, an Effect program inside a workflow step, `WebhookReceiver` on workerd — is tracked as its own map ticket and gates implementation start, not this ADR: if the spike fails, we adapt the Effect patterns (down to v3 if needed); the platform choice stands.

### Retention deletion

Audio deletion (30 days after transcription, per [privacy-retention.md](../spec/privacy-retention.md)) is executed by a **cron-triggered sweeper Worker** that scans Postgres for due audio, deletes the R2 objects, and records the deleted-by-retention fact. Not an in-workflow `step.sleep(30d)`: pipeline instances finish fast, retention rules stay in one place, and no instances dangle for a month.

## Consequences

- Zero server ops; durable execution, retries, and long waits come from the platform; idle time is unbilled; one Alchemy IaC stack covers Workers, Workflows, R2, and cron triggers.
- The 1 MiB payload discipline is a standing constraint — every new stage must move content by reference.
- Effect 4 beta churn and workerd friction are accepted schedule risk, bounded by the spike and the adapter seam.
- **Known evolution:** once between-session activities exist (assignments, coach/client inputs into a client profile or memory), brief generation moves out of the post-session run into a pre-session workflow. Generating all artifacts in one flow is the deliberate MVP simplification.
- Reminder/scheduling mechanics — including *when* the brief is delivered before a session — are decided separately (still fog on the map).
- Queues enter the architecture with the first real fan-out need (likely reminders), always with DLQs.
