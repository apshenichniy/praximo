import { describe, expect, it } from "@effect/vitest"
import { CoachInitData } from "@praximo/auth"
import { ClientRepo, MemberRepo, SessionRepo, WorkspaceRepo } from "@praximo/db"
import { WorkspaceId } from "@praximo/domain"
import { clientCopy } from "@praximo/i18n"
import { BotRegistry } from "@praximo/telegram"
import { ConfigProvider, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { launchFor, TEST_PUBLIC_KEY } from "@/__tests__/coach-launch.ts"
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
/** The workspace label is the coach's name everywhere the client meets it. */
const COACH_NAME = "Olena"
const AUTH_DATE = Date.parse("2026-07-26T12:00:00.000Z")
const NOW = AUTH_DATE + 60_000
const TOKEN = "ABCDEFGH2345"
/** The other door of the same token (#224), where the Acceptance Page lives. */
const CLIENT_APP_URL = "https://me.praximo.io"

/**
 * The coach reads their own app in Ukrainian and picked English for this client
 * (#181). The two differ on purpose: they were the same in every earlier fixture,
 * which is exactly why nothing noticed the invitation ignoring the second one.
 */
const principal: MemberRepo.CoachPrincipalRow = {
  memberId: "mem_ada",
  workspaceId: WORKSPACE,
  language: "uk",
  botUsername: BOT_USERNAME,
  telegramBotId: BOT_ID,
  botConnectionStatus: "connected",
  hasMainMiniApp: false,
  settings: {},
  deletionPending: false,
  termsAcceptedAt: new Date(AUTH_DATE - 24 * 60 * 60 * 1_000),
}

const invite = (status: ClientRepo.ClientInviteRow["status"]): ClientRepo.ClientInviteRow => ({
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
        (telegramBotId) => Effect.succeed(telegramBotId === BOT_ID ? principal : undefined),
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
      // Fenced by the same pair the read is, because the real statement is: the
      // workspace comes from the launch and the client id from the tap.
      recordDelivery: Effect.fn("ClientRepo.Test.recordDelivery")((input) =>
        Effect.succeed({
          recorded: input.workspaceId === WORKSPACE && input.clientId === row?.id,
        }),
      ),
    }),
  )
  const sessions = Layer.succeed(
    SessionRepo.Service,
    SessionRepo.Service.of({ schedule: unused, between: unused, scheduled: unused, find: unused }),
  )
  const workspaces = Layer.succeed(
    WorkspaceRepo.Service,
    WorkspaceRepo.Service.of({
      findById: Effect.fn("WorkspaceRepo.Test.findById")(() =>
        Effect.succeed({ id: WORKSPACE, name: COACH_NAME, createdAt: new Date(NOW) }),
      ),
      create: unused,
      list: unused,
      getDetail: unused,
      findCoachByTelegramId: unused,
      rename: unused,
    }),
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
              workspaces,
              BotRegistry.testLayer,
              CoachSession.layer.pipe(
                Layer.provide(Layer.mergeAll(CoachInitData.testLayer(TEST_PUBLIC_KEY), members)),
              ),
              // The second door is built from the client app's own origin
              // (#224), read from configuration the way the deployed Worker
              // reads it rather than assembled from a literal on a screen.
              ConfigProvider.layer(ConfigProvider.fromUnknown({ CLIENT_APP_URL })),
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
        expect(minted?.card.buttonUrl).toBe(`https://t.me/${BOT_USERNAME}?start=inv_${TOKEN}`)
        // Written to Anna, in the language the coach picked *for Anna* — not in
        // the Ukrainian this coach reads their own app in.
        expect(minted?.card.text).toBe(
          clientCopy("en").invitation.message({ client: "Anna", coach: COACH_NAME }),
        )
        expect(minted?.card.buttonText).toBe(clientCopy("en").invitation.button)
        // It addresses her, names her coach, and says neither in the third person.
        expect(minted?.card.text).toContain("Anna")
        expect(minted?.card.text).toContain(COACH_NAME)
        // The link is the button, so the body never repeats it.
        expect(minted?.card.text).not.toContain("t.me")
        expect(prepared?.preparedMessageId).toBe("prepared-card-0")
        expect(prepared?.expiresAt).toBe(
          new Date(NOW + BotRegistry.PreparedCardLifetimeMillis).toISOString(),
        )
      }),
    ),
  )

  /**
   * The property the whole shape exists for (#181): the card, the copy button
   * and the `t.me/share/url` fallback send one message, not three.
   *
   * `detailFor` hands the screen the same body the card carries, with the link
   * appended — the paste channel has no button to put it on. Assert the
   * relationship rather than the text, so a copy edit does not have to be made
   * twice here either.
   */
  it.effect("gives the screen the same message the card carries", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const launch = yield* Effect.promise(() => credential())
        const detail = yield* service.detail(launch, "cl_anna")
        yield* service.prepareInviteCard(launch, "cl_anna")

        const [minted] = yield* Effect.flatMap(BotRegistry.TestService, (stub) => stub.prepared())
        expect(detail?.invite?.telegram.message).toBe(
          `${minted?.card.text}\n\n${detail?.invite?.telegram.url}`,
        )
      }),
    ),
  )

  /**
   * Two doors over one token (#224), and the sentence is the same through both.
   *
   * The body says who is writing and why — it names no app — so the only thing
   * that differs is the link on the end. A screen that had to switch copy as
   * well as address would be two invitations wearing one token.
   */
  it.effect("hands the screen both forms of the one token", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const detail = yield* service.detail(yield* Effect.promise(() => credential()), "cl_anna")

        expect(detail?.invite?.telegram.url).toBe(`https://t.me/${BOT_USERNAME}?start=inv_${TOKEN}`)
        expect(detail?.invite?.link.url).toBe(`${CLIENT_APP_URL}/i/${TOKEN}`)
        // One sentence, two endings: each message carries its own door's link.
        const body = clientCopy("en").invitation.message({ client: "Anna", coach: COACH_NAME })
        expect(detail?.invite?.link.message).toBe(`${body}\n\n${CLIENT_APP_URL}/i/${TOKEN}`)
        expect(detail?.invite?.telegram.message).toBe(
          `${body}\n\nhttps://t.me/${BOT_USERNAME}?start=inv_${TOKEN}`,
        )
        // Nothing handed over yet — the state word says «Не отправлено».
        expect(detail?.invite?.delivered).toBeUndefined()
      }),
    ),
  )

  /**
   * The write the browser reports and never decides (#224).
   *
   * A client of another workspace is refused by the repository, exactly as the
   * card is: the tap names a client, and the workspace comes from the launch.
   */
  it.effect("records a delivery only for a client this coach owns", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const launch = yield* Effect.promise(() => credential())

        expect(yield* service.recordDelivery(launch, "cl_anna", "link")).toEqual({ recorded: true })
        expect(yield* service.recordDelivery(launch, "cl_someone_else", "link")).toEqual({
          recorded: false,
        })
      }),
    ),
  )

  /**
   * A door this deploy has no word for is refused *before* the write.
   *
   * `delivery.kind` is read back to name the door in a sentence on two screens;
   * storing an unrecognised one would surface as a raw identifier in the middle
   * of it. Refusing costs nothing — the browser only ever sends the two the
   * segment offers.
   */
  it.effect("refuses a kind this product does not deliver through", () =>
    run(
      client(),
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW)
        const service = yield* CoachClients.Service
        const launch = yield* Effect.promise(() => credential())

        expect(yield* service.recordDelivery(launch, "cl_anna", "manual")).toEqual({
          recorded: false,
        })
        expect(yield* service.recordDelivery(launch, "cl_anna", 7)).toEqual({ recorded: false })
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
        expect(yield* Effect.flatMap(BotRegistry.TestService, (stub) => stub.prepared())).toEqual(
          [],
        )
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
