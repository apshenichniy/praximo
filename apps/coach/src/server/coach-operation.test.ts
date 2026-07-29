import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { CoachClients } from "./coach-clients.ts"
import {
  coachConveyor,
  coachInput,
  type CoachRunner,
  TransportNumber,
  TransportString,
  TransportValue,
} from "./coach-operation.ts"
import { CoachSession } from "./coach-session.ts"
import { CoachSurface } from "./coach-surface.ts"
import type { LaunchCredential } from "./launch-credential.ts"

const CREDENTIAL: LaunchCredential = { initData: "signed", botId: "9100777" }
const BLANK: LaunchCredential = { initData: "", botId: "" }

/**
 * The runtime, as something a test can watch rather than something a test needs.
 *
 * `runs` is the whole point of the first two cases below: "a blank credential is
 * refused" is a weaker claim than "a blank credential is refused *before the
 * runtime is touched*", and only a runner that counts its calls can tell them
 * apart.
 */
const watched = (answer: () => Promise<unknown>) => {
  const runs: Array<unknown> = []
  const run: CoachRunner = async (effect) => {
    runs.push(effect)
    return (await answer()) as never
  }
  return { runs, ...coachConveyor(run) }
}

const succeeding = (value: unknown) => watched(() => Promise.resolve(value))
const failing = (error: unknown) => watched(() => Promise.reject(error))

/** One operation over whichever runtime the case handed it. */
const entry = (conveyor: ReturnType<typeof watched>) =>
  conveyor.operation({
    run: (credential) => Effect.flatMap(CoachSurface.Service, (s) => s.openApp(credential)),
    answer: (value) => ({ ok: true as const, entry: value }),
  })

const acknowledged = (conveyor: ReturnType<typeof watched>) =>
  conveyor.acknowledgement({
    run: (credential) =>
      Effect.flatMap(CoachClients.Service, (s) => s.hideMainMiniAppHint(credential)),
    acknowledged: () => true,
  })

/** An operation that names a failure of its own, beside the two it cannot rename. */
const named = (conveyor: ReturnType<typeof watched>) =>
  conveyor.operation({
    failures: { "CoachSurface.StaleTermsVersion": "stale" },
    run: (credential) => Effect.flatMap(CoachSurface.Service, (s) => s.openApp(credential)),
    answer: (value) => ({ ok: true as const, entry: value }),
  })

const recorded = (conveyor: ReturnType<typeof watched>) =>
  conveyor.acknowledgement({
    run: (credential) =>
      Effect.flatMap(CoachClients.Service, (s) => s.recordDelivery(credential, "cl_1", "bot")),
    acknowledged: ({ recorded: written }) => written,
  })

describe("the coach conveyor", () => {
  it("refuses a blank credential without touching the runtime", async () => {
    const conveyor = succeeding({ kind: "home" })

    expect(await entry(conveyor)({ context: { credential: BLANK }, data: undefined })).toEqual({
      ok: false,
      error: "unauthenticated",
    })
    expect(conveyor.runs).toEqual([])
  })

  it("refuses a blank credential on an acknowledgement, also without touching it", async () => {
    const conveyor = succeeding(undefined)

    expect(
      await acknowledged(conveyor)({ context: { credential: BLANK }, data: undefined }),
    ).toEqual({ ok: false })
    expect(conveyor.runs).toEqual([])
  })

  it("runs the effect once a credential is present", async () => {
    const conveyor = succeeding({ kind: "home" })

    expect(await entry(conveyor)({ context: { credential: CREDENTIAL }, data: undefined })).toEqual(
      {
        ok: true,
        entry: { kind: "home" },
      },
    )
    expect(conveyor.runs).toHaveLength(1)
  })

  /**
   * ADR 0006's undifferentiated refusal, pinned in the one place it now lives.
   * Every other failure — including the ones an operation names for itself — has
   * to arrive as something a caller cannot mistake for a rejected credential.
   */
  it("maps only CoachSession.Unauthenticated to unauthenticated", async () => {
    const refusal = async (error: unknown) =>
      await entry(failing(error))({ context: { credential: CREDENTIAL }, data: undefined })

    expect(await refusal(new CoachSession.Unauthenticated())).toEqual({
      ok: false,
      error: "unauthenticated",
    })
    expect(await refusal(new CoachSession.LoadFailed({ operation: "openApp" }))).toEqual({
      ok: false,
      error: "server",
    })
    expect(await refusal(new CoachSurface.StaleTermsVersion({ current: "v2" }))).toEqual({
      ok: false,
      error: "server",
    })
    expect(await refusal(new CoachClients.InvalidClient())).toEqual({ ok: false, error: "server" })
    expect(await refusal(new Error("boom"))).toEqual({ ok: false, error: "server" })
    expect(await refusal({ _tag: "Unauthenticated" })).toEqual({ ok: false, error: "server" })
    expect(await refusal(undefined)).toEqual({ ok: false, error: "server" })
  })

  it("lets an operation name its own failures without unnaming the shared one", async () => {
    const refusal = async (error: unknown) =>
      await named(failing(error))({ context: { credential: CREDENTIAL }, data: undefined })

    expect(await refusal(new CoachSurface.StaleTermsVersion({ current: "v2" }))).toEqual({
      ok: false,
      error: "stale",
    })
    expect(await refusal(new CoachSession.Unauthenticated())).toEqual({
      ok: false,
      error: "unauthenticated",
    })
    expect(await refusal(new CoachSession.LoadFailed({ operation: "openApp" }))).toEqual({
      ok: false,
      error: "server",
    })
  })

  it("carries an acknowledgement's own answer and swallows nothing else", async () => {
    const at = { context: { credential: CREDENTIAL }, data: undefined }

    expect(await recorded(succeeding({ recorded: true }))(at)).toEqual({ ok: true })
    expect(await recorded(succeeding({ recorded: false }))(at)).toEqual({ ok: false })
    expect(await recorded(failing(new CoachSession.Unauthenticated()))(at)).toEqual({ ok: false })
  })
})

describe("reading what the browser sent", () => {
  const read = coachInput(
    Schema.Struct({
      clientId: TransportString,
      days: TransportNumber(1),
      hours: TransportValue,
    }),
  )

  it("hands the far side the value it refuses, whatever arrives", () => {
    const absent = { clientId: "", days: 1, hours: undefined }

    expect(read({ clientId: "cl_1", days: 14, hours: { mon: [] } })).toEqual({
      clientId: "cl_1",
      days: 14,
      hours: { mon: [] },
    })
    // A field that is not what it claims falls back on its own, so a readable
    // sibling still arrives.
    expect(read({ clientId: "cl_1", days: "fortnight" })).toEqual({ ...absent, clientId: "cl_1" })
    expect(read({ days: Number.NaN })).toEqual(absent)
    expect(read({})).toEqual(absent)
    expect(read(undefined)).toEqual(absent)
    expect(read("cl_1")).toEqual(absent)
    expect(read([])).toEqual(absent)
  })

  it("keeps nothing the shape did not ask for", () => {
    expect(read({ clientId: "cl_1", workspaceId: "ws_other" })).toEqual({
      clientId: "cl_1",
      days: 1,
      hours: undefined,
    })
  })
})
