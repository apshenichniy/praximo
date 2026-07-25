import { CoachBotProvisioningRepo } from "@praximo/db"
import type { CoachLanguage, TelegramId } from "@praximo/domain"
import { CoachBotCredential } from "@praximo/telegram"
import { Api, InlineKeyboard } from "grammy"
import type { Update } from "grammy/types"
import { Clock, Effect, Result, Schema } from "effect"
import { clientLanguage, messages } from "./messages.ts"
import {
  armCoachBotWebhook,
  coachDisplayName,
  coachMiniAppUrl,
  configureCoachBot,
  constantTimeEqual,
  type ProvisioningEnv,
  setCoachBotMenuButton,
  settleCreationPrompt,
  sha256,
  telegram,
  webhookSecret,
} from "./provisioning.ts"

/**
 * The manual @BotFather fallback (#95): a coach who already owns a bot, or whose
 * Managed Bots tap failed, pastes its token into the manager chat instead.
 *
 * A pasted token is a full-control credential with no Telegram-side proof of who
 * sent it, so it earns nothing on arrival. It is validated with `getMe`, parked
 * encrypted on the coach's open attempt, and activated only once that same coach
 * answers a one-shot `/start` handshake through the bot the token belongs to.
 * From the handshake on, this path is the one-tap path: the same claim, the same
 * branding and webhook configuration, the same activation transaction.
 */

/** BotFather issues `{bot_id}:{secret}`; the shape is the cheap pre-Telegram filter. */
const TokenPattern = /\d{5,20}:[A-Za-z0-9_-]{30,}/

/**
 * The credential inside a pasted message. Coaches routinely forward BotFather's
 * whole reply rather than the bare token, so this reads the token out of the
 * surrounding text instead of demanding the message be nothing else.
 */
export const botFatherToken = (text: string): string | undefined =>
  TokenPattern.exec(text)?.[0] ?? undefined

export class TokenIngestionFailed extends Schema.TaggedErrorClass<TokenIngestionFailed>()(
  "BotWorker.TokenIngestionFailed",
  // Deliberately carries no token, bot id, or Telegram cause: this payload is
  // what the surface renders and what a log line would capture.
  { reason: Schema.Literals(["invalid-token", "bot-taken"]) },
) {}

/** The candidate bot's `/start` payload — a fresh 256-bit URL-safe secret. */
const proofNonce = webhookSecret

const startParameter = (text: string): string | undefined =>
  /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(text)?.[1]

const apiFor = (token: string, telegramFetch?: typeof globalThis.fetch) =>
  new Api(token, telegramFetch === undefined ? undefined : { fetch: telegramFetch })

export interface IngestedCandidate {
  readonly username: string
  /** The deep link whose `/start` proves the coach owns the pasted bot. */
  readonly proofLink: string
  readonly coachLanguage: CoachLanguage
}

/**
 * Validate a pasted token, park it, and arm the bot to receive its proof.
 *
 * The order matters on the failure paths: the candidate is persisted before the
 * webhook is armed, so a bot is never pointed at us without a row that explains
 * why, and a coach whose `setWebhook` failed simply pastes again — a fresh paste
 * supersedes the previous nonce and secret.
 */
export const ingestBotFatherToken = Effect.fn("BotWorker.ingestBotFatherToken")(function* (
  coachTelegramId: TelegramId,
  token: string,
  webhookOrigin: string,
  telegramFetch?: typeof globalThis.fetch,
) {
  const repo = yield* CoachBotProvisioningRepo.Service
  const credentials = yield* CoachBotCredential.Service
  const api = apiFor(token, telegramFetch)
  const botInfo = yield* telegram("getMe", () => api.getMe()).pipe(
    Effect.mapError(() => new TokenIngestionFailed({ reason: "invalid-token" })),
  )
  const botId = String(botInfo.id)

  const installed = yield* repo.findByBotId(botId).pipe(Effect.result)
  if (Result.isSuccess(installed)) return yield* new TokenIngestionFailed({ reason: "bot-taken" })
  if (installed.failure._tag !== "CoachBotProvisioningRepo.InstallationNotFound") {
    return yield* installed.failure
  }
  // A bot somebody else is already onboarding is a different refusal from an
  // invitation problem, and the row-level fence below cannot say which it hit.
  const parked = yield* repo.findCandidateByBotId(botId).pipe(Effect.result)
  if (Result.isSuccess(parked) && parked.success.coachTelegramId !== coachTelegramId) {
    return yield* new TokenIngestionFailed({ reason: "bot-taken" })
  }
  if (
    Result.isFailure(parked) &&
    parked.failure._tag !== "CoachBotProvisioningRepo.CandidateNotFound"
  ) {
    return yield* parked.failure
  }

  const proof = proofNonce()
  const secret = webhookSecret()
  const provisioning = yield* repo.ingestCandidate({
    coachTelegramId,
    botId,
    botUsername: botInfo.username,
    encryptedToken: yield* credentials.encrypt(token),
    proofHash: yield* sha256(proof),
    webhookSecretHash: yield* sha256(secret),
    now: new Date(yield* Clock.currentTimeMillis),
  })

  yield* telegram("setWebhook", () =>
    api.setWebhook(`${webhookOrigin}/telegram/coach/${botId}`, {
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
    }),
  )

  return {
    username: botInfo.username,
    proofLink: `https://t.me/${botInfo.username}?start=${proof}`,
    coachLanguage: provisioning.coachLanguage,
  } satisfies IngestedCandidate
})

export type ProofOutcome =
  | { readonly _tag: "Ignored" }
  | { readonly _tag: "Rejected"; readonly reason: "identity" | "proof" }
  | { readonly _tag: "Activated"; readonly username: string }

export interface ProofInput {
  readonly candidate: CoachBotProvisioningRepo.Candidate
  /**
   * The webhook secret this request presented, already verified by
   * `authenticateProof`. Activation installs this same secret rather than
   * rotating it: the row holds only its hash, and a configuration that failed
   * halfway is resumed by the retry of this very update.
   */
  readonly secretToken: string
  readonly update: Update
  readonly webhookOrigin: string
  readonly telegramFetch?: typeof globalThis.fetch
}

/**
 * Authenticate a request on a bot's webhook route that has no installation yet.
 *
 * `undefined` means the route has nothing to serve for this bot: either no
 * credential is parked against it, or the caller did not present the secret the
 * proof webhook was armed with. The caller answers both the same way — the route
 * discloses nothing about which it was.
 */
export const authenticateProof = Effect.fn("BotWorker.authenticateProof")(function* (
  botId: string,
  secretToken: string,
) {
  const repo = yield* CoachBotProvisioningRepo.Service
  const found = yield* repo.findCandidateByBotId(botId).pipe(Effect.result)
  if (Result.isFailure(found)) {
    if (found.failure._tag === "CoachBotProvisioningRepo.CandidateNotFound") return undefined
    return yield* found.failure
  }
  return constantTimeEqual(yield* sha256(secretToken), found.success.webhookSecretHash)
    ? found.success
    : undefined
})

/**
 * The ownership handshake itself, on an already-authenticated candidate.
 *
 * Activation requires both halves of the proof — the nonce that only the manager
 * chat received, and the identity that pasted the token — and anything short of
 * both leaves the workspace unconnected and the attempt resumable.
 */
export const completeOwnershipProof = Effect.fn("BotWorker.completeOwnershipProof")(function* (
  env: ProvisioningEnv,
  input: ProofInput,
) {
  const repo = yield* CoachBotProvisioningRepo.Service
  const credentials = yield* CoachBotCredential.Service
  const candidate = input.candidate

  const message = input.update.message
  const from = message?.from
  if (message === undefined || from === undefined || message.text === undefined) {
    return { _tag: "Ignored" } as const
  }

  const token = yield* credentials.decrypt(candidate.encryptedToken)
  const api = apiFor(token, input.telegramFetch)
  const parameter = startParameter(message.text)
  const provenNonce =
    parameter !== undefined && constantTimeEqual(yield* sha256(parameter), candidate.proofHash)
  const provenIdentity = String(from.id) === candidate.coachTelegramId

  if (!provenNonce || !provenIdentity) {
    // A stranger who merely opened the bot is told how the handshake works; one
    // holding the coach's nonce is told plainly that it is not theirs. Neither
    // reply names the workspace or the coach.
    const copy = messages(
      provenIdentity ? candidate.coachLanguage : clientLanguage(from.language_code),
    )
    yield* telegram("sendMessage", () =>
      api.sendMessage(
        message.chat.id,
        provenNonce ? copy.proofIdentityMismatch : copy.proofLinkRequired,
      ),
    ).pipe(Effect.result)
    return { _tag: "Rejected", reason: provenNonce ? "identity" : "proof" } as const
  }

  const now = new Date(yield* Clock.currentTimeMillis)
  const claimed = yield* repo.claim(
    candidate.coachTelegramId,
    candidate.botId,
    candidate.botUsername,
    now,
  )
  const injectedFetch =
    input.telegramFetch === undefined ? {} : { telegramFetch: input.telegramFetch }
  // Same first step as the managed path (#156). Here the coach is looking at the
  // bot they pasted a token for — they have already opened it to answer the proof
  // handshake — so their client's cache is just as much in play.
  yield* setCoachBotMenuButton({
    token,
    botId: candidate.botId,
    coachChatId: candidate.coachTelegramId,
    miniAppBaseUrl: env.COACH_MINI_APP_URL,
    ...injectedFetch,
  })
  const configured = yield* configureCoachBot({
    env,
    token,
    botId: candidate.botId,
    workspace: claimed.workspace,
    coachName: coachDisplayName(from, claimed.workspace.name),
    secret: input.secretToken,
    ...injectedFetch,
  })
  yield* repo.complete({
    provisioningId: claimed.id,
    // The parked envelope already holds this exact credential under the current
    // key; re-encrypting would only mint a second ciphertext for it.
    encryptedToken: candidate.encryptedToken,
    webhookSecretHash: yield* sha256(configured.secret),
    botInfo: configured.botInfo,
    now,
  })
  // A coach who pasted a token may still have a live creation button sitting in
  // the manager chat from before they gave up on it. Their bot is connected now,
  // whichever path got them here, so that button is retired the same way (#134).
  yield* settleCreationPrompt(env, claimed, candidate.botUsername, input.telegramFetch)
  // Re-armed with the very secret this request authenticated against, which the
  // activation transaction has just recorded the hash of. On this path the bot has
  // been pointed at us since the paste — that is how the proof arrived — so there
  // is no window to close here; keeping the call in the same place as the managed
  // path is what stops the two drifting apart (#150).
  yield* armCoachBotWebhook({
    token,
    botId: candidate.botId,
    secret: input.secretToken,
    webhookOrigin: input.webhookOrigin,
    ...injectedFetch,
  })

  const copy = messages(candidate.coachLanguage)
  // The bot is connected the moment the transaction commits; a greeting that
  // Telegram refuses must never undo that.
  yield* telegram("sendMessage", () =>
    api.sendMessage(message.chat.id, copy.botReady, {
      reply_markup: new InlineKeyboard().webApp(
        copy.openButton,
        coachMiniAppUrl(env.COACH_MINI_APP_URL, candidate.botId),
      ),
    }),
  ).pipe(Effect.result)

  return { _tag: "Activated", username: candidate.botUsername } as const
})
