/**
 * Driver for the #17 spike: boots `wrangler dev`, exercises every probe over
 * HTTP, exits non-zero on any failed assertion. Run with `bun drive.ts`.
 */
import { AccessToken } from "livekit-server-sdk"

const PORT = 8788
/**
 * Local mode (default): spawns `wrangler dev`, runs every probe — including the
 * ones relying on module-scope maps (single local isolate).
 * External mode (SPIKE_BASE_URL set): runs against a deployed Worker; skips
 * single-isolate probes, uses a unique run id so instance ids never collide.
 */
const EXTERNAL = process.env.SPIKE_BASE_URL
const BASE = EXTERNAL ?? `http://127.0.0.1:${PORT}`
// Unique per run: workflow instance state persists (prod always; local dev in
// .wrangler/state across restarts), so reused ids read stale instances.
const RUN = `r${Date.now().toString(36)}`

// Must match .dev.vars.
const LIVEKIT_API_KEY = "spike-api-key"
const LIVEKIT_API_SECRET = "spike-api-secret-at-least-32-chars-long"
const GREETING = "hello-from-env"

const failures: string[] = []
let checks = 0

const check = (name: string, condition: boolean, detail?: unknown) => {
  checks += 1
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures.push(name)
    console.error(`FAIL  ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  }
}

const getJson = async (path: string) => (await fetch(`${BASE}${path}`)).json()

const postJson = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${BASE}${path}`, { method: "POST", ...init })
  return { status: response.status, body: await response.json() }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const pollWorkflow = async (id: string, until: (status: any) => boolean, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  let last: any = null
  while (Date.now() < deadline) {
    last = await getJson(`/workflow/${id}`)
    if (until(last)) return last
    await sleep(300)
  }
  return last
}

const signWebhook = async (body: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { ttl: "10m" })
  token.sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return token.toJwt()
}

// --- boot wrangler dev (local mode only) ------------------------------------

const wrangler = EXTERNAL
  ? null
  : Bun.spawn(
      ["bunx", "wrangler", "dev", "--port", String(PORT), "--show-interactive-dev-session", "false"],
      { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" },
    )

const ready = async () => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`)
      if (response.ok) return true
    } catch {
      // not up yet
    }
    await sleep(300)
  }
  return false
}

try {
  if (!(await ready())) {
    console.error("wrangler dev never became ready")
    process.exit(2)
  }

  // --- Checkpoint A: runtime from env, config, waitUntil ---------------------

  console.log("Checkpoint A — per-request runtime on workerd")
  const health = await getJson("/health")
  check("health: greeting comes from env var through Config", health.greeting === `${GREETING}, workerd`, health)
  check("health: secret loaded via Config.redacted", health.secretLength === LIVEKIT_API_SECRET.length, health)
  check("health: runtime built per-request in sane time", typeof health.runtimeMs === "number" && health.runtimeMs < 500, health)

  if (!EXTERNAL) {
    // Module-scope marker — only observable when every request hits one isolate.
    const scheduled = await postJson("/background/bg1")
    check("waitUntil: background effect scheduled", scheduled.body.scheduled === "bg1", scheduled)
    await sleep(400)
    const marker = await getJson("/background/bg1")
    check(
      "waitUntil: background effect completed after response",
      marker.marker === `${GREETING}, background:bg1`,
      marker,
    )
  }

  // --- Checkpoint B: Effect inside a Workflow step ---------------------------

  if (!EXTERNAL) {
    // The flaky-step probe counts attempts in module scope — local-only.
    console.log("Checkpoint B — Effect program inside a Workflow step")
    const plainId = `wf-plain-${RUN}`
    const created = await postJson(`/workflow/${plainId}?flaky=true`)
    check("workflow: instance created", created.body.created === true, created)

    const done = await pollWorkflow(plainId, (s) => s.status === "complete" || s.status === "errored")
    check("workflow: run completed", done?.status === "complete", done)
    check(
      "workflow: step returned Effect program output",
      done?.output?.greeting === `${GREETING}, workflow:${plainId}`,
      done,
    )
    check(
      "workflow: Effect typed error drove a step retry, attempt 2 succeeded",
      done?.output?.flaky?.succeededOnAttempt === 2,
      done,
    )
  }

  // waitForEvent / sendEvent / duplicate-create, valid in both modes.
  console.log("Checkpoint B — waitForEvent / sendEvent / dedupe")
  const eventId = `wf-event-${RUN}`
  const created = await postJson(`/workflow/${eventId}?waitForEvent=true`)
  check("workflow: instance created", created.body.created === true, created)

  // Finding: neither local dev nor production surfaces a distinct "waiting"
  // status while blocked in waitForEvent — both report `running`. Don't build
  // "is it waiting?" logic on instance status; track it in your own state.
  await sleep(1500)
  const waiting = await getJson(`/workflow/${eventId}`)
  check(
    "workflow: instance stays open while blocked in waitForEvent",
    waiting?.status === "running" || waiting?.status === "queued",
    waiting,
  )

  // The instance is provably still open — production rejects a same-id create
  // (the ADR 0001 dedupe guarantee). Local-dev gap: miniflare does not enforce
  // instance-id uniqueness, so local runs can't rely on it.
  const dedupe = await postJson(`/workflow/${eventId}?waitForEvent=true`)
  if (EXTERNAL) {
    check("workflow: same-id create dedupes", dedupe.body.created === false, dedupe)
  } else {
    check("workflow: same-id create does NOT dedupe locally (miniflare gap)", dedupe.body.created === true, dedupe)
  }

  const sent = await postJson(`/workflow/${eventId}/event`, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "resume" }),
  })
  check("workflow: sendEvent accepted", sent.body.sent === true, sent)

  const resumed = await pollWorkflow(eventId, (s) => s.status === "complete" || s.status === "errored")
  check("workflow: waitForEvent resumed with payload", resumed?.output?.received?.payload?.hello === "resume", resumed)
  check(
    "workflow: greet step ran the Effect program",
    resumed?.output?.greeting === `${GREETING}, workflow:${eventId}`,
    resumed,
  )

  // --- Checkpoint C: WebhookReceiver on workerd ------------------------------

  console.log("Checkpoint C — livekit-server-sdk WebhookReceiver on workerd")
  const event = JSON.stringify({
    event: "egress_ended",
    id: "EV_spike1",
    createdAt: Math.floor(Date.now() / 1000),
    egressInfo: { egressId: "EG_spike", roomName: "session-123", status: "EGRESS_COMPLETE" },
  })
  const jwt = await signWebhook(event)

  const accepted = await postJson("/livekit/webhook", {
    headers: { "content-type": "application/webhook+json", Authorization: jwt },
    body: event,
  })
  check("webhook: signed event accepted", accepted.status === 200, accepted)
  check("webhook: event decoded", accepted.body.event === "egress_ended" && accepted.body.egressId === "EG_spike", accepted)

  const tampered = await postJson("/livekit/webhook", {
    headers: { "content-type": "application/webhook+json", Authorization: jwt },
    body: event.replace("EG_spike", "EG_evil"),
  })
  check("webhook: tampered body rejected as 401", tampered.status === 401, tampered)

  const unsigned = await postJson("/livekit/webhook", {
    headers: { "content-type": "application/webhook+json" },
    body: event,
  })
  check("webhook: missing auth rejected as 401", unsigned.status === 401, unsigned)
  // --- Bundle check: the spike's size claim stays re-runnable ----------------

  if (!EXTERNAL) {
    console.log("Bundle — wrangler deploy --dry-run")
    const build = Bun.spawnSync(["bunx", "wrangler", "deploy", "--dry-run", "--outdir", "dist"], {
      cwd: import.meta.dir,
    })
    const output = build.stdout.toString() + build.stderr.toString()
    const size = output.match(/Total Upload: (.+)/)?.[1]
    check("bundle: worker bundles for workerd", build.exitCode === 0 && size !== undefined, output.slice(-300))
    if (size) console.log(`      ${size.trim()}`)
  }
} finally {
  if (wrangler) {
    wrangler.kill()
    await wrangler.exited
  }
}

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) process.exit(1)
