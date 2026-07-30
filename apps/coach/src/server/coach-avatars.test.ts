import { describe, expect, it } from "@effect/vitest"
import { CoachInitData } from "@praximo/auth"
import { AvatarRepo, MemberRepo, QueryFailed } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { AvatarCacheControl, AvatarReader, avatarETag } from "@praximo/storage"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
import { CoachAvatars } from "./coach-avatars.ts"
import { CoachSession } from "./coach-session.ts"
import type { LaunchCredential } from "@/launch-credential.ts"

/**
 * A client's photo, served to the coach who owns them (#231).
 *
 * The property this suite exists for is the tenancy one: the key is read
 * workspace-scoped, so another practice's client id has to answer exactly like a
 * client with no photo — not with somebody else's face, and not with a refusal that
 * tells the caller the id was real.
 */

const BOT_ID = "9100777"
const WORKSPACE = WorkspaceId.make("ws_ada")
const CLIENT_ID = "cl_maria"
/** Somebody else's client, id in hand. */
const FOREIGN_CLIENT_ID = "cl_somebody_else"
const AUTH_DATE = Date.parse("2026-07-30T12:00:00.000Z")
const NOW = AUTH_DATE + 60_000

const KEY = `avatars/client/${CLIENT_ID}/AQADBAADq6cxG4AB-1a2b3c.jpg`
const FOREIGN_KEY = `avatars/client/${FOREIGN_CLIENT_ID}/AQADBAADq6cxG4ZZ-9f8e7d.jpg`
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

const principal = (): MemberRepo.CoachPrincipalRow => ({
  memberId: "mem_ada",
  workspaceId: WORKSPACE,
  language: "en",
  botUsername: "ada_coach_bot",
  telegramBotId: BOT_ID,
  botConnectionStatus: "connected",
  hasMainMiniApp: false,
  settings: {},
  deletionPending: false,
  termsAcceptedAt: new Date(AUTH_DATE - 86_400_000),
  termsVersion: "2026-07-01",
})

const unused = () => Effect.die(new Error("unused in this suite"))

/** One stored row: whose client this is, and the key on it. */
interface AvatarRow {
  readonly workspaceId: WorkspaceId
  readonly key: string
}

/**
 * The column as the statement reads it: scoped by the client id **and** the
 * workspace, so a row belonging to another practice yields nothing rather than its
 * key.
 *
 * The double carries each row's own owner rather than assuming the caller's, because
 * that is the difference the tenancy test is about — a double keyed only on "is this
 * the right workspace" would answer for every id it was handed. The scoping itself is
 * asserted against a real Postgres in `avatar-repo.test.ts`.
 */
const avatarRepo = (
  options: { readonly rows?: Readonly<Record<string, AvatarRow>>; readonly fails?: boolean } = {},
) =>
  Layer.succeed(
    AvatarRepo.Service,
    AvatarRepo.Service.of({
      clientAvatarKey: (workspaceId, clientId) => {
        if (options.fails === true) {
          return Effect.fail(
            new QueryFailed({ operation: "AvatarRepo.clientAvatarKey", cause: "unavailable" }),
          )
        }
        const row = (options.rows ?? {})[clientId]
        return Effect.succeed(row?.workspaceId === workspaceId ? row.key : undefined)
      },
      coachAvatarKey: unused,
      setCoachAvatar: unused,
      setClientAvatar: unused,
      coachAvatarKeyForInvite: unused,
    }),
  )

const members = (row: MemberRepo.CoachPrincipalRow | undefined) =>
  Layer.succeed(
    MemberRepo.Service,
    MemberRepo.Service.of({
      findCoachPrincipalByBot: Effect.fn("MemberRepo.Test.findCoachPrincipalByBot")(
        (telegramBotId) => Effect.succeed(row?.telegramBotId === telegramBotId ? row : undefined),
      ),
      findCoachPrincipalByIdentity: Effect.fn("MemberRepo.Test.findCoachPrincipalByIdentity")(() =>
        Effect.succeed(row),
      ),
      touchLogin: Effect.fn("MemberRepo.Test.touchLogin")(() => Effect.void),
      touchActivity: Effect.fn("MemberRepo.Test.touchActivity")(() => Effect.void),
      acceptTerms: unused,
      setLanguage: unused,
      setTimezone: unused,
      saveSettings: unused,
    }),
  )

interface HarnessOptions {
  readonly member?: MemberRepo.CoachPrincipalRow | undefined
  readonly rows?: Readonly<Record<string, AvatarRow>>
  readonly objects?: Readonly<Record<string, Uint8Array>>
  readonly repoFails?: boolean
}

const run = <A, E>(
  body: Effect.Effect<A, E, CoachAvatars.Service | AvatarReader.TestService>,
  options: HarnessOptions = {},
) => {
  const memberLayer = members("member" in options ? options.member : principal())
  return body.pipe(
    Effect.provide(
      CoachAvatars.layer.pipe(
        Layer.provide(
          CoachSession.layer.pipe(
            Layer.provide(Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), memberLayer)),
          ),
        ),
        Layer.provide(
          avatarRepo({
            ...(options.rows === undefined ? {} : { rows: options.rows }),
            ...(options.repoFails === undefined ? {} : { fails: options.repoFails }),
          }),
        ),
        // Merged rather than provided, so a test can reach the same recorder the
        // service just read through — see `web-acceptance.test.ts` for the same note.
        Layer.provideMerge(AvatarReader.testLayer(options.objects ?? {})),
      ),
    ),
  )
}

const credential = async (): Promise<LaunchCredential> => ({
  initData: await launchFor({ botId: BOT_ID, authDate: AUTH_DATE }),
  botId: BOT_ID,
})

const bucketReads = Effect.flatMap(AvatarReader.TestService, (test) => test.reads())

const held = {
  rows: { [CLIENT_ID]: { workspaceId: WORKSPACE, key: KEY } },
  objects: { [KEY]: BYTES },
}

describe("CoachAvatars.clientPhoto", () => {
  it.effect("serves a client of the coach's own practice", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service

        const served = yield* service.clientPhoto(
          yield* Effect.promise(() => credential()),
          CLIENT_ID,
          null,
        )

        expect(served.status).toBe(200)
        expect(served.body).toBe(BYTES)
        expect(served.headers["Content-Type"]).toBe("image/jpeg")
        expect(served.headers["Cache-Control"]).toBe(AvatarCacheControl)
      }),
      held,
    ),
  )

  it.effect("answers a repeat view from the key, without opening the bucket", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service
        const launch = yield* Effect.promise(() => credential())

        const first = yield* service.clientPhoto(launch, CLIENT_ID, null)
        const second = yield* service.clientPhoto(launch, CLIENT_ID, first.headers.ETag ?? null)

        expect(first.headers.ETag).toBe(avatarETag(KEY))
        expect(second.status).toBe(304)
        // The indexed read the route needs anyway, and nothing else: no R2 on a
        // revisit, which is what makes a roster affordable to re-render.
        expect(yield* bucketReads).toEqual([KEY])
      }),
      held,
    ),
  )

  it.effect("cannot reach a client belonging to another workspace", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service

        const served = yield* service.clientPhoto(
          yield* Effect.promise(() => credential()),
          FOREIGN_CLIENT_ID,
          null,
        )

        // Indistinguishable from a client with no photo, deliberately: the coach
        // learns nothing about whether that id exists, and the screen renders
        // initials either way.
        expect(served.status).toBe(404)
        expect(yield* bucketReads).toEqual([])
      }),
      {
        rows: {
          [CLIENT_ID]: { workspaceId: WORKSPACE, key: KEY },
          // A real row, with a real object behind it, in somebody else's practice.
          [FOREIGN_CLIENT_ID]: {
            workspaceId: WorkspaceId.make("ws_somebody_else"),
            key: FOREIGN_KEY,
          },
        },
        objects: { [KEY]: BYTES, [FOREIGN_KEY]: new Uint8Array([0x01, 0x02]) },
      },
    ),
  )

  it.effect("has one answer for a client of ours who simply has no photo", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service

        const served = yield* service.clientPhoto(
          yield* Effect.promise(() => credential()),
          CLIENT_ID,
          null,
        )

        expect(served.status).toBe(404)
        expect(served.headers["Cache-Control"]).toBe("no-store")
      }),
    ),
  )

  it.effect("refuses a launch no member is bound to, undifferentiated", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service

        const error = yield* Effect.flip(
          service.clientPhoto(yield* Effect.promise(() => credential()), CLIENT_ID, null),
        )

        // The route turns this into a 401, and the disc falls back to initials. It is
        // the same undifferentiated refusal every other read here answers with — an
        // avatar route must not become the oracle that tells coaches apart.
        expect(error._tag).toBe("CoachSession.Unauthenticated")
      }),
      { ...held, member: undefined },
    ),
  )

  it.effect("refuses a launch that carries no credential at all", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service

        const error = yield* Effect.flip(
          service.clientPhoto({ initData: "", botId: "" }, CLIENT_ID, null),
        )

        expect(error._tag).toBe("CoachSession.Unauthenticated")
      }),
      held,
    ),
  )

  it.effect("reports a database that cannot answer rather than claiming no photo", () =>
    run(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachAvatars.Service

        const error = yield* Effect.flip(
          service.clientPhoto(yield* Effect.promise(() => credential()), CLIENT_ID, null),
        )

        // Not a 404: the route answers 503, so a transient outage does not teach a
        // browser to cache "this client has no face".
        expect(error._tag).toBe("CoachSession.LoadFailed")
      }),
      { ...held, repoFails: true },
    ),
  )
})
