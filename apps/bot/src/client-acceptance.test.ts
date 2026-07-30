import { describe, expect, it } from "@effect/vitest"
import { ClientAcceptanceRepo } from "@praximo/db"
import { CoachLanguages } from "@praximo/domain"
import { clientConsentText, clientCopy } from "@praximo/i18n"
import { Effect, Layer, Ref } from "effect"
import {
  AcceptCallbackPrefix,
  acceptInvitation,
  confirmation,
  consentStep,
  LanguageCallbackPrefix,
  languageStep,
  openInvitation,
  parseCallback,
  privacyUrl,
  refusalFor,
  showConsent,
} from "./client-acceptance.ts"

const TOKEN = "23456789ABCD"
const BOT_ID = "9100777"
const CLIENT_ID = "810000123"
const NOW = new Date("2026-07-26T09:00:00.000Z")

const unsupported = () => Effect.die(new Error("unsupported test operation"))

const lookup = (
  overrides: Partial<ClientAcceptanceRepo.InviteLookup> = {},
): ClientAcceptanceRepo.InviteLookup => ({
  inviteId: "iv_1",
  clientId: "cl_1",
  clientName: "Maria K.",
  workspaceId: "ws_ada",
  status: "pending",
  expiresAt: new Date("2026-08-02T09:00:00.000Z"),
  inviteLanguage: "uk",
  coachName: "Ada Coaching",
  ...overrides,
})

interface Accepted {
  readonly language: string
  readonly identity: ClientAcceptanceRepo.ClaimIdentity
}

const repoLayer = (found: ClientAcceptanceRepo.InviteLookup | undefined, accepts = true) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<Accepted>>([])
    return {
      calls,
      layer: Layer.succeed(
        ClientAcceptanceRepo.Service,
        ClientAcceptanceRepo.Service.of({
          findByToken: (_token, botId) => Effect.succeed(botId === BOT_ID ? found : undefined),
          // The web door's pair dies here rather than being stubbed politely: the
          // bot has no business reaching for it, and a fake that answered would
          // let that mistake pass a test.
          findByWebToken: unsupported,
          findBotOwner: unsupported,
          findAcceptedClient: unsupported,
          claim: (input) =>
            Ref.update(calls, (previous) => [
              ...previous,
              { language: input.language, identity: input.identity },
            ]).pipe(Effect.as({ accepted: accepts })),
        }),
      ),
    }
  })

describe("callback data", () => {
  it("round-trips the token and the language it carries", () => {
    expect(parseCallback(LanguageCallbackPrefix, `${LanguageCallbackPrefix}${TOKEN}:ru`)).toEqual({
      token: TOKEN,
      language: "ru",
    })
    expect(parseCallback(AcceptCallbackPrefix, `${AcceptCallbackPrefix}${TOKEN}:uk`)).toEqual({
      token: TOKEN,
      language: "uk",
    })
  })

  // The whole conversation is stateless: coming back a day later works because
  // everything it needs is inside the button, and a value that made a round trip
  // is re-checked rather than trusted.
  it("refuses anything it did not write", () => {
    expect(parseCallback(LanguageCallbackPrefix, "cl:short:ru")).toBeUndefined()
    expect(
      parseCallback(LanguageCallbackPrefix, `${LanguageCallbackPrefix}${TOKEN}:de`),
    ).toBeUndefined()
    expect(
      parseCallback(LanguageCallbackPrefix, `${AcceptCallbackPrefix}${TOKEN}:ru`),
    ).toBeUndefined()
  })
})

describe("the language step", () => {
  it("leads with the guess and still offers all three", () => {
    const message = languageStep({ token: TOKEN, coachName: "Ada Coaching", suggested: "ru" })

    expect(message.buttons).toHaveLength(3)
    expect(message.buttons[0]?.text).toContain("Русский")
    expect(message.buttons[0]?.text.startsWith("•")).toBe(true)
    // ru wants a genitive here, so the lead says «ваш коуч» and the name stays in
    // the chat's own header — this is the coach's bot (#222). `en` inflects
    // nothing and still says it outright.
    expect(message.text).toContain("вашего коуча")
    expect(message.text).not.toContain("Ada Coaching")
    expect(
      languageStep({ token: TOKEN, coachName: "Ada Coaching", suggested: "en" }).text,
    ).toContain("Ada Coaching")
  })
})

describe("the consent step", () => {
  it("carries the five elements and the policy as a button", () => {
    const message = consentStep({
      token: TOKEN,
      coachName: "Ada Coaching",
      language: "ru",
      privacyUrl: "https://me.praximo.io/legal/privacy?lang=ru",
    })

    for (const index of [1, 2, 3, 4, 5]) expect(message.text).toContain(`${index}. `)
    // Never a URL in body text (#164) — least of all in the message that asks
    // for a legal agreement.
    expect(message.text).not.toContain("http")
    expect(message.buttons[0]?.url).toContain("/legal/privacy?lang=ru")
    expect(message.buttons[1]?.callbackData).toBe(`${AcceptCallbackPrefix}${TOKEN}:ru`)
  })

  /**
   * The recorded version is a digest of `clientConsentText(locale, "{coach}")`,
   * so the message assembled here has to *be* that document with a name in it —
   * two renderings of one legally operative text is a consent record nobody can
   * reproduce. Rendered with the literal `{coach}` so the comparison is exact.
   *
   * Compared with the tags taken back off since #57: the bot now supplies its own
   * `<b>` around the title, because the catalogue stopped shipping markup when
   * the web page began rendering the same block as a heading. Emphasis is the
   * transport's; the words are the document's, and it is the words this guards.
   */
  it("shows the same text the version it records is derived from", () => {
    for (const language of CoachLanguages) {
      const message = consentStep({
        token: TOKEN,
        coachName: "{coach}",
        language,
        privacyUrl: `https://me.praximo.io/legal/privacy?lang=${language}`,
      })

      expect(message.text.replaceAll(/<\/?b>/g, "")).toBe(clientConsentText(language, "{coach}"))
      // The emphasis itself is still asserted, so "strip the tags" cannot become
      // "the bot quietly stopped emphasising anything".
      expect(message.text).toContain(`<b>${clientCopy(language).consent.title}</b>`)
    }
  })

  /**
   * The **client app's** origin, not the Mini App's (#191). A client tapping
   * this is by definition somebody the Telegram surface is not for, and the page
   * they open must not load a Telegram runtime to render a privacy policy.
   */
  it("builds the policy link on the client app's origin, in the client's language", () => {
    expect(privacyUrl("https://me.praximo.io", "uk")).toBe(
      "https://me.praximo.io/legal/privacy?lang=uk",
    )
    // Whatever the origin carries is dropped: this is a public page, and a
    // bot id or a fragment on it says something about who was sent it.
    expect(privacyUrl("https://me.praximo.io/?b=9100777#x", "ru")).toBe(
      "https://me.praximo.io/legal/privacy?lang=ru",
    )
  })
})

describe("refusals", () => {
  const base = {
    expiresAt: new Date("2026-08-02T09:00:00.000Z"),
    telegramUserId: CLIENT_ID,
    now: NOW,
  }

  it("keeps the Telegram-only identity split for an accepted invitation", () => {
    expect(refusalFor({ ...base, status: "accepted", acceptedByTelegramId: CLIENT_ID })).toBe(
      "already-set-up",
    )
    expect(refusalFor({ ...base, status: "accepted", acceptedByTelegramId: "810000999" })).toBe(
      "link-used",
    )
  })

  it("maps every other domain standing into the bot's vocabulary", () => {
    expect(
      refusalFor({ ...base, status: "pending", acceptedByTelegramId: undefined }),
    ).toBeUndefined()
    expect(refusalFor({ ...base, status: "expired", acceptedByTelegramId: undefined })).toBe(
      "link-expired",
    )
    expect(
      refusalFor({
        ...base,
        status: "pending",
        acceptedByTelegramId: undefined,
        expiresAt: new Date("2026-07-01T09:00:00.000Z"),
      }),
    ).toBe("link-expired")
  })
})

describe("opening an invitation", () => {
  it.effect("answers a token from another workspace exactly like a stranger's start", () =>
    Effect.gen(function* () {
      const repo = yield* repoLayer(lookup())
      const outcome = yield* openInvitation({
        token: TOKEN,
        telegramBotId: "9100999",
        telegramUserId: CLIENT_ID,
        clientLanguageCode: "ru",
      }).pipe(Effect.provide(repo.layer))

      expect(outcome._tag).toBe("Unknown")
    }),
  )

  // The pre-selection is about the *reader*: their own Telegram client leads the
  // row, and it is only ever a guess — the language that counts is the one they
  // tap, because the consent version is derived from the text that gets shown.
  it.effect("leads with the client's own Telegram language", () =>
    Effect.gen(function* () {
      const repo = yield* repoLayer(lookup({ inviteLanguage: "uk" }))
      const outcome = yield* openInvitation({
        token: TOKEN,
        telegramBotId: BOT_ID,
        telegramUserId: CLIENT_ID,
        clientLanguageCode: "en",
      }).pipe(Effect.provide(repo.layer))

      expect(outcome._tag).toBe("Language")
      expect(outcome._tag === "Language" && outcome.message.buttons[0]?.text).toContain("English")
    }),
  )

  it.effect("falls back to the invitation's language when the client's says nothing", () =>
    Effect.gen(function* () {
      const repo = yield* repoLayer(lookup({ inviteLanguage: "uk" }))
      const outcome = yield* openInvitation({
        token: TOKEN,
        telegramBotId: BOT_ID,
        telegramUserId: CLIENT_ID,
        clientLanguageCode: "de",
      }).pipe(Effect.provide(repo.layer))

      expect(outcome._tag === "Language" && outcome.message.buttons[0]?.text).toContain(
        "Українська",
      )
    }),
  )
})

describe("accepting", () => {
  it.effect("hands claim the chosen language and Telegram identity", () =>
    Effect.gen(function* () {
      const repo = yield* repoLayer(lookup())
      const outcome = yield* acceptInvitation({
        token: TOKEN,
        language: "ru",
        telegramBotId: BOT_ID,
        telegramUserId: CLIENT_ID,
        telegramName: "Maria",
        telegramUsername: "maria",
      }).pipe(Effect.provide(repo.layer))

      expect(outcome._tag).toBe("Accepted")
      expect(yield* Ref.get(repo.calls)).toEqual([
        {
          language: "ru",
          identity: {
            kind: "telegram",
            userId: CLIENT_ID,
            name: "Maria",
            username: "maria",
          },
        },
      ])
    }),
  )

  // Zero rows updated is a losing double tap, and the honest thing to say is
  // that they are already set up — which is true.
  it.effect("tells a losing double tap that they are already in", () =>
    Effect.gen(function* () {
      const repo = yield* repoLayer(lookup(), false)
      const outcome = yield* acceptInvitation({
        token: TOKEN,
        language: "ru",
        telegramBotId: BOT_ID,
        telegramUserId: CLIENT_ID,
        telegramName: "Maria",
        telegramUsername: undefined,
      }).pipe(Effect.provide(repo.layer))

      expect(outcome._tag).toBe("Refused")
      expect(outcome._tag === "Refused" && outcome.refusal).toBe("already-set-up")
    }),
  )

  it.effect("shows the consent text in the language the client just named", () =>
    Effect.gen(function* () {
      const repo = yield* repoLayer(lookup({ inviteLanguage: "uk" }))
      const outcome = yield* showConsent({
        token: TOKEN,
        language: "ru",
        telegramBotId: BOT_ID,
        telegramUserId: CLIENT_ID,
        clientAppUrl: "https://me.praximo.io",
      }).pipe(Effect.provide(repo.layer))

      expect(outcome._tag).toBe("Consent")
      // The invitation was written in Ukrainian; the consent is in the language
      // the client named, because that is the text the record will name.
      expect(outcome._tag === "Consent" && outcome.message.text).toContain(
        "Одна вещь, на которую нужно ваше согласие",
      )
      expect(outcome._tag === "Consent" && outcome.message.buttons[1]?.text).toBe("Даю согласие")
    }),
  )
})

describe("the confirmation", () => {
  it("prints the session in the coach's zone, with the offset on its own date", () => {
    const message = confirmation({
      language: "ru",
      coachName: "Ada Coaching",
      coachTimezone: "Europe/Kyiv",
      session: {
        scheduledAt: new Date("2026-08-03T07:00:00.000Z"),
        durationMinutes: 30,
        kind: "intake",
      },
    })

    expect(message.text).toContain("10:00")
    expect(message.text).toContain("UTC+3")
    expect(message.text).toContain("Первая встреча")
    expect(message.text).toContain("30 минут")
  })

  it("stands in for the reminder it does not have when no session exists", () => {
    const message = confirmation({
      language: "ru",
      coachName: "Ada Coaching",
      coachTimezone: undefined,
      session: undefined,
    })

    expect(message.text).toContain("Ada Coaching")
    expect(message.buttons).toHaveLength(0)
  })
})
