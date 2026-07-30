import { describe, expect, it } from "@effect/vitest"
import { AvatarRepo, ClientAcceptanceRepo, QueryFailed } from "@praximo/db"
import { AvatarCacheControl, AvatarReader, avatarETag } from "@praximo/storage"
import { Effect, Layer, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"

import { WebAcceptance } from "./web-acceptance.ts"

const TOKEN = "23456789ABCD"
const NOW = Date.parse("2026-07-30T09:00:00.000Z")

/** The coach's photo, as the bot's refresh left it (#225). */
const COACH_KEY = "avatars/coach/ws_ada/AQADBAADq6cxG4AB-1a2b3c.jpg"
const COACH_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

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
  coachHasPhoto: false,
  ...overrides,
})

interface HarnessOptions {
  /** The key `coachAvatarKeyForInvite` resolves this token to, if any. */
  readonly coachAvatarKey?: string
  /** Which objects the bucket actually holds. */
  readonly objects?: Readonly<Record<string, Uint8Array>>
}

const makeRepoHarness = (
  initial: ClientAcceptanceRepo.InviteLookup | undefined,
  options: HarnessOptions = {},
) =>
  Effect.gen(function* () {
    const found = yield* Ref.make<ClientAcceptanceRepo.InviteLookup | undefined>(initial)
    const lookupFails = yield* Ref.make(false)
    const acceptFails = yield* Ref.make(false)
    const avatarFails = yield* Ref.make(false)
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
    /**
     * The avatar column, as this surface reads it: one token, one key, and the
     * `workspace`-over-`member` order is the statement's business rather than
     * this double's — `avatar-repo.test.ts` pins that against a real Postgres.
     */
    const avatarRepo = Layer.succeed(
      AvatarRepo.Service,
      AvatarRepo.Service.of({
        coachAvatarKeyForInvite: (token) =>
          Effect.gen(function* () {
            if (yield* Ref.get(avatarFails)) {
              return yield* Effect.fail(
                new QueryFailed({
                  operation: "AvatarRepo.coachAvatarKeyForInvite",
                  cause: new Error("database unavailable"),
                }),
              )
            }
            return token === TOKEN ? options.coachAvatarKey : undefined
          }),
        coachAvatarKey: unsupported,
        setCoachAvatar: unsupported,
        clientAvatarKey: unsupported,
        setClientAvatar: unsupported,
      }),
    )
    // `provideMerge` rather than `provide`, so a test can reach the *same* recorder
    // the service just read through. Two `Effect.provide(bucket)` calls would build
    // two of them, and an assertion about "the bucket was never opened" would then
    // be reading an array nobody wrote to.
    const app = WebAcceptance.layer.pipe(
      Layer.provide(repo),
      Layer.provide(avatarRepo),
      Layer.provideMerge(AvatarReader.testLayer(options.objects ?? {})),
    )
    return {
      found,
      lookupFails,
      acceptFails,
      avatarFails,
      writes,
      run: <A, E>(effect: Effect.Effect<A, E, WebAcceptance.Service | AvatarReader.TestService>) =>
        effect.pipe(Effect.provide(app)),
    }
  })

/** Every key the bucket was asked for — `[]` is what a 304 has to cost. */
const bucketReads = Effect.flatMap(AvatarReader.TestService, (test) => test.reads())

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

  /**
   * The coach's photo, which the page shows beside their name (#231).
   *
   * Authorised by the invitation and nothing else — there is no session on this
   * surface — so the interesting cases are about what a token does and does not
   * open, and about the request a second view is allowed to cost.
   */
  describe("the coach's photo", () => {
    const held = { coachAvatarKey: COACH_KEY, objects: { [COACH_KEY]: COACH_BYTES } }

    it.effect("says on the page itself whether there is one to ask for", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const withPhoto = yield* makeRepoHarness(lookup({ coachHasPhoto: true }))
        const without = yield* makeRepoHarness(lookup())

        const open = (harness: typeof withPhoto) =>
          harness.run(Effect.flatMap(WebAcceptance.Service, (s) => s.open(TOKEN, "en")))

        // A flag rather than a key, so no object key reaches the HTML — and rather
        // than letting the image 404, so a coach without a photo costs no request
        // and their initials are never replaced a beat after the page settled.
        expect(yield* open(withPhoto)).toMatchObject({ kind: "open", coachHasPhoto: true })
        expect(yield* open(without)).toMatchObject({ kind: "open", coachHasPhoto: false })
        expect(JSON.stringify(yield* open(withPhoto))).not.toContain(COACH_KEY)
      }),
    )

    it.effect("carries the flag onto the refusals and the confirmation too", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const spent = yield* makeRepoHarness(lookup({ status: "accepted", coachHasPhoto: true }))
        const open = yield* makeRepoHarness(lookup({ coachHasPhoto: true }))

        // Every screen that names the coach shows their face: a spent link still
        // says who to ask, and the confirmation is the one that reads as a
        // continuation of their conversation.
        expect(
          yield* spent.run(Effect.flatMap(WebAcceptance.Service, (s) => s.open(TOKEN, "en"))),
        ).toMatchObject({ kind: "already-accepted", coachHasPhoto: true })
        expect(
          yield* open.run(Effect.flatMap(WebAcceptance.Service, (s) => s.accept(acceptInput()))),
        ).toMatchObject({ kind: "accepted", view: { coachHasPhoto: true } })
      }),
    )

    it.effect("serves the bytes for a token that resolves to a coach with a photo", () =>
      Effect.gen(function* () {
        const repo = yield* makeRepoHarness(lookup({ coachHasPhoto: true }), held)

        const served = yield* repo.run(
          Effect.flatMap(WebAcceptance.Service, (s) => s.coachPhoto(TOKEN, null)),
        )

        expect(served.status).toBe(200)
        expect(served.body).toBe(COACH_BYTES)
        expect(served.headers["Content-Type"]).toBe("image/jpeg")
        expect(served.headers["Cache-Control"]).toBe(AvatarCacheControl)
      }),
    )

    it.effect("answers a repeat view without opening the bucket", () =>
      Effect.gen(function* () {
        const repo = yield* makeRepoHarness(lookup({ coachHasPhoto: true }), held)

        const outcome = yield* repo.run(
          Effect.gen(function* () {
            const acceptance = yield* WebAcceptance.Service
            const first = yield* acceptance.coachPhoto(TOKEN, null)
            const second = yield* acceptance.coachPhoto(TOKEN, first.headers.ETag ?? null)
            return { first, second, reads: yield* bucketReads }
          }),
        )

        expect(outcome.first.headers.ETag).toBe(avatarETag(COACH_KEY))
        expect(outcome.second.status).toBe(304)
        // One read for the first view and none for the second: the validator is
        // derived from the key, so the comparison happens before R2 is involved.
        expect(outcome.reads).toEqual([COACH_KEY])
      }),
    )

    it.effect("discloses nothing for a token nobody issued", () =>
      Effect.gen(function* () {
        const repo = yield* makeRepoHarness(undefined, held)

        const served = yield* repo.run(
          Effect.flatMap(WebAcceptance.Service, (s) => s.coachPhoto("ZZZZZZZZZZZZ", null)),
        )

        expect(served.status).toBe(404)
        expect(yield* repo.run(bucketReads)).toEqual([])
      }),
    )

    it.effect("shows initials rather than a stack trace when the database is down", () =>
      Effect.gen(function* () {
        const repo = yield* makeRepoHarness(lookup({ coachHasPhoto: true }), held)

        const served = yield* repo.run(
          Effect.gen(function* () {
            yield* Ref.set(repo.avatarFails, true)
            return yield* Effect.flatMap(WebAcceptance.Service, (s) => s.coachPhoto(TOKEN, null))
          }),
        )

        // The same rule `open` follows: a repository that cannot answer becomes "no
        // photo", because a client can act on neither and the page that admits
        // least leaks least.
        expect(served.status).toBe(404)
      }),
    )
  })
})
