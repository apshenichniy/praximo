import { createHash } from "node:crypto"
import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo } from "@praximo/db"
import { CoachLanguage, CoachOnboardingInviteId, TelegramId, WorkspaceId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import type { Update } from "grammy/types"
import { Effect, Layer } from "effect"
import { messages as messagesFor } from "./messages.ts"
import {
  authenticateProof,
  botFatherToken,
  completeOwnershipProof,
  ingestBotFatherToken,
} from "./token-fallback.ts"
import { BRANDING_AVATAR_BYTES, BRANDING_AVATAR_KEY, uploadsStub } from "./__tests__/uploads.ts"

const TOKEN = "9100777:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"
const BOT_ID = "9100777"
const BOT_USERNAME = "ada_coach_bot"
const coach = TelegramId.make("800000101")
const stranger = TelegramId.make("800000102")
const workspaceId = WorkspaceId.make("ws_019f92510000700080000000")

// The two one-shot secrets of the handshake, as the coach receives them and as
// the attempt row holds them.
const PROOF = "S2FvZC1wcm9vZi1ub25jZS0wMDE"
const SECRET = "d2ViaG9vay1zZWNyZXQtMDAx"
const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex")
const PROOF_HASH = sha256Hex(PROOF)
const SECRET_HASH = sha256Hex(SECRET)

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: BRANDING_AVATAR_KEY,
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: uploadsStub({ [BRANDING_AVATAR_KEY]: BRANDING_AVATAR_BYTES }).bucket,
}

const unsupported = () => Effect.die(new Error("unsupported test operation"))

/** A credential stub whose ciphertext is recognisable, so tests can tell the
 * plaintext token from what actually reaches the database. */
const credentialLayer = Layer.succeed(
  CoachBotCredential.Service,
  CoachBotCredential.Service.of({
    encrypt: (token) => Effect.succeed(`sealed:${token}`),
    decrypt: (envelope) => Effect.succeed(envelope.replace(/^sealed:/, "")),
  }),
)

const provisioning = (
  overrides: Partial<CoachBotProvisioningRepo.Provisioning> = {},
): CoachBotProvisioningRepo.Provisioning => ({
  id: "cbp_test_800000101",
  inviteId: CoachOnboardingInviteId.make("ci_test"),
  workspaceId,
  coachTelegramId: coach,
  keyboardRequestId: 4242,
  status: "requested",
  workspace: { name: "Ada Coaching" },
  issuedByTelegramId: TelegramId.make("100000001"),
  coachLanguage: CoachLanguage.make("uk"),
  ...overrides,
})

const candidate = (
  overrides: Partial<CoachBotProvisioningRepo.Candidate> = {},
): CoachBotProvisioningRepo.Candidate => ({
  provisioningId: "cbp_test_800000101",
  coachTelegramId: coach,
  botId: BOT_ID,
  botUsername: BOT_USERNAME,
  encryptedToken: `sealed:${TOKEN}`,
  proofHash: PROOF_HASH,
  webhookSecretHash: SECRET_HASH,
  status: "requested",
  coachLanguage: CoachLanguage.make("uk"),
  ...overrides,
})

const installation: CoachBotProvisioningRepo.Activation = {
  workspaceId,
  telegramBotId: BOT_ID,
  username: BOT_USERNAME,
  encryptedToken: `sealed:${TOKEN}`,
  webhookSecretHash: "installed-hash",
  botInfo: {},
  reconnected: false,
}

interface RepoStub {
  readonly layer: Layer.Layer<CoachBotProvisioningRepo.Service>
  readonly ingested: Array<CoachBotProvisioningRepo.IngestCandidateInput>
  readonly claimed: Array<{ readonly coach: TelegramId; readonly botId: string }>
  readonly completed: Array<CoachBotProvisioningRepo.CompleteInput>
}

const repoStub = (
  options: {
    readonly installed?: CoachBotProvisioningRepo.Installation
    readonly parked?: CoachBotProvisioningRepo.Candidate
    /** A creation prompt the coach left armed in the manager chat (#134). */
    readonly promptMessageId?: number
  } = {},
): RepoStub => {
  const ingested: Array<CoachBotProvisioningRepo.IngestCandidateInput> = []
  const claimed: Array<{ readonly coach: TelegramId; readonly botId: string }> = []
  const completed: Array<CoachBotProvisioningRepo.CompleteInput> = []
  const layer = Layer.succeed(
    CoachBotProvisioningRepo.Service,
    CoachBotProvisioningRepo.Service.of({
      prepare: unsupported,
      claim: (coachTelegramId, managedBotId, managedBotUsername) => {
        claimed.push({ coach: coachTelegramId, botId: managedBotId })
        return Effect.succeed(
          provisioning({
            status: "configuring",
            managedBotId,
            managedBotUsername,
            ...(options.promptMessageId === undefined
              ? {}
              : { promptMessageId: options.promptMessageId }),
          }),
        )
      },
      recordPrompt: unsupported,
      ingestCandidate: (input) => {
        ingested.push(input)
        return Effect.succeed(provisioning())
      },
      findCandidateByBotId: (botId) =>
        options.parked === undefined
          ? Effect.fail(new CoachBotProvisioningRepo.CandidateNotFound({ botId }))
          : Effect.succeed(options.parked),
      complete: (input) => {
        completed.push(input)
        return Effect.succeed(installation)
      },
      reopenForRelink: unsupported,
      findByBotId: (telegramBotId) =>
        options.installed === undefined
          ? Effect.fail(new CoachBotProvisioningRepo.InstallationNotFound({ key: telegramBotId }))
          : Effect.succeed(options.installed),
      findInFlightManagedAttempt: unsupported,
      findByWorkspace: unsupported,
      workspaceProfile: unsupported,
      rotate: unsupported,
      pendingNotifications: unsupported,
      markNotificationDelivered: unsupported,
      deferNotification: unsupported,
    }),
  )
  return { layer, ingested, claimed, completed }
}

interface Edit {
  readonly token: string
  readonly chatId: unknown
  readonly messageId: unknown
  readonly text: unknown
  readonly replyMarkup: unknown
}

interface TelegramStub {
  readonly fetch: typeof globalThis.fetch
  readonly calls: Array<{ readonly method: string; readonly token: string }>
  readonly messages: Array<string>
  /** Every `editMessageText`, with the credential it was made on. */
  readonly edits: Array<Edit>
}

const telegramStub = (failing: ReadonlyArray<string> = []): TelegramStub => {
  const calls: Array<{ readonly method: string; readonly token: string }> = []
  const messages: Array<string> = []
  const edits: Array<Edit> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const [, credential = "", method = ""] = new URL(input.toString()).pathname.split("/")
    const token = credential.replace(/^bot/, "")
    calls.push({ method, token })
    if (failing.includes(method)) {
      return Response.json(
        { ok: false, error_code: 401, description: "Unauthorized" },
        { status: 401 },
      )
    }
    if (method === "sendMessage") {
      const body = init?.body
      messages.push(typeof body === "string" ? String(JSON.parse(body).text) : "")
      return Response.json({ ok: true, result: { message_id: 1 } })
    }
    if (method === "editMessageText") {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {}
      edits.push({
        token,
        chatId: body.chat_id,
        messageId: body.message_id,
        text: body.text,
        replyMarkup: body.reply_markup,
      })
      return Response.json({ ok: true, result: { message_id: body.message_id } })
    }
    if (method === "getMe") {
      return Response.json({
        ok: true,
        result: {
          id: Number(BOT_ID),
          is_bot: true,
          first_name: "Ada Bot",
          username: BOT_USERNAME,
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        },
      })
    }
    return Response.json({ ok: true, result: true })
  }
  return { fetch, calls, messages, edits }
}

const proofUpdate = (text: string, fromId: string): Update =>
  ({
    update_id: 1,
    message: {
      message_id: 7,
      date: 0,
      chat: { id: Number(fromId), type: "private" },
      from: { id: Number(fromId), is_bot: false, first_name: "Ada", language_code: "en" },
      text,
    },
  }) as Update

describe("BotFather token fallback", () => {
  it("reads the credential out of a forwarded BotFather message", () => {
    expect(botFatherToken(TOKEN)).toBe(TOKEN)
    expect(
      botFatherToken(
        `Done! Congratulations on your new bot.\n\nUse this token to access the HTTP API:\n${TOKEN}\n\nKeep your token secure.`,
      ),
    ).toBe(TOKEN)
    expect(botFatherToken("  hello, how do I connect my bot?  ")).toBeUndefined()
    expect(botFatherToken("9100777:short")).toBeUndefined()
  })

  it.effect("parks the credential sealed and hands back a one-shot proof link", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const telegram = telegramStub()

      const ingested = yield* ingestBotFatherToken(
        coach,
        TOKEN,
        "https://bot.praximo.test",
        telegram.fetch,
      ).pipe(Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)))

      expect(ingested.username).toBe(BOT_USERNAME)
      expect(ingested.coachLanguage).toBe("uk")
      expect(telegram.calls.map((call) => call.method)).toEqual(["getMe", "setWebhook"])

      const parked = repo.ingested[0]
      expect(parked).toMatchObject({
        coachTelegramId: coach,
        botId: BOT_ID,
        botUsername: BOT_USERNAME,
      })
      // What lands in the row is the envelope, never the credential itself, and
      // the proof material is only ever there as a hash.
      expect(parked?.encryptedToken).toBe(`sealed:${TOKEN}`)
      // The envelope is the row's only route to the credential: no other column
      // it writes carries the secret half of the token.
      const { encryptedToken: _sealed, ...rest } = parked ?? {}
      expect(JSON.stringify(rest)).not.toContain(TOKEN.split(":")[1])
      const nonce = new URL(ingested.proofLink).searchParams.get("start") ?? ""
      expect(nonce.length).toBeGreaterThan(20)
      expect(parked?.proofHash).toMatch(/^[0-9a-f]{64}$/)
      expect(parked?.proofHash).not.toBe(nonce)
      expect(parked?.webhookSecretHash).toMatch(/^[0-9a-f]{64}$/)
    }),
  )

  it.effect("refuses a token Telegram rejects, without parking or echoing it", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const telegram = telegramStub(["getMe"])

      const failure = yield* Effect.flip(
        ingestBotFatherToken(coach, TOKEN, "https://bot.praximo.test", telegram.fetch).pipe(
          Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)),
        ),
      )

      expect(failure).toMatchObject({
        _tag: "BotWorker.TokenIngestionFailed",
        reason: "invalid-token",
      })
      expect(JSON.stringify(failure)).not.toContain(TOKEN)
      expect(repo.ingested).toHaveLength(0)
      expect(telegram.calls.map((call) => call.method)).toEqual(["getMe"])
    }),
  )

  it.effect("refuses a bot another workspace already runs", () =>
    Effect.gen(function* () {
      const repo = repoStub({ installed: installation })
      const telegram = telegramStub()

      const failure = yield* Effect.flip(
        ingestBotFatherToken(coach, TOKEN, "https://bot.praximo.test", telegram.fetch).pipe(
          Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)),
        ),
      )

      expect(failure).toMatchObject({ _tag: "BotWorker.TokenIngestionFailed", reason: "bot-taken" })
      expect(repo.ingested).toHaveLength(0)
      // The bot keeps whatever webhook it already had.
      expect(telegram.calls.map((call) => call.method)).toEqual(["getMe"])
    }),
  )

  it.effect("keeps the parked candidate when arming the proof webhook fails", () =>
    Effect.gen(function* () {
      const repo = repoStub()
      const telegram = telegramStub(["setWebhook"])

      const failure = yield* Effect.flip(
        ingestBotFatherToken(coach, TOKEN, "https://bot.praximo.test", telegram.fetch).pipe(
          Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)),
        ),
      )

      expect(failure).toMatchObject({
        _tag: "BotWorker.TelegramSetupFailed",
        operation: "setWebhook",
      })
      expect(JSON.stringify(failure)).not.toContain(TOKEN)
      // Persisted before the call that failed, so pasting again resumes.
      expect(repo.ingested).toHaveLength(1)
    }),
  )

  it.effect("authenticates the handshake route only against a parked candidate", () =>
    Effect.gen(function* () {
      const unknown = yield* authenticateProof(BOT_ID, SECRET).pipe(
        Effect.provide(Layer.mergeAll(repoStub().layer, credentialLayer)),
      )
      expect(unknown).toBeUndefined()

      const parked = repoStub({ parked: candidate() })
      const wrongSecret = yield* authenticateProof(BOT_ID, "not-the-secret").pipe(
        Effect.provide(Layer.mergeAll(parked.layer, credentialLayer)),
      )
      expect(wrongSecret).toBeUndefined()

      const authenticated = yield* authenticateProof(BOT_ID, SECRET).pipe(
        Effect.provide(Layer.mergeAll(parked.layer, credentialLayer)),
      )
      expect(authenticated?.botId).toBe(BOT_ID)
    }),
  )

  const proofOf = (repo: RepoStub, telegram: TelegramStub, update: Update, parked = candidate()) =>
    completeOwnershipProof(env, {
      candidate: parked,
      secretToken: SECRET,
      update,
      webhookOrigin: "https://bot.praximo.test",
      telegramFetch: telegram.fetch,
    }).pipe(Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)))

  it.effect("refuses the coach's own nonce presented by another account", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate() })
      const telegram = telegramStub()

      const outcome = yield* proofOf(repo, telegram, proofUpdate(`/start ${PROOF}`, stranger))

      expect(outcome).toEqual({ _tag: "Rejected", reason: "identity" })
      expect(repo.claimed).toHaveLength(0)
      expect(repo.completed).toHaveLength(0)
      expect(telegram.messages[0]).toContain("Praximo")
    }),
  )

  it.effect("points a bare /start at the confirmation link instead of activating", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate() })
      const telegram = telegramStub()

      const outcome = yield* proofOf(repo, telegram, proofUpdate("/start", coach))

      expect(outcome).toEqual({ _tag: "Rejected", reason: "proof" })
      expect(repo.claimed).toHaveLength(0)
      expect(repo.completed).toHaveLength(0)
    }),
  )

  it.effect("activates on the coach's own proof through the one-tap pipeline", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate() })
      const telegram = telegramStub()

      const outcome = yield* proofOf(repo, telegram, proofUpdate(`/start ${PROOF}`, coach))

      expect(outcome).toEqual({ _tag: "Activated", username: BOT_USERNAME })
      expect(repo.claimed).toEqual([{ coach, botId: BOT_ID }])
      // The same steps the Managed Bots path runs, against the pasted bot's own
      // credential, and in the same order — which is the point of asserting it
      // here. The menu button comes first, and twice: once addressed to the coach's
      // own chat, which is the only form Telegram delivers to a client that has
      // already read this bot, then once as the default for every later reader
      // (#156). `setWebhook` comes last, after the activation transaction (#150).
      // On this path the bot has been pointed at us since the paste, so that
      // re-arm is belt-and-braces rather than the fix; one order for both paths is
      // what stops them drifting.
      expect(telegram.calls.map((call) => call.method)).toEqual([
        "setChatMenuButton",
        "setChatMenuButton",
        "getMe",
        "setMyProfilePhoto",
        "setMyDescription",
        "setMyShortDescription",
        "setWebhook",
        "sendMessage",
      ])
      expect(telegram.calls.every((call) => call.token === TOKEN)).toBe(true)

      const completed = repo.completed[0]
      expect(completed?.provisioningId).toBe("cbp_test_800000101")
      expect(completed?.encryptedToken).toBe(`sealed:${TOKEN}`)
      // The secret the handshake was armed with is the one that stays installed,
      // so a retry of this update still authenticates.
      expect(completed?.webhookSecretHash).toBe(SECRET_HASH)
    }),
  )

  it.effect("retires the creation prompt the coach abandoned in the manager chat", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate(), promptMessageId: 401 })
      const telegram = telegramStub()

      yield* proofOf(repo, telegram, proofUpdate(`/start ${PROOF}`, coach))

      // Whichever path connected the bot, the creation button must not survive
      // it (#134) — and this one lives in the *manager* chat, so the edit is the
      // only Telegram call here made on the manager's own credential.
      expect(telegram.edits).toEqual([
        {
          token: env.MANAGER_BOT_TOKEN,
          chatId: coach,
          messageId: 401,
          text: messagesFor(CoachLanguage.make("uk")).promptConnected(BOT_USERNAME),
          replyMarkup: undefined,
        },
      ])
    }),
  )

  it.effect("activates even when that abandoned prompt can no longer be edited", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate(), promptMessageId: 401 })
      const telegram = telegramStub(["editMessageText"])

      const outcome = yield* proofOf(repo, telegram, proofUpdate(`/start ${PROOF}`, coach))

      expect(outcome).toEqual({ _tag: "Activated", username: BOT_USERNAME })
      expect(repo.completed).toHaveLength(1)
    }),
  )

  it.effect("greets the coach in the workspace's own language", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate() })
      const telegram = telegramStub()

      yield* proofOf(repo, telegram, proofUpdate(`/start ${PROOF}`, coach))
      expect(telegram.messages[0]).toBe(messagesFor("uk").botReady)

      const english = repoStub({ parked: candidate() })
      const englishTelegram = telegramStub()
      yield* proofOf(
        english,
        englishTelegram,
        proofUpdate(`/start ${PROOF}`, coach),
        candidate({ coachLanguage: CoachLanguage.make("en") }),
      )
      expect(englishTelegram.messages[0]).toBe(messagesFor("en").botReady)
    }),
  )

  it.effect("resumes the same bot after a configuration failure", () =>
    Effect.gen(function* () {
      const repo = repoStub({ parked: candidate() })
      const failing = telegramStub(["setChatMenuButton"])

      const failure = yield* Effect.flip(
        proofOf(repo, failing, proofUpdate(`/start ${PROOF}`, coach)),
      )
      expect(failure).toMatchObject({
        _tag: "BotWorker.TelegramSetupFailed",
        operation: "setChatMenuButton.chat",
      })
      // Claimed but never activated: the workspace stays unconnected.
      expect(repo.claimed).toHaveLength(1)
      expect(repo.completed).toHaveLength(0)

      // Telegram retries the same update against the same armed secret. The row
      // is `configuring` by now, which the claim resumes rather than refuses.
      const retried = telegramStub()
      const outcome = yield* proofOf(
        repo,
        retried,
        proofUpdate(`/start ${PROOF}`, coach),
        candidate({ status: "configuring" }),
      )
      expect(outcome).toEqual({ _tag: "Activated", username: BOT_USERNAME })
      expect(repo.completed).toHaveLength(1)
    }),
  )

  it.effect("cannot be replayed once the bot is installed", () =>
    Effect.gen(function* () {
      // Activation clears the parked candidate, so a duplicate delivery of the
      // handshake update no longer authenticates on this route at all.
      const installed = repoStub({ installed: installation })
      const replayed = yield* authenticateProof(BOT_ID, SECRET).pipe(
        Effect.provide(Layer.mergeAll(installed.layer, credentialLayer)),
      )
      expect(replayed).toBeUndefined()
      expect(installed.claimed).toHaveLength(0)
      expect(installed.completed).toHaveLength(0)
    }),
  )
})
