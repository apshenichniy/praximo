import { describe, expect, it } from "@effect/vitest"
import { CoachInitData } from "@praximo/auth"
import { ClientRepo, MemberRepo, SessionRepo } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { BotRegistry } from "@praximo/telegram"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { CoachClients } from "./coach-clients.ts"
import { CoachSession } from "./coach-session.ts"
import type { LaunchCredential } from "./launch-credential.ts"

/**
 * The invitation card (#179): the coach's own bot authors the message, and
 * nothing on the way there takes the caller's word for anything.
 *
 * The invitation is resolved from the authenticated coach's own workspace, so
 * the browser only ever names a client — a client id from another workspace
 * reads as "nothing to share" at the repository, which is the second fence
 * rather than the first.
 */

const BOT_ID = "9100777"
const BOT_USERNAME = "ada_coach_bot"
const WORKSPACE = WorkspaceId.make("ws_ada")
const AUTH_DATE = Date.parse("2026-07-26T12:00:00.000Z")
const NOW = AUTH_DATE + 60_000
const TOKEN = "ABCDEFGH2345"

const principal: MemberRepo.CoachPrincipalRow = {
  memberId: "mem_ada",
  workspaceId: WORKSPACE,
  language: "en",
  botUsername: BOT_USERNAME,
  telegramBotId: BOT_ID,
  botConnectionStatus: "connected",
  hasMainMiniApp: false,
  settings: {},
  deletionPending: false,
  termsAcceptedAt: new Date(AUTH_DATE - 24 * 60 * 60 * 1_000),
}

const invite = (
  status: ClientRepo.ClientInviteRow["status"],
): ClientRepo.ClientInviteRow => ({
  id: "iv_1",
  token: TOKEN,
  status,
  expiresAt: new Date(NOW + 7 * 24 * 60 * 60 * 1_000),
  language: "en",
})

const client = (
  overrides: Partial<ClientRepo.ClientDetailRow> = {},
): ClientRepo.ClientDetailRow => ({
  id: "cl_anna",
  name: "Anna",
  state: "invited",
  createdAt: new Date(NOW),
  invite: invite("pending"),
  sessions: [],
  canDelete: true,
  ...overrides,
})

const unused = () => Effect.die(new Error("unused in this suite"))

const run = <A, E>(
  row: ClientRepo.ClientDetailRow | undefined,
  body: Effect.Effect<A, E, CoachClients.Service | BotRegistry.TestService>,
) => {
  const members = Layer.succeed(
    MemberRepo.Service,
    MemberRepo.Service.of({
      findCoachPrincipalByBot: Effect.fn("MemberRepo.Test.findCoachPrincipalByBot")(
        (telegramBotId) =>
          Effect.succeed(telegramBotId === BOT_ID ? principal : undefined),
      ),
      findCoachPrincipalByIdentity: Effect.fn("MemberRepo.Test.findCoachPrincipalByIdentity")(() =>
        Effect.succeed(principal),
      ),
      touchLogin: Effect.fn("MemberRepo.Test.touchLogin")(() => Effect.void),
      touchActivity: Effect.fn("MemberRepo.Test.touchActivity")(() => Effect.void),
      acceptTerms: unused,
      setLanguage: unused,
      setTimezone: unused,
      saveSettings: unused,
    }),
  )
  const clients = Layer.succeed(
    ClientRepo.Service,
    ClientRepo.Service.of({
      createWithInvite: unused,
      list: unused,
      // Scoped by the workspace the principal produced, exactly as the real
      // query is: a client of another coach is simply not there.
      find: Effect.fn("ClientRepo.Test.find")((workspaceId, clientId) =>
        Effect.succeed(workspaceId === WORKSPACE && clientId === row?.id ? row : undefined),
      ),
      deleteUnaccepted: unused,
      reissueInvite: unused,
    }),
  )
  const sessions = Layer.succeed(
    SessionRepo.Service,
    SessionRepo.Service.of({ schedule: unused, between: unused }),
  )

  return body.pipe(
    Effect.provide(
      Layer.mergeAll(
        CoachClients.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              members,
              clients,
              sessions,
              BotRegistry.testLayer,
              CoachSession.layer.pipe(
                Layer.provide(
                  Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), members),
                ),
              ),
            ),
          ),
        ),
        BotRegistry.testLayer,
      ),
    ),
  )
}

const credential = async (): Promise<LaunchCredential> => ({
  initData: await launchFor({ botId: BOT_ID, authDate: AUTH_DATE }),
  botId: BOT_ID,
})

describe("preparing the invitation card", () => {
  it.effect("asks the coach's own bot for a card whose button is the deep link", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const prepared = yield* service.prepareInviteCard(
          yield* Effect.promise(() => credential()),
          "cl_anna",
        )

        const stub = yield* BotRegistry.TestService
        const [minted] = yield* stub.prepared()
        // The coach's own bot, named by the workspace the launch authenticated.
        expect(minted?.workspace).toBe(WORKSPACE)
        // Into that same bot, and carrying the invitation's own token.
        expect(minted?.card.buttonUrl).toBe(
          `https://t.me/${BOT_USERNAME}?start=inv_${TOKEN}`,
        )
        // The sentence the screen shows and the copy button copies — one
        // invitation cannot say three different things.
        expect(minted?.card.text).toBe(
          `Anna${coachCopy("en").clients.invitationLeadTail}`,
        )
        // The link is the button, so the body never repeats it.
        expect(minted?.card.text).not.toContain("t.me")
        expect(prepared?.preparedMessageId).toBe("prepared-card-0")
        expect(prepared?.expiresAt).toBe(
          new Date(NOW + BotRegistry.PreparedCardLifetimeMillis).toISOString(),
        )
      }),
    ),
  )

  // A tap on a screen that has gone stale mints nothing: an accepted invitation
  // has no door left to open, and a card carrying its token would be a button
  // that fails in the client's chat.
  it.effect("mints nothing once the invitation is no longer open", () =>
    run(
      client({ state: "accepted", invite: invite("accepted") }),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const prepared = yield* service.prepareInviteCard(
          yield* Effect.promise(() => credential()),
          "cl_anna",
        )

        expect(prepared).toBeUndefined()
        expect(yield* Effect.flatMap(BotRegistry.TestService, (stub) => stub.prepared())).toEqual([])
      }),
    ),
  )

  it.effect("mints nothing for a client this coach's workspace does not own", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const prepared = yield* service.prepareInviteCard(
          yield* Effect.promise(() => credential()),
          "cl_someone_else",
        )

        expect(prepared).toBeUndefined()
      }),
    ),
  )

  // A bot that cannot author the card is retryable, not a broken screen: the
  // invitation is untouched and the same tap tries again.
  it.effect("reports a refusing coach bot as a retryable failure", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const stub = yield* BotRegistry.TestService
        yield* stub.failNextPrepare(
          new BotRegistry.PrepareFailed({ workspace: WORKSPACE, reason: "bot needs re-link" }),
        )
        const service = yield* CoachClients.Service
        const failure = yield* Effect.flip(
          service.prepareInviteCard(yield* Effect.promise(() => credential()), "cl_anna"),
        )

        expect(failure._tag).toBe("CoachClients.CardPreparationFailed")
      }),
    ),
  )

  // The write window, not the read one: a card is a delivery, and a launch
  // credential older than fifteen minutes cannot authorise one.
  it.effect("refuses a launch too old to act on", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(AUTH_DATE + 20 * 60 * 1_000)
        const service = yield* CoachClients.Service
        const failure = yield* Effect.flip(
          service.prepareInviteCard(yield* Effect.promise(() => credential()), "cl_anna"),
        )

        expect(failure._tag).toBe("CoachSession.Unauthenticated")
      }),
    ),
  )
})
