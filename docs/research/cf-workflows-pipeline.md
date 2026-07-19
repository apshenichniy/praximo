# Research: Cloudflare Workflows + Queues as the processing pipeline platform

- **Issue:** [#3](https://github.com/apshenichniy/praximo/issues/3) (part of #1, feeds ADR in #10)
- **Date:** 2026-07-19
- **Question:** Is Cloudflare Workflows + Queues viable for the record → transcribe → analyze → deliver pipeline, with Effect 4 on the Workers runtime?

## TL;DR

Yes — viable and a good fit, **because the pipeline is I/O-bound, not CPU-bound**. LiveKit Egress writes audio directly to R2 (S3-compatible), Deepgram fetches audio itself from a presigned URL and POSTs JSON back, and LLM analysis is an API call. Audio bytes never flow through a Worker; only JSON and object references do. Workflows is GA with generous limits (unlimited wall-clock per step, up to 5 min CPU per step on paid, sleep up to a year, `waitForEvent` for webhook-driven resumption). The binding constraints are the **1 MiB payload/step-result limit** (pass R2 keys, never transcript bodies) and **Effect 4 still being in beta** (schedule risk, not a platform risk). Recommendation at the end.

---

## 1. Cloudflare Workflows

**Status:** GA since **2025-04-07** ([changelog](https://developers.cloudflare.com/changelog/2025-04-07-workflows-ga/), [GA blog post](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/)). Available on Free and Paid plans.

### Limits ([source](https://developers.cloudflare.com/workflows/reference/limits/))

| Limit | Free | Paid |
|---|---|---|
| Wall-clock duration per step | Unlimited | Unlimited |
| CPU time per step | 10 ms | 30 s default, configurable to **5 min** |
| Max `step.sleep` | 365 days | 365 days |
| Steps per workflow | 1,024 | 10,000 default, up to 25,000 |
| Event payload size | 1 MiB | 1 MiB |
| Step result size (non-stream) | 1 MiB | 1 MiB |
| Persisted state per instance | 100 MB | 1 GB |
| Concurrent running instances | 100 | **50,000** (instances in `waiting` state do not count) |
| Instance creation rate | 100/s | 300/s per account |
| Retries per step | 10,000 | 10,000 |
| State retention | 3 days | 30 days |
| Executions | 100k/day | Unlimited |

(Concurrency was 4,500 at GA and has since grown to 50,000 on the current limits page.)

### Semantics

- `step.do()` — durable step with configurable retries and backoff; step results are persisted and replayed on resume.
- `step.sleep()` / `step.sleepUntil()` — durable sleep from seconds up to a year; idle instances incur no CPU billing.
- `step.waitForEvent()` — pause until an external event (webhook, human approval) is delivered to the instance; introduced at GA. This maps directly onto "wait for Deepgram callback."
- Instances can be triggered, paused, resumed, terminated programmatically. Built-in observability and vitest support for local/CI testing.

Source: [Workflows overview](https://developers.cloudflare.com/workflows/).

### Pricing ([source](https://developers.cloudflare.com/workflows/reference/pricing/))

Billed on **CPU time** (idle/sleeping/awaiting-I/O time is *not* billed), **requests**, **storage**, and **steps**:

| Metric | Paid included | Overage |
|---|---|---|
| Requests | 10M/month | $0.30 / million |
| CPU time | 30M ms/month | $0.02 / million ms |
| Storage | 1 GB-month | $0.20 / GB-month |
| Steps | 500k/month | $0.80 / 100k |

Note: per the pricing page as fetched 2026-07-19, billing for **steps and storage starts 2026-08-10**. At praximo's scale (coaching sessions, not thousands/sec) this is effectively free-tier-adjacent; the $5/month Workers Paid plan is the practical floor.

## 2. Cloudflare Queues

### Limits ([source](https://developers.cloudflare.com/queues/platform/limits/))

- Message size: **128 KB** (~100 bytes of that is internal metadata)
- Throughput: **5,000 msg/s per queue**
- Batching: max **100 messages or 256 KB per `sendBatch`**; consumer batch up to 100 messages; max batch wait **60 s**
- Consumer: wall-clock up to **15 min** per invocation; **250 concurrent push-based consumer invocations**
- Delay: `delaySeconds` up to 24 h; pull-based `visibilityTimeout` up to 12 h
- Retention: configurable up to **14 days** (fixed 24 h on Free); per-queue backlog up to 25 GB
- Message retries: up to 100

### Delivery guarantees ([source](https://developers.cloudflare.com/queues/reference/delivery-guarantees/))

> "Queues provides *at least once* delivery by default" — "Messages are guaranteed to be delivered at least once, and in rare occasions, may be delivered more than once."

Consumers must be **idempotent** (docs recommend unique message IDs / idempotency keys, e.g. as DB primary keys). Ordering is not guaranteed (not addressed in the docs — assume unordered).

### Dead letter queues ([source](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/))

- Configured per consumer (`dead_letter_queue` in wrangler config). Default retry limit before DLQ: **3**.
- **Without a DLQ, messages that exhaust retries are permanently deleted** — a DLQ is mandatory for us.
- DLQ messages persist 4 days without a consumer; a DLQ is a normal queue and needs its own consumer (or manual drain).

**Fit note:** for this pipeline, Workflows (one instance per session, `waitForEvent` for callbacks) is the primary orchestrator; Queues is complementary — useful for decoupling webhook ingestion from workflow triggering and for fan-out delivery (Telegram), less as the pipeline backbone.

## 3. Ingesting webhooks on Workers

Workers request limits relevant here ([source](https://developers.cloudflare.com/workers/platform/limits/)): request body up to **100 MB** (Free/Pro plan), CPU 30 s default / 5 min max on Workers Paid, 128 MB memory per isolate, compressed bundle 3 MB Free / 10 MB Paid.

### LiveKit Egress completion ([webhooks doc](https://docs.livekit.io/home/server/webhooks/), [egress overview](https://docs.livekit.io/home/egress/overview/))

- Events: `egress_started`, `egress_updated`, `egress_ended`, each carrying an `egressInfo` object. Payloads are small JSON — no size concern.
- Transport: HTTP POST with `Content-Type: application/webhook+json`.
- **Auth:** `Authorization` header carries a **signed JWT containing a sha256 hash of the raw payload**. Verification requires the raw (unparsed) body. `livekit-server-sdk` v2 provides `WebhookReceiver`; its README documents Node.js, Deno, Bun, and browsers — **Cloudflare Workers is not explicitly listed** ([README](https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/README.md)). Since v2 runs in browsers it should be Web-API-based and workerd-compatible, but this needs a spike; fallback is hand-rolling JWT verification with Web Crypto (~50 lines).
- **Delivery:** "there are no guarantees around delivery" — push-based, retried multiple times, newer events delivered only after older ones are delivered or abandoned. Consequence: the workflow must not *depend* on the webhook alone — pair `waitForEvent` with a timeout branch that polls the Egress API (ListEgress) as a fallback.

### Deepgram async callbacks ([callback doc](https://developers.deepgram.com/docs/callback), [pre-recorded doc](https://developers.deepgram.com/docs/pre-recorded-audio))

- Submit audio **by URL** (`transcribeUrl`) with `callback=<url>`; Deepgram immediately returns a `request_id` and processes async, then POSTs (or PUTs via `callback_method`) the full transcript JSON to the callback URL.
- **Retries:** up to **10 times with 30 s delay** on non-2xx responses — good durability; still make the handler idempotent (at-least-once from this side too).
- **Auth verification is weak:** options are Basic Auth embedded in the callback URL (ports 80/443/8080/8443 only) or the `dg-token` header (set to the API key identifier of the submitting key). There is **no HMAC payload signature**. Mitigation: unguessable per-request callback URLs (random token path segment) + `dg-token` check + correlate `request_id` against pending requests stored in state.
- **Payload size:** full transcript JSON with word-level timings for a 1–2 h session can run to several MB. Fine for a Worker request body (100 MB limit), but **over the 1 MiB Workflows event payload limit** — the callback handler must write the transcript to R2 and deliver only `{request_id, r2Key}` to `waitForEvent`.
- Limits: max file size 2 GB; up to 100 concurrent requests per project. (The documented 10/20-minute 504 applies to synchronous requests; the callback flow exists precisely to avoid it.)

## 4. R2 for audio artifacts — pass by reference

- LiveKit Egress supports "any S3-compatible storage provider, including … CloudFlare R2" — configure `endpoint`, `bucket`, `access_key`, `secret`, `force_path_style: true` ([egress outputs doc](https://docs.livekit.io/home/egress/outputs/)). **Audio lands in R2 without touching our code.**
- Deepgram pulls audio from any HTTPS URL — generate an **R2 presigned GET URL** (standard S3 SigV4 presigning, supported by R2's S3 API) and pass it to `transcribeUrl`. Presigned-URL use isn't called out in Deepgram docs (it's just an HTTPS URL), flagged below.
- R2 limits are a non-issue for audio: 5 GiB single-part upload, 5 TiB max object ([source](https://developers.cloudflare.com/r2/platform/limits/)). Zero egress fees make the Deepgram fetch free.
- **Rule for the pipeline: everything ≥ ~100 KB moves by reference.** Workflow event payloads and step results cap at 1 MiB and step results are persisted/replayed — pass `{bucket, key}`; store audio, raw transcript JSON, and analysis artifacts in R2. This also keeps Queues messages (128 KB cap) trivially small.

## 5. Effect 4 beta on the Workers runtime

**Status:** Effect v4 entered **beta on 2026-02-18** ([announcement](https://effect.website/blog/releases/effect/40-beta/)); install via `effect@beta`. As of July 2026 it is **still beta**: "If you're running Effect in production, v3 remains our recommended choice for now," and betas "may include breaking changes"; once stabilized it becomes an LTS release. The `effect-smol` repo has been merged back and `main` of [Effect-TS/effect](https://github.com/Effect-TS/effect) is now v4 ([This Week in Effect 2026-07-17](https://effect.website/blog/this-week-in-effect/2026/07/17/)). No stable release date is committed anywhere in primary sources.

**Why v4 specifically helps on Workers:**

- Rewritten fiber runtime → lower memory (128 MB isolate cap) and faster cold-start-relevant execution.
- **Bundle size: a minimal Effect+Stream+Schema program drops from ~70 kB (v3) to ~20 kB (v4)** — comfortable within the 3 MB (Free) / 10 MB (Paid) compressed script limit.
- Unified package versioning (`@effect/platform` etc. folded into `effect`) removes version-mismatch churn.

**Known friction on workerd (community reports, not primary docs):**

- **Bindings-vs-Layers mismatch:** Cloudflare hands you `env` per request; Effect Layers want up-front construction. Standard pattern: build the runtime per request (or memoize per isolate) with `ManagedRuntime.make` from the request's `env` ([community write-up](https://dev.to/mmlngl/running-effect-ts-in-cloudflare-workers-without-the-pain-40a0)).
- **No cross-request background fibers:** workerd cancels pending work ~30 s after the response unless under `ctx.waitUntil`, and isolates are ephemeral — don't fork long-lived daemon fibers; let Workflows own long-running orchestration ([Workers context docs](https://developers.cloudflare.com/workers/runtime-apis/context/)).
- **OTel exporters:** `BatchSpanProcessor`/`ConsoleSpanExporter` reported incompatible; use Workers-aware tracing ([effect-otel-cf-workers](https://github.com/mmlngl/effect-otel-cf-workers)).
- Use `effect` core + Web-API platform code; avoid `@effect/platform-node` (Node built-ins need `nodejs_compat` and add weight/subtle incompatibilities).
- No open Effect-TS/effect issue was found reporting a hard fiber/timer breakage on workerd; `setTimeout`-based scheduling works within request context. **Not verified by running v4-beta on workerd — do the 1-day spike below.**

## 6. Comparison vs a separate container worker (Fly.io / Railway / VPS near LiveKit)

| Dimension | CF Workflows + Queues | Container worker |
|---|---|---|
| Durability / retries / resume | Built-in (`step.do`, persisted state, replay) | DIY (BullMQ/Temporal/pg-boss) — real code to write and operate |
| Long waits (STT callback, delayed delivery) | `waitForEvent` / `sleep` up to 1 year, free while idle | Process must stay up or persist its own state machine |
| Limits freedom | 1 MiB payloads, 128 MB memory, CPU ≤ 5 min/step, no arbitrary binaries (no ffmpeg) | None of these; run anything (audio transcoding, local Whisper, ffmpeg) |
| Ops surface | Zero servers; deploys via wrangler/IaC; built-in observability | OS/images, patching, scaling, monitoring, queue infra |
| Proximity to LiveKit | Irrelevant for us: egress→R2 and Deepgram→R2 are server-to-server; Workers run at edge | Marginal latency win only if we streamed media through our own process (we don't) |
| Cost at low volume | ~$5/mo Workers Paid; idle time unbilled; R2 egress $0 | Smallest always-on instance ~$5–10/mo + queue/DB infra |
| IaC (Alchemy 2) | First-class: Alchemy supports Workers, Queues, R2, Durable Objects, **Workflows** as TypeScript resources ([alchemy.run](https://alchemy.run/), [example](https://github.com/alchemy-run/alchemy/blob/main/examples/cloudflare-worker/alchemy.run.ts)) | Alchemy is Cloudflare-strongest; Fly/Railway would mean a second IaC path or manual provisioning |
| Effect 4 fit | Beta works but needs the patterns in §5 | Node runtime — zero platform caveats for Effect |

**What we'd lose by staying on Workers:** the ability to run CPU-heavy or binary-dependent media work (ffmpeg transcode, local diarization) in-pipeline. **What we'd gain:** no infrastructure to operate, durable execution for free, and one IaC stack. If in-pipeline media processing ever becomes a requirement, bolt on a single containerized step (Cloudflare Containers or Fly Machine) invoked from a workflow step rather than moving the whole pipeline.

## Recommendation (for ADR #10)

**Adopt Cloudflare Workflows as the pipeline orchestrator**, with Queues in a supporting role (webhook-ingest buffering, Telegram delivery fan-out, always with DLQs), R2 as the artifact store, and strict pass-by-reference between steps:

1. `egress_ended` webhook → verify JWT → enqueue/trigger workflow instance keyed by session ID (idempotent).
2. Workflow: presign R2 audio URL → submit to Deepgram with callback → `step.waitForEvent` (with timeout + poll fallback) → transcript lands in R2 → LLM analysis step (I/O-bound API call) → delivery step → Telegram.
3. Every consumer and handler idempotent (at-least-once everywhere: Queues, Deepgram retries, LiveKit retries).

**Effect 4:** proceed on `effect@beta` behind a thin adapter (per-request `ManagedRuntime`), accepting beta churn since v3 remains the official production recommendation; the v4 bundle/runtime improvements are exactly what Workers wants. **Run a 1-day spike first:** v4-beta on workerd via `wrangler dev` — ManagedRuntime per request, `waitUntil` interop, a Workflow step running an Effect program, and `WebhookReceiver` on workerd.

### Flagged as not verifiable from primary sources

- `livekit-server-sdk` `WebhookReceiver` on workerd (README lists Node/Deno/Bun/browsers only).
- Deepgram fetching from R2 presigned URLs (implied by "any HTTPS URL", not documented explicitly).
- Effect 4 beta behavior on workerd (community patterns are v3-era; no primary-source compatibility statement).
- Effect 4 stabilization timeline (no committed date).
- Typical Deepgram callback payload size for multi-hour audio (no documented figure; treat as multi-MB).

## Sources

- https://developers.cloudflare.com/workflows/ — overview, GA status, step APIs
- https://developers.cloudflare.com/workflows/reference/limits/ — Workflows limits
- https://developers.cloudflare.com/workflows/reference/pricing/ — Workflows pricing
- https://developers.cloudflare.com/changelog/2025-04-07-workflows-ga/ — GA changelog (2025-04-07)
- https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/ — GA announcement
- https://developers.cloudflare.com/queues/platform/limits/ — Queues limits
- https://developers.cloudflare.com/queues/reference/delivery-guarantees/ — at-least-once delivery
- https://developers.cloudflare.com/queues/configuration/dead-letter-queues/ — DLQ behavior
- https://developers.cloudflare.com/workers/platform/limits/ — Workers limits (body size, CPU, bundle, memory)
- https://developers.cloudflare.com/workers/runtime-apis/context/ — `ctx.waitUntil` semantics
- https://developers.cloudflare.com/r2/platform/limits/ — R2 limits
- https://docs.livekit.io/home/server/webhooks/ — webhook events, JWT auth, delivery semantics
- https://docs.livekit.io/home/egress/overview/ — egress types
- https://docs.livekit.io/home/egress/outputs/ — S3-compatible/R2 output config
- https://github.com/livekit/node-sdks/blob/main/packages/livekit-server-sdk/README.md — SDK runtime support, WebhookReceiver raw-body requirement
- https://developers.deepgram.com/docs/callback — async callbacks, retries, dg-token
- https://developers.deepgram.com/docs/pre-recorded-audio — URL vs binary input, 2 GB limit
- https://effect.website/blog/releases/effect/40-beta/ — Effect v4 beta announcement (2026-02-18), bundle numbers, production guidance
- https://effect.website/blog/this-week-in-effect/2026/07/17/ — repo unification status (July 2026)
- https://github.com/Effect-TS/effect — Effect repository (main is v4)
- https://dev.to/mmlngl/running-effect-ts-in-cloudflare-workers-without-the-pain-40a0 — community: Effect on Workers patterns (ManagedRuntime)
- https://github.com/mmlngl/effect-otel-cf-workers — community: OTel-on-Workers workaround
- https://alchemy.run/ and https://github.com/alchemy-run/alchemy — Alchemy IaC, Cloudflare resource coverage (Workers, Queues, R2, Workflows)
