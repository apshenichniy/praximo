import { ClientAcceptanceRepo } from "@praximo/db"
import {
  type CoachLanguage,
  CoachLanguages,
  narrowCoachLanguage,
  parseClientInviteStartParameter,
} from "@praximo/domain"
import {
  clientConsentVersion,
  clientCopy,
  ClientLanguageNames,
  DefaultTimeZone,
  sessionMoment,
  SuggestedLanguageMark,
} from "@praximo/i18n"
import { Clock, Effect } from "effect"

/**
 * The client's walk through the coach's bot (#56 §Bot side): language, then
 * consent, then a confirmation.
 *
 * **Stateless.** The token and the chosen language travel in `callback_data`, so
 * coming back a day later works by construction and a redelivered webhook is
 * harmless — there is no conversation to lose and none to resume.
 *
 * **One message, edited forward.** Each step replaces the last in place, so the
 * chat keeps one artefact instead of five bubbles of a form the client filled
 * in, and no superseded button stays tappable.
 */

/** `cl:<token>:<language>` — the language step's answer. */
export const LanguageCallbackPrefix = "cl:"
/** `ca:<token>:<language>` — the consent step's answer. */
export const AcceptCallbackPrefix = "ca:"

/**
 * Which language leads the row.
 *
 * A `language_code` the product speaks wins, because it is about the reader. An
 * absent or unsupported one falls back to the language the invitation was
 * written in rather than to English — the coach chose that on this client's
 * behalf, and it is a better guess than the default.
 */
export const suggestedLanguage = (
  clientLanguageCode: string | undefined,
  inviteLanguage: CoachLanguage,
): CoachLanguage => {
  const base = (clientLanguageCode ?? "").toLowerCase().split("-")[0] ?? ""
  return CoachLanguages.includes(base as CoachLanguage)
    ? narrowCoachLanguage(clientLanguageCode)
    : inviteLanguage
}

export interface CallbackChoice {
  readonly token: string
  readonly language: CoachLanguage
}

const callbackData = (prefix: string, token: string, language: CoachLanguage): string =>
  `${prefix}${token}:${language}`

export const languageCallback = (token: string, language: CoachLanguage): string =>
  callbackData(LanguageCallbackPrefix, token, language)

export const acceptCallback = (token: string, language: CoachLanguage): string =>
  callbackData(AcceptCallbackPrefix, token, language)

/**
 * Read one back, refusing anything the bot did not write.
 *
 * A round trip is worth re-checking: the token is filtered by shape before it
 * can become a query, and the language is narrowed against the three the
 * product speaks rather than trusted as a column value.
 */
export const parseCallback = (prefix: string, data: string): CallbackChoice | undefined => {
  if (!data.startsWith(prefix)) return undefined
  const [token, language] = data.slice(prefix.length).split(":")
  if (token === undefined || language === undefined) return undefined
  const parsed = parseClientInviteStartParameter(`inv_${token}`)
  if (parsed === undefined) return undefined
  return CoachLanguages.includes(language as CoachLanguage)
    ? { token: parsed, language: language as CoachLanguage }
    : undefined
}

export interface InlineButton {
  readonly text: string
  readonly callbackData?: string
  readonly url?: string
}

export interface BotMessage {
  readonly text: string
  /** One button per row, in the order they should be tapped. */
  readonly buttons: ReadonlyArray<InlineButton>
}

/**
 * Step one, and it stays step one.
 *
 * The sender's Telegram `language_code` is only a *pre-selection* — the guessed
 * language leads the row with a marker — because consent is a legal act: the
 * text the client agreed to must be in the language they named themselves,
 * especially as the recorded version is derived per language from the text
 * actually shown. One saved tap does not buy that.
 */
export const languageStep = (input: {
  readonly token: string
  readonly coachName: string
  readonly suggested: CoachLanguage
}): BotMessage => {
  const copy = clientCopy(input.suggested)
  const ordered = [
    input.suggested,
    ...CoachLanguages.filter((language) => language !== input.suggested),
  ]
  return {
    text: `${copy.languageStep.title}\n\n${copy.languageStep.lead(input.coachName)}`,
    buttons: ordered.map((language) => ({
      text:
        language === input.suggested
          ? `${SuggestedLanguageMark}${ClientLanguageNames[language]}`
          : ClientLanguageNames[language],
      callbackData: languageCallback(input.token, language),
    })),
  }
}

/**
 * Step two: the five required elements, in the language the client just named,
 * with the privacy policy as an inline button.
 *
 * Never a URL in body text (#164) — and here it matters more than usual: a link
 * wrapped across four lines of a phone, inside the one message that asks for a
 * legal agreement, is the most alarming thing the product could show.
 */
export const consentStep = (input: {
  readonly token: string
  readonly coachName: string
  readonly language: CoachLanguage
  readonly privacyUrl: string
}): BotMessage => {
  const copy = clientCopy(input.language)
  const points = copy.consent
    .points(input.coachName)
    .map((point, index) => `${index + 1}. ${point}`)
    .join("\n")

  return {
    text: [
      copy.consent.title,
      copy.consent.lead(input.coachName),
      points,
      copy.consent.footer,
    ].join("\n\n"),
    buttons: [
      { text: copy.consent.privacyButton, url: input.privacyUrl },
      {
        text: copy.consent.agreeButton,
        callbackData: acceptCallback(input.token, input.language),
      },
    ],
  }
}

export interface ConfirmationInput {
  readonly language: CoachLanguage
  readonly coachName: string
  readonly coachTimezone: string | undefined
  readonly session:
    | { readonly scheduledAt: Date; readonly durationMinutes: number; readonly kind: string }
    | undefined
}

/**
 * Step three, in two branches, both written here.
 *
 * A session scheduled *after* acceptance does not reach the client in this
 * slice — reminder mechanics are #41 — and the second branch's sentence is what
 * stands in for it. That is a named debt rather than an oversight.
 */
export const confirmation = (input: ConfirmationInput): BotMessage => {
  const copy = clientCopy(input.language)
  if (input.session === undefined) {
    return { text: copy.confirmation.withoutSession(input.coachName), buttons: [] }
  }
  return {
    text: copy.confirmation.withSession({
      coach: input.coachName,
      kind: input.session.kind === "intake" ? "intake" : "regular",
      moment: sessionMoment(
        input.language,
        input.session.scheduledAt,
        input.coachTimezone ?? DefaultTimeZone,
      ),
      durationMinutes: input.session.durationMinutes,
    }),
    buttons: [],
  }
}

/**
 * Why a link did not open a door, in the three ways that differ to the person
 * holding it.
 *
 * "Already accepted by the same Telegram id" is the common case and not an
 * error at all — the client scrolled up and tapped the old link. Telling it
 * apart from a stranger's reuse is the whole reason acceptance records which
 * identity walked through.
 */
export type Refusal = "already-set-up" | "link-used" | "link-expired"

export const refusalFor = (input: {
  readonly status: "pending" | "accepted" | "expired"
  readonly expiresAt: Date
  readonly acceptedByTelegramId: string | undefined
  readonly telegramUserId: string
  readonly now: Date
}): Refusal | undefined => {
  if (input.status === "accepted") {
    return input.acceptedByTelegramId === input.telegramUserId ? "already-set-up" : "link-used"
  }
  // Expiry by time is decided at read time; the stored `expired` means the
  // coach reissued, and reads the same to the client either way.
  if (input.status === "expired" || input.expiresAt.getTime() <= input.now.getTime()) {
    return "link-expired"
  }
  return undefined
}

export const refusalText = (
  refusal: Refusal,
  language: CoachLanguage,
  coachName: string,
): string => {
  const copy = clientCopy(language)
  if (refusal === "already-set-up") return copy.refusal.alreadySetUp(coachName)
  return refusal === "link-used"
    ? copy.refusal.linkUsed(coachName)
    : copy.refusal.linkExpired(coachName)
}

/**
 * The public privacy policy, in the language the client is being spoken to.
 *
 * Built from the **client app's** origin since #191, not from the Mini App's.
 * The two are different hosts now, and this is a link a client taps: they are
 * not on Telegram's Mini App by definition — that is the whole reason the web
 * acceptance path exists — so the page they open must not be one that loads a
 * Telegram runtime to render a privacy policy.
 */
export const privacyUrl = (clientAppUrl: string, language: CoachLanguage): string => {
  try {
    const url = new URL(clientAppUrl)
    url.search = ""
    url.hash = ""
    url.pathname = "/legal/privacy"
    url.searchParams.set("lang", language)
    return url.toString()
  } catch {
    return clientAppUrl
  }
}

const identifier = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`

export type AcceptanceOutcome =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Refused"; readonly refusal: Refusal; readonly message: BotMessage }
  | { readonly _tag: "Language"; readonly message: BotMessage }
  | { readonly _tag: "Consent"; readonly message: BotMessage }
  | { readonly _tag: "Accepted"; readonly message: BotMessage }

/**
 * Resolve a token presented to one bot, and say what the client should see.
 *
 * The token resolves **only inside the workspace of the bot it was presented
 * to**. A code from another coach's workspace produces nothing here and is
 * answered exactly like an unrecognized `/start` — disclosing neither that the
 * code exists nor whose it is.
 */
export const openInvitation = Effect.fn("ClientAcceptance.openInvitation")(function* (input: {
  readonly token: string
  readonly telegramBotId: string
  readonly telegramUserId: string
  readonly clientLanguageCode: string | undefined
}) {
  const repo = yield* ClientAcceptanceRepo.Service
  const lookup = yield* repo.findByToken(input.token, input.telegramBotId)
  if (lookup === undefined) return { _tag: "Unknown" } as const

  const now = new Date(yield* Clock.currentTimeMillis)
  const refusal = refusalFor({
    status: lookup.status,
    expiresAt: lookup.expiresAt,
    acceptedByTelegramId: lookup.acceptedByTelegramId,
    telegramUserId: input.telegramUserId,
    now,
  })
  if (refusal !== undefined) {
    // A refusal is spoken in the language the invitation was written in: the
    // client never got as far as naming one.
    return {
      _tag: "Refused",
      refusal,
      message: {
        text: refusalText(refusal, lookup.inviteLanguage, lookup.coachName),
        buttons: [],
      },
    } as const
  }

  return {
    _tag: "Language",
    message: languageStep({
      token: input.token,
      coachName: lookup.coachName,
      // The sender's own Telegram client, which is the only thing this update
      // knows about the person reading it. The invitation's language is the
      // coach's guess about them, and stands in when the client's says nothing
      // the product speaks.
      suggested: suggestedLanguage(input.clientLanguageCode, lookup.inviteLanguage),
    }),
  } as const
})

/** The consent text, once a language has been named. */
export const showConsent = Effect.fn("ClientAcceptance.showConsent")(function* (input: {
  readonly token: string
  readonly language: CoachLanguage
  readonly telegramBotId: string
  readonly telegramUserId: string
  readonly clientAppUrl: string
}) {
  const repo = yield* ClientAcceptanceRepo.Service
  const lookup = yield* repo.findByToken(input.token, input.telegramBotId)
  if (lookup === undefined) return { _tag: "Unknown" } as const

  const now = new Date(yield* Clock.currentTimeMillis)
  const refusal = refusalFor({
    status: lookup.status,
    expiresAt: lookup.expiresAt,
    acceptedByTelegramId: lookup.acceptedByTelegramId,
    telegramUserId: input.telegramUserId,
    now,
  })
  if (refusal !== undefined) {
    return {
      _tag: "Refused",
      refusal,
      message: { text: refusalText(refusal, input.language, lookup.coachName), buttons: [] },
    } as const
  }

  return {
    _tag: "Consent",
    message: consentStep({
      token: input.token,
      coachName: lookup.coachName,
      language: input.language,
      privacyUrl: privacyUrl(input.clientAppUrl, input.language),
    }),
  } as const
})

/**
 * The acceptance itself.
 *
 * The transaction is the repository's — one statement gated on a conditional
 * update, so a losing double tap creates nothing. What is decided here is what
 * the client is then told: a client whose acceptance lost the race is told they
 * are already set up, which is true and is the only useful thing to say.
 */
export const acceptInvitation = Effect.fn("ClientAcceptance.acceptInvitation")(function* (input: {
  readonly token: string
  readonly language: CoachLanguage
  readonly telegramBotId: string
  readonly telegramUserId: string
  readonly telegramName: string
  readonly telegramUsername: string | undefined
}) {
  const repo = yield* ClientAcceptanceRepo.Service
  const lookup = yield* repo.findByToken(input.token, input.telegramBotId)
  if (lookup === undefined) return { _tag: "Unknown" } as const

  const now = new Date(yield* Clock.currentTimeMillis)
  const refusal = refusalFor({
    status: lookup.status,
    expiresAt: lookup.expiresAt,
    acceptedByTelegramId: lookup.acceptedByTelegramId,
    telegramUserId: input.telegramUserId,
    now,
  })
  if (refusal !== undefined) {
    return {
      _tag: "Refused",
      refusal,
      message: { text: refusalText(refusal, input.language, lookup.coachName), buttons: [] },
    } as const
  }

  const claimed = yield* repo.accept({
    inviteId: lookup.inviteId,
    workspaceId: lookup.workspaceId,
    clientId: lookup.clientId,
    telegramUserId: input.telegramUserId,
    telegramName: input.telegramName,
    ...(input.telegramUsername === undefined ? {} : { telegramUsername: input.telegramUsername }),
    language: input.language,
    // Derived from the text actually shown, in the language shown — which is
    // why the version is per language here and not one across all three.
    consentTextVersion: clientConsentVersion(input.language),
    channelId: identifier("ch"),
    consentId: identifier("cg"),
    now,
  })

  if (!claimed.accepted) {
    return {
      _tag: "Refused",
      refusal: "already-set-up",
      message: {
        text: refusalText("already-set-up", input.language, lookup.coachName),
        buttons: [],
      },
    } as const
  }

  return {
    _tag: "Accepted",
    message: confirmation({
      language: input.language,
      coachName: lookup.coachName,
      coachTimezone: lookup.coachTimezone,
      session: lookup.nextSession,
    }),
  } as const
})
