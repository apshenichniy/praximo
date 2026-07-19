import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Redacted,
  Schema,
} from "effect"
import { WebhookReceiver } from "livekit-server-sdk"

/**
 * Spike Worker for ticket #17 — verify by running, not deciding:
 *
 *   A. effect@4 beta boots on workerd; per-request ManagedRuntime built from
 *      `env` via ConfigProvider; ctx.waitUntil interop (background effect +
 *      runtime disposal after the response).
 *   B. An Effect program executing inside a Cloudflare Workflow step, including
 *      a deliberate first-attempt failure to see step retries interact with
 *      Effect typed errors, plus waitForEvent/sendEvent (stretch).
 *   C. livekit-server-sdk WebhookReceiver on workerd (README doesn't list
 *      Workers as supported).
 *
 * Driven end-to-end by ../drive.ts against `wrangler dev`.
 */

interface Env {
  readonly GREETING: string
  readonly LIVEKIT_API_KEY: string
  readonly LIVEKIT_API_SECRET: string
  readonly SPIKE_WORKFLOW: Workflow<SpikeParams>
}

// ---------------------------------------------------------------------------
// A tiny service graph, enough to prove config-from-env and layer acquisition.
// ---------------------------------------------------------------------------

interface GreeterInterface {
  readonly greet: (name: string) => Effect.Effect<string>
}

class Greeter extends Context.Service<Greeter, GreeterInterface>()("spike/Greeter") {}

const greeterLayer = Layer.effect(
  Greeter,
  Effect.gen(function* () {
    const greeting = yield* Config.string("GREETING")

    const greet = Effect.fn("Greeter.greet")(function* (name: string) {
      return `${greeting}, ${name}`
    })

    return Greeter.of({ greet })
  }),
)

interface LiveKitWebhooksInterface {
  readonly receive: (
    body: string,
    authHeader: string,
  ) => Effect.Effect<{ event: string; egressId: string }, WebhookRejected>
}

class LiveKitWebhooks extends Context.Service<LiveKitWebhooks, LiveKitWebhooksInterface>()(
  "spike/LiveKitWebhooks",
) {}

class WebhookRejected extends Schema.TaggedErrorClass<WebhookRejected>()(
  "Spike.WebhookRejected",
  { reason: Schema.String },
) {}

const liveKitWebhooksLayer = Layer.effect(
  LiveKitWebhooks,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("LIVEKIT_API_KEY")
    const apiSecret = yield* Config.redacted("LIVEKIT_API_SECRET")
    const receiver = new WebhookReceiver(apiKey, Redacted.value(apiSecret))

    const receive = Effect.fn("LiveKitWebhooks.receive")(function* (
      body: string,
      authHeader: string,
    ) {
      const event = yield* Effect.tryPromise({
        try: () => receiver.receive(body, authHeader),
        catch: (cause) => new WebhookRejected({ reason: String(cause) }),
      })
      return { event: event.event, egressId: event.egressInfo?.egressId ?? "" }
    })

    return LiveKitWebhooks.of({ receive })
  }),
)

const appLayer = Layer.mergeAll(greeterLayer, liveKitWebhooksLayer)

/**
 * The pattern under test (ADR 0001): one ManagedRuntime per request / workflow
 * run, its ConfigProvider reading the Worker `env` object.
 */
const makeRuntime = (env: Env) =>
  ManagedRuntime.make(
    appLayer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
  )

// ---------------------------------------------------------------------------
// Module-scope probes. Local dev runs a single isolate, so the fetch handler
// and the workflow engine share these maps — good enough for spike assertions.
// ---------------------------------------------------------------------------

const backgroundMarkers = new Map<string, string>()
const flakyAttempts = new Map<string, number>()

class FlakyFailure extends Schema.TaggedErrorClass<FlakyFailure>()("Spike.FlakyFailure", {
  instanceId: Schema.String,
  attempt: Schema.Number,
}) {}

// ---------------------------------------------------------------------------
// Workflow: an Effect program inside step.do, step retries driven by an Effect
// typed error, and (stretch) waitForEvent resumed via instance.sendEvent.
// ---------------------------------------------------------------------------

interface SpikeParams {
  readonly waitForEvent: boolean
  /**
   * The flaky-step probe counts attempts in module scope, which only holds in
   * single-isolate local dev — on real Cloudflare a retry may land on a fresh
   * isolate and never reach attempt 2. The driver enables it locally only.
   */
  readonly flaky: boolean
}

export class SpikeWorkflow extends WorkflowEntrypoint<Env, SpikeParams> {
  override async run(event: Readonly<WorkflowEvent<SpikeParams>>, step: WorkflowStep) {
    const runtime = makeRuntime(this.env)
    try {
      const greeting = await step.do("greet-in-effect", () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const greeter = yield* Greeter
            return yield* greeter.greet(`workflow:${event.instanceId}`)
          }),
        ),
      )

      let flaky: unknown = null
      if (event.payload.flaky) {
        flaky = await step.do(
          "flaky-effect",
          { retries: { limit: 3, delay: 200, backoff: "constant" } },
          () =>
            runtime.runPromise(
              Effect.gen(function* () {
                const attempt = (flakyAttempts.get(event.instanceId) ?? 0) + 1
                flakyAttempts.set(event.instanceId, attempt)
                if (attempt === 1) {
                  return yield* new FlakyFailure({ instanceId: event.instanceId, attempt })
                }
                return { succeededOnAttempt: attempt }
              }),
            ),
        )
      }

      let received: unknown = null
      if (event.payload.waitForEvent) {
        received = await step.waitForEvent("resume-signal", {
          type: "spike-event",
          timeout: "2 minutes",
        })
      }

      return { greeting, flaky, received }
    } finally {
      await runtime.dispose()
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch handler: per-request runtime, disposed via ctx.waitUntil after the
// response is produced.
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

interface WebhookOutcome {
  readonly status: number
  readonly body: unknown
}

const route = async (
  request: Request,
  env: Env,
  runtime: ReturnType<typeof makeRuntime>,
  schedule: (work: Promise<unknown>) => void,
): Promise<Response> => {
  const url = new URL(request.url)
  const [, root, id, action] = url.pathname.split("/")

  // A: runtime boots, config read from env (var + .dev.vars secret). Note:
  // runtimeMs is only meaningful locally — deployed workerd freezes the clock
  // between I/O, so production reports ~0 by design.
  if (request.method === "GET" && root === "health") {
    const started = performance.now()
    const body = await runtime.runPromise(
      Effect.gen(function* () {
        const greeter = yield* Greeter
        const greeting = yield* greeter.greet("workerd")
        const secret = yield* Config.redacted("LIVEKIT_API_SECRET")
        return { greeting, secretLength: Redacted.value(secret).length }
      }),
    )
    return json({ ...body, runtimeMs: Math.round((performance.now() - started) * 100) / 100 })
  }

  // A: fire-and-forget Effect finishing after the response, via waitUntil.
  if (request.method === "POST" && root === "background" && id) {
    schedule(
      runtime.runPromise(
        Effect.gen(function* () {
          const greeter = yield* Greeter
          const value = yield* greeter.greet(`background:${id}`)
          yield* Effect.sleep("50 millis")
          backgroundMarkers.set(id, value)
        }),
      ),
    )
    return json({ scheduled: id })
  }

  if (request.method === "GET" && root === "background" && id) {
    return json({ marker: backgroundMarkers.get(id) ?? null })
  }

  // B: create (dedupe on deterministic id), poll status, send event.
  if (request.method === "POST" && root === "workflow" && id && !action) {
    try {
      await env.SPIKE_WORKFLOW.create({
        id,
        params: {
          waitForEvent: url.searchParams.get("waitForEvent") === "true",
          flaky: url.searchParams.get("flaky") === "true",
        },
      })
      return json({ created: true })
    } catch (cause) {
      return json({ created: false, reason: String(cause) }, 409)
    }
  }

  if (request.method === "GET" && root === "workflow" && id && !action) {
    const instance = await env.SPIKE_WORKFLOW.get(id)
    return json(await instance.status())
  }

  if (request.method === "POST" && root === "workflow" && id && action === "event") {
    const instance = await env.SPIKE_WORKFLOW.get(id)
    await instance.sendEvent({ type: "spike-event", payload: await request.json() })
    return json({ sent: true })
  }

  // C: WebhookReceiver on workerd.
  if (request.method === "POST" && root === "livekit" && id === "webhook") {
    const body = await request.text()
    const authHeader = request.headers.get("Authorization") ?? ""
    const outcome = await runtime.runPromise(
      Effect.gen(function* () {
        const webhooks = yield* LiveKitWebhooks
        return yield* webhooks.receive(body, authHeader).pipe(
          Effect.map((accepted): WebhookOutcome => ({ status: 200, body: accepted })),
          Effect.catchTag(
            "Spike.WebhookRejected",
            (rejected): Effect.Effect<WebhookOutcome> =>
              Effect.succeed({ status: 401, body: { rejected: rejected.reason } }),
          ),
        )
      }),
    )
    return json(outcome.body, outcome.status)
  }

  return json({ error: "not found" }, 404)
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const runtime = makeRuntime(env)
    // Routes may schedule work to finish after the response; the runtime is
    // disposed exactly once, after the response and any scheduled work — the
    // per-request pattern ADR 0001 commits to.
    let pending: Promise<unknown> = Promise.resolve()
    try {
      return await route(request, env, runtime, (work) => {
        pending = work
      })
    } catch (cause) {
      return json({ error: String(cause) }, 500)
    } finally {
      ctx.waitUntil(pending.finally(() => runtime.dispose()))
    }
  },
} satisfies ExportedHandler<Env>
