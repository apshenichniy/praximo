import { describe, expect, it } from "@effect/vitest"
import { CoachBotProvisioningRepo, QueryFailed } from "@praximo/db"
import { CoachLanguage, WorkspaceId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import type { User } from "grammy/types"
import { Effect, Layer } from "effect"
import { messages } from "./messages.ts"
import { provisionManagedBot } from "./provisioning.ts"
import { handleRequest, managedBotReply } from "./runtime.ts"

const coach: User = {
  id: 800000101,
  is_bot: false,
  first_name: "Ada",
  language_code: "ru",
}

const secondBot: User = {
  id: 9100011,
  is_bot: true,
  first_name: "Ada Second Bot",
  username: "ada_second_bot",
}

const env = {
  MANAGER_BOT_TOKEN: "manager-token",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default-coach-avatar.jpg",
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: {} as R2Bucket,
}

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const credentialLayer = Layer.succeed(
  CoachBotCredential.Service,
  CoachBotCredential.Service.of({
    encrypt: (token) => Effect.succeed(`sealed:${token}`),
    decrypt: (envelope) => Effect.succeed(envelope.replace(/^sealed:/, "")),
  }),
)

const installation: CoachBotProvisioningRepo.Installation = {
  workspaceId: WorkspaceId.make("ws_019f92510000700080000000"),
  telegramBotId: "9100010",
  username: "ada_first_bot",
  encryptedToken: "sealed:9100010:token",
  webhookSecretHash: "installed-hash",
  botInfo: {},
}

interface RepoStub {
  readonly layer: Layer.Layer<CoachBotProvisioningRepo.Service>
  /** Every write the second update must not make, in the order it tried. */
  readonly writes: Array<string>
}

/**
 * A repository whose `claim` refuses. `not-found` is the coach with no open
 * attempt left — the second-bot case — and anything else stands in for a
 * failure that is genuinely worth retrying.
 */
const repoStub = (
  claimFailure: CoachBotProvisioningRepo.ProvisioningUnavailable | QueryFailed,
): RepoStub => {
  const writes: Array<string> = []
  const record = (operation: string) => () => {
    writes.push(operation)
    return unsupported()
  }
  const layer = Layer.succeed(
    CoachBotProvisioningRepo.Service,
    CoachBotProvisioningRepo.Service.of({
      prepare: unsupported,
      claim: () => Effect.fail(claimFailure),
      recordPrompt: record("recordPrompt"),
      ingestCandidate: unsupported,
      findCandidateByBotId: unsupported,
      complete: record("complete"),
      findByBotId: (telegramBotId) =>
        Effect.fail(new CoachBotProvisioningRepo.InstallationNotFound({ key: telegramBotId })),
      findInFlightManagedAttempt: unsupported,
      findByWorkspace: unsupported,
      workspaceProfile: unsupported,
      rotate: record("rotate"),
      pendingNotifications: unsupported,
      markNotificationDelivered: unsupported,
      deferNotification: unsupported,
    }),
  )
  return { layer, writes }
}

const provision = (repo: RepoStub) =>
  provisionManagedBot(env, coach, secondBot, "https://bot.praximo.test").pipe(
    Effect.provide(Layer.mergeAll(repo.layer, credentialLayer)),
  )

describe("a second managed bot", () => {
  it.effect("is a terminal outcome, not a failure the webhook would retry", () =>
    Effect.gen(function* () {
      const repo = repoStub(
        new CoachBotProvisioningRepo.ProvisioningUnavailable({ reason: "not-found" }),
      )

      const outcome = yield* provision(repo)

      expect(outcome).toEqual({ _tag: "NoOpenAttempt", botUsername: "ada_second_bot" })
      // The first bot's installation is never reached, let alone rewritten: the
      // fence refused before `getManagedBotToken`, so nothing was configured.
      expect(repo.writes).toEqual([])
    }),
  )

  it.effect("leaves a genuine infrastructure failure on the retryable path", () =>
    Effect.gen(function* () {
      const repo = repoStub(
        new QueryFailed({
          operation: "provisioning.claim",
          cause: new Error("connection refused"),
        }),
      )

      const failure = yield* Effect.flip(provision(repo))

      expect(failure).toMatchObject({ _tag: "Database.QueryFailed" })
      expect(repo.writes).toEqual([])
    }),
  )

  it("tells the coach their workspace is fine and names the bot that is not connected", async () => {
    const sent: Array<{ readonly chatId: number; readonly text: string }> = []
    const response = await managedBotReply(
      { _tag: "NoOpenAttempt", botUsername: "ada_second_bot" },
      coach,
      async (chatId, text) => {
        sent.push({ chatId, text })
      },
    )

    expect(response.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.chatId).toBe(coach.id)
    // In the only language this update carries — the coach's Telegram client.
    expect(sent[0]?.text).toBe(messages("ru").extraBotNotConnected("ada_second_bot"))
  })

  it("still answers 200 when the explanation itself cannot be delivered", async () => {
    const response = await managedBotReply(
      { _tag: "NoOpenAttempt", botUsername: "ada_second_bot" },
      coach,
      () => Promise.reject(new Error("Telegram is down")),
    )

    // Best-effort by design: the update is already terminal, and a failed
    // courtesy message must not put it back in the redelivery loop.
    expect(response.status).toBe(200)
  })

  it("greets a genuinely connected bot instead", async () => {
    const sent: Array<string> = []
    const response = await managedBotReply(
      { _tag: "Connected", installation },
      coach,
      async (_chatId, text) => {
        sent.push(text)
      },
    )

    expect(response.status).toBe(200)
    expect(sent).toEqual([messages("ru").botConnected("ada_first_bot")])
  })
})

describe("the extra-bot message", () => {
  const languages = ["en", "uk", "ru"] as const

  it("leads with reassurance, names the bot, and offers @BotFather removal", () => {
    for (const language of languages) {
      const text = messages(CoachLanguage.make(language)).extraBotNotConnected("ada_second_bot")
      const [reassurance = "", ...rest] = text.split("\n\n")

      // Praximo is named once, where the bot is called unconnected — the opening
      // line is only about the coach's workspace still working.
      expect(reassurance).not.toContain("Praximo")
      expect(reassurance.length).toBeGreaterThan(0)
      expect(text).toContain("@ada_second_bot")
      expect(text).toContain("@BotFather")
      expect(rest.join("\n\n")).toContain("@ada_second_bot")
    }
  })

  it("never puts a verb that agrees with the coach's gender in their mouth", () => {
    // Coach gender is unknown to the system (#16), so the Slavic copy has to
    // avoid the past-tense forms that would have to pick one. `\b` is ASCII-only
    // in JavaScript and never matches beside Cyrillic, which would make this
    // guard silently vacuous — hence the explicit letter lookaround, and the
    // assertion below that the pattern still catches what it is aimed at.
    const gendered = /(?<!\p{L})(створили|створив|створила|создали|создал|создала)(?!\p{L})/u
    expect(gendered.test("Ви створили бота")).toBe(true)

    for (const language of ["uk", "ru"] as const) {
      const text = messages(CoachLanguage.make(language)).extraBotNotConnected("ada_second_bot")
      expect(text).not.toMatch(gendered)
    }
  })
})

// The same dummy Neon host the other worker tests use: unreachable on purpose,
// so a managed_bot update on it is exactly the infrastructure failure that must
// stay retryable.
const workerEnv = {
  DATABASE_URL:
    "postgresql://user:pass@ep-dummy-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
  MANAGER_BOT_TOKEN: "test-token",
  MANAGER_BOT_USERNAME: "PraximoManagerBot",
  MANAGER_BOT_WEBHOOK_SECRET: "test-webhook-secret",
  COACH_BOT_CREDENTIAL_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  DEFAULT_COACH_BOT_AVATAR_R2_KEY: "branding/default-coach-avatar.jpg",
  COACH_MINI_APP_URL: "https://stage.praximo.io/",
  UPLOADS: {} as R2Bucket,
}

describe("the manager webhook on a managed_bot update", () => {
  it("keeps answering 500 while the database is unreachable", async () => {
    const telegramFetch: typeof fetch = async (input) => {
      const method = new URL(input.toString()).pathname.split("/").at(-1) ?? ""
      if (method === "getMe") {
        return Response.json({
          ok: true,
          result: {
            id: 5100,
            is_bot: true,
            first_name: "Praximo Manager",
            username: workerEnv.MANAGER_BOT_USERNAME,
            can_join_groups: false,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
          },
        })
      }
      return Response.json({ ok: true, result: true })
    }

    const response = await handleRequest(
      new Request("https://bot.praximo.test/telegram/manager", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": workerEnv.MANAGER_BOT_WEBHOOK_SECRET },
        body: JSON.stringify({
          update_id: 135,
          managed_bot: { user: coach, bot: secondBot },
        }),
      }),
      workerEnv,
      telegramFetch,
    )

    // Retryable, and the distinction is the point: this one Telegram *should*
    // redeliver, unlike the coach with no open attempt.
    expect(response.status).toBe(500)
  })
})
