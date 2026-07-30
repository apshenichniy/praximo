import { describe, expect, it } from "@effect/vitest"
import { ClientAcceptanceRepo, QueryFailed } from "@praximo/db"
import { Effect, Layer, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"

import { WebAcceptance } from "./web-acceptance.ts"

const TOKEN = "23456789ABCD"
const NOW = Date.parse("2026-07-30T09:00:00.000Z")

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const lookup = (
  overrides: Partial<ClientAcceptanceRepo.InviteLookup> = {},
): ClientAcceptanceRepo.InviteLookup => ({
  inviteId: "iv_1",
  clientId: "cl_1",
  clientName: "Maria K.",
  workspaceId: "ws_ada",
  status: "pending",
  expiresAt: new Date("2026-08-06T09:00:00.000Z"),
  inviteLanguage: "uk",
  coachName: "Ada Coaching",
  ...overrides,
})

const makeRepoHarness = (initial: ClientAcceptanceRepo.InviteLookup | undefined) =>
  Effect.gen(function* () {
    const found = yield* Ref.make<ClientAcceptanceRepo.InviteLookup | undefined>(initial)
    const lookupFails = yield* Ref.make(false)
    const acceptFails = yield* Ref.make(false)
    const writes = yield* Ref.make<ReadonlyArray<ClientAcceptanceRepo.ClaimInput>>([])
    const repo = Layer.succeed(
      ClientAcceptanceRepo.Service,
      ClientAcceptanceRepo.Service.of({
        findByToken: unsupported,
        findByWebToken: (token) =>
          Effect.gen(function* () {
            if (yield* Ref.get(lookupFails)) {
              return yield* Effect.fail(
                new QueryFailed({
                  operation: "clientAcceptance.findByWebToken",
                  cause: new Error("database unavailable"),
                }),
              )
            }
            return token === TOKEN ? yield* Ref.get(found) : undefined
          }),
        findBotOwner: unsupported,
        findAcceptedClient: unsupported,
        claim: (input) =>
          Effect.gen(function* () {
            if (yield* Ref.get(acceptFails)) {
              return yield* Effect.fail(
                new QueryFailed({
                  operation: "clientAcceptance.claim",
                  cause: new Error("database unavailable"),
                }),
              )
            }
            yield* Ref.update(writes, (previous) => [...previous, input])
            return { accepted: true } as const
          }),
      }),
    )
    return {
      found,
      lookupFails,
      acceptFails,
      writes,
      run: <A, E>(effect: Effect.Effect<A, E, WebAcceptance.Service>) =>
        effect.pipe(Effect.provide(WebAcceptance.layer.pipe(Layer.provide(repo)))),
    }
  })

const acceptInput = (
  overrides: Partial<WebAcceptance.AcceptInput> = {},
): WebAcceptance.AcceptInput => ({
  token: TOKEN,
  name: "Maria",
  email: "maria@example.com",
  language: "uk",
  ...overrides,
})

describe("WebAcceptance", () => {
  it.effect("writes the trimmed client address to the Channel through the web Door", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const repo = yield* makeRepoHarness(lookup())
      const outcome = yield* repo.run(
        Effect.gen(function* () {
          const acceptance = yield* WebAcceptance.Service
          return yield* acceptance.accept(acceptInput({ email: "  maria@example.com  " }))
        }),
      )

      expect(outcome).toMatchObject({
        kind: "accepted",
        view: { email: "maria@example.com" },
      })
      expect((yield* Ref.get(repo.writes))[0]?.identity).toEqual({
        kind: "email",
        address: "maria@example.com",
        clientName: "Maria",
      })
    }),
  )

  it.effect("hands claim the language selected after Invite Delivery", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const repo = yield* makeRepoHarness(lookup({ inviteLanguage: "uk" }))

      yield* repo.run(
        Effect.gen(function* () {
          const acceptance = yield* WebAcceptance.Service
          expect(yield* acceptance.open(TOKEN, "en")).toMatchObject({
            kind: "open",
            language: "uk",
          })

          // The Invite Delivery opened the Acceptance Page in Ukrainian. The
          // client then selected Russian, which is the text they were shown.
          expect(yield* acceptance.accept(acceptInput({ language: "ru" }))).toMatchObject({
            kind: "accepted",
          })
        }),
      )

      expect(yield* Ref.get(repo.writes)).toMatchObject([{ language: "ru" }])
    }),
  )

  it.effect("refuses an Invite that flips to accepted before the web Door commit", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const repo = yield* makeRepoHarness(lookup())

      const outcome = yield* repo.run(
        Effect.gen(function* () {
          const acceptance = yield* WebAcceptance.Service
          expect(yield* acceptance.open(TOKEN, "en")).toMatchObject({ kind: "open" })

          yield* Ref.set(repo.found, lookup({ status: "accepted" }))
          return yield* acceptance.accept(acceptInput())
        }),
      )

      expect(outcome).toEqual({ kind: "stale" })
      expect(yield* Ref.get(repo.writes)).toEqual([])
    }),
  )

  it.effect("turns an Invite repository failure into stale at the web Door", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const repo = yield* makeRepoHarness(lookup())

      const outcomes = yield* repo.run(
        Effect.gen(function* () {
          const acceptance = yield* WebAcceptance.Service
          yield* Ref.set(repo.lookupFails, true)
          const lookupFailure = yield* acceptance.accept(acceptInput())
          yield* Ref.set(repo.lookupFails, false)
          yield* Ref.set(repo.acceptFails, true)
          const commitFailure = yield* acceptance.accept(acceptInput())
          return [lookupFailure, commitFailure]
        }),
      )

      expect(outcomes).toEqual([{ kind: "stale" }, { kind: "stale" }])
      expect(yield* Ref.get(repo.writes)).toEqual([])
    }),
  )

  it.effect("applies Invite refusal rules identically on open and accept at the web Door", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const repo = yield* makeRepoHarness(lookup())
      const cases = [
        {
          found: lookup({ status: "accepted" }),
          openKind: "already-accepted",
        },
        {
          found: lookup({ status: "expired" }),
          openKind: "superseded",
        },
        {
          found: lookup({ expiresAt: new Date(NOW) }),
          openKind: "expired",
        },
      ] as const

      yield* repo.run(
        Effect.gen(function* () {
          const acceptance = yield* WebAcceptance.Service

          for (const current of cases) {
            yield* Ref.set(repo.found, current.found)
            expect(yield* acceptance.open(TOKEN, "en")).toMatchObject({
              kind: current.openKind,
            })
            expect(yield* acceptance.accept(acceptInput())).toEqual({ kind: "stale" })
          }
        }),
      )

      expect(yield* Ref.get(repo.writes)).toEqual([])
    }),
  )

  it.effect("applies ClientName when an Invite passes through the web Door", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const repo = yield* makeRepoHarness(lookup())

      const outcomes = yield* repo.run(
        Effect.gen(function* () {
          const acceptance = yield* WebAcceptance.Service
          return [
            yield* acceptance.accept(acceptInput({ name: ` ${"M".repeat(80)} ` })),
            yield* acceptance.accept(acceptInput({ name: "M".repeat(81) })),
          ] as const
        }),
      )

      expect(outcomes).toEqual([
        expect.objectContaining({ kind: "accepted" }),
        { kind: "invalid", field: "name" },
      ])
      expect(yield* Ref.get(repo.writes)).toHaveLength(1)
      expect((yield* Ref.get(repo.writes))[0]?.identity).toMatchObject({
        kind: "email",
        clientName: "M".repeat(80),
      })
    }),
  )
})
