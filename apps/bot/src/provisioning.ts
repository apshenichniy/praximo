import { timingSafeEqual } from "node:crypto"
import { CoachOnboardingToken } from "@praximo/auth"
import { CoachBotProvisioningRepo, CoachOnboardingRepo } from "@praximo/db"
import { TelegramId } from "@praximo/domain"
import { CoachBotCredential, ManagerBotSender } from "@praximo/telegram"
import { Api, InputFile } from "grammy"
import type { User } from "grammy/types"
import { Clock, Effect, Result, Schema } from "effect"
import {
  defaultBotDescription,
  defaultBotShortDescription,
  generateDefaultAvatar,
} from "./default-branding.ts"

export interface ProvisioningEnv {
  readonly MANAGER_BOT_TOKEN: string
  readonly DEFAULT_COACH_BOT_AVATAR_R2_KEY: string
  readonly COACH_MINI_APP_URL: string
  readonly UPLOADS: R2Bucket
}

export class TelegramSetupFailed extends Schema.TaggedErrorClass<TelegramSetupFailed>()(
  "BotWorker.TelegramSetupFailed",
  { operation: Schema.String },
) {}

export const managedBotSuggestions = (
  workspaceName: string,
): { readonly name: string; readonly username: string } => {
  const stem = workspaceName
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^A-Za-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toLowerCase()
  const safeStem = /^[A-Za-z]/.test(stem) ? stem : `coach_${stem}`
  const username = `${safeStem.slice(0, 28) || "praximo_coach"}_bot`.slice(0, 32)
  return {
    name: workspaceName.slice(0, 64),
    username: username.length >= 5 ? username : "praximo_coach_bot",
  }
}

/**
 * Whose name the bot's description carries. The coach's own Telegram name is
 * the honest answer — the workspace label is the admin's private shorthand and
 * the coach never sees it — so the label is only the fallback.
 */
export const coachDisplayName = (user: User, workspaceName: string): string => {
  const telegramName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
  return telegramName.length === 0 ? workspaceName : telegramName
}

/**
 * Every Telegram call the provisioning paths make. The cause is dropped on
 * purpose: a grammY failure carries the request URL, and for a coach bot that
 * URL carries its token (ADR 0004).
 */
export const telegram = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new TelegramSetupFailed({ operation }),
  })

export const webhookSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

export const constantTimeEqual = (received: string, expected: string): boolean => {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(value))
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
  )

const loadAvatarObject = Effect.fnUntraced(function* (env: ProvisioningEnv, key: string) {
  const object = yield* Effect.tryPromise({
    try: () => env.UPLOADS.get(key),
    catch: () => new TelegramSetupFailed({ operation: "avatar.load" }),
  })
  if (object === null) return yield* new TelegramSetupFailed({ operation: "avatar.not-found" })
  return new Uint8Array(
    yield* Effect.tryPromise({
      try: () => object.arrayBuffer(),
      catch: () => new TelegramSetupFailed({ operation: "avatar.read" }),
    }),
  )
})

/**
 * The bot's starting avatar. A workspace that still carries a stored key (from
 * before manager-side branding was removed, #108) keeps it; everything else is
 * generated on the spot. The stage's static R2 object stays as the fallback for
 * the case where generation itself fails — a bot with a stock avatar is a far
 * smaller problem than a coach who cannot finish onboarding.
 */
const resolveAvatarBytes = Effect.fn("BotWorker.resolveAvatarBytes")(function* (
  env: ProvisioningEnv,
  workspace: CoachBotProvisioningRepo.WorkspaceProfile,
  seed: string,
) {
  if (workspace.avatarR2Key !== undefined) {
    return yield* loadAvatarObject(env, workspace.avatarR2Key)
  }
  const generated = yield* Effect.try({
    try: () => generateDefaultAvatar(seed),
    catch: () => new TelegramSetupFailed({ operation: "avatar.generate" }),
  }).pipe(Effect.result)
  if (Result.isSuccess(generated)) return generated.success
  return yield* loadAvatarObject(env, env.DEFAULT_COACH_BOT_AVATAR_R2_KEY)
})

export interface CoachBotConfiguration {
  readonly env: ProvisioningEnv
  readonly token: string
  readonly botId: string
  readonly workspace: CoachBotProvisioningRepo.WorkspaceProfile
  readonly coachName: string
  readonly webhookOrigin: string
  /**
   * The webhook secret to install, when one is already armed on this bot and
   * recorded against it. The BotFather fallback (#95) passes the secret it armed
   * to receive the ownership proof: rotating it mid-configuration would lock out
   * the very retry a partial failure depends on. Omitted, a fresh one is minted.
   */
  readonly secret?: string
  readonly telegramFetch?: typeof globalThis.fetch
}

/**
 * The label on every coach bot's in-chat menu button. Deliberately the same
 * English word Telegram puts on the chat-list Main Mini App button and the same
 * one the manager bot carries (`scripts/menu-button.ts`): a coach who enables
 * the Main Mini App themselves in @BotFather then has two entry points to one
 * app under one word, which is the BotFather pattern (ADR 0004 §Mini App entry
 * points, #86). Not translated for that reason — it names the platform
 * affordance, not our copy.
 */
export const CoachMenuButtonText = "Open"

export const apiFor = (token: string, telegramFetch?: typeof globalThis.fetch): Api =>
  new Api(token, telegramFetch === undefined ? undefined : { fetch: telegramFetch })

export const configureCoachBot = Effect.fn("BotWorker.configureCoachBot")(function* (
  input: CoachBotConfiguration,
) {
  const { botId, coachName, env, token, webhookOrigin, workspace } = input
  const api = apiFor(token, input.telegramFetch)
  const botInfo = yield* telegram("getMe", () => api.getMe())
  const miniAppUrl = yield* Effect.try({
    try: () => {
      const url = new URL(env.COACH_MINI_APP_URL)
      if (url.protocol !== "https:") throw new Error("Mini App URL must use HTTPS")
      return url.toString()
    },
    catch: () => new TelegramSetupFailed({ operation: "miniAppUrl.validate" }),
  })
  // Seeded by the bot id so a re-provisioning of the same bot reproduces the
  // same avatar rather than re-skinning a profile the coach may already own.
  const avatarBytes = yield* resolveAvatarBytes(env, workspace, botId)
  const secret = input.secret ?? webhookSecret()

  yield* telegram("setMyProfilePhoto", () =>
    api.setMyProfilePhoto({
      type: "static",
      photo: new InputFile(avatarBytes, "avatar.jpg"),
    }),
  )
  yield* telegram("setMyDescription", () =>
    api.setMyDescription(workspace.description ?? defaultBotDescription(coachName)),
  )
  yield* telegram("setMyShortDescription", () =>
    api.setMyShortDescription(workspace.shortDescription ?? defaultBotShortDescription(coachName)),
  )
  yield* telegram("setWebhook", () =>
    api.setWebhook(`${webhookOrigin}/telegram/coach/${botId}`, {
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
    }),
  )
  yield* telegram("setChatMenuButton", () =>
    api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: CoachMenuButtonText,
        web_app: { url: miniAppUrl },
      },
    }),
  )
  return { secret, botInfo }
})

export const prepareOnboarding = Effect.fn("BotWorker.prepareOnboarding")(function* (
  parameter: string,
  telegramUserId: number,
) {
  const tokens = yield* CoachOnboardingToken.Service
  const onboarding = yield* CoachOnboardingRepo.Service
  const repo = yield* CoachBotProvisioningRepo.Service
  // The start param carries only the public code: reject junk by format, then
  // resolve it to an invite id the provisioning repo can advance.
  const code = yield* tokens.verify(parameter)
  const inviteId = yield* onboarding.resolveCode(code)
  return yield* repo.prepare(
    inviteId,
    TelegramId.make(String(telegramUserId)),
    new Date(yield* Clock.currentTimeMillis),
  )
})

export const provisionManagedBot = Effect.fn("BotWorker.provisionManagedBot")(function* (
  env: ProvisioningEnv,
  user: User,
  managedBot: User,
  webhookOrigin: string,
) {
  if (managedBot.username === undefined) {
    return yield* new TelegramSetupFailed({ operation: "managedBot.username" })
  }
  const repo = yield* CoachBotProvisioningRepo.Service
  const credentials = yield* CoachBotCredential.Service
  const now = new Date(yield* Clock.currentTimeMillis)

  const existing = yield* repo.findByBotId(String(managedBot.id)).pipe(Effect.result)
  if (Result.isSuccess(existing)) {
    const token = yield* telegram("getManagedBotToken", () =>
      new Api(env.MANAGER_BOT_TOKEN).getManagedBotToken(managedBot.id),
    )
    const profile = yield* repo.workspaceProfile(existing.success.workspaceId)
    const configured = yield* configureCoachBot({
      env,
      token,
      botId: existing.success.telegramBotId,
      workspace: profile,
      coachName: coachDisplayName(user, profile.name),
      webhookOrigin,
    })
    return yield* repo.rotate({
      telegramBotId: String(managedBot.id),
      encryptedToken: yield* credentials.encrypt(token),
      webhookSecretHash: yield* sha256(configured.secret),
      botInfo: configured.botInfo,
      username: managedBot.username,
      now,
    })
  }
  if (existing.failure._tag !== "CoachBotProvisioningRepo.InstallationNotFound") {
    return yield* existing.failure
  }

  const provisioning = yield* repo.claim(
    TelegramId.make(String(user.id)),
    String(managedBot.id),
    managedBot.username,
    now,
  )
  const token = yield* telegram("getManagedBotToken", () =>
    new Api(env.MANAGER_BOT_TOKEN).getManagedBotToken(managedBot.id),
  )
  const configured = yield* configureCoachBot({
    env,
    token,
    botId: String(managedBot.id),
    workspace: provisioning.workspace,
    coachName: coachDisplayName(user, provisioning.workspace.name),
    webhookOrigin,
  })
  return yield* repo.complete({
    provisioningId: provisioning.id,
    encryptedToken: yield* credentials.encrypt(token),
    webhookSecretHash: yield* sha256(configured.secret),
    botInfo: configured.botInfo,
    now,
  })
})

export const deliverProvisioningNotifications = Effect.fn(
  "BotWorker.deliverProvisioningNotifications",
)(function* () {
  const repo = yield* CoachBotProvisioningRepo.Service
  const sender = yield* ManagerBotSender.Service
  const now = new Date(yield* Clock.currentTimeMillis)
  const notifications = yield* repo.pendingNotifications(now, 20)
  yield* Effect.forEach(
    notifications,
    (notification) =>
      sender
        .sendText(
          notification.recipientTelegramId,
          `Coach bot @${notification.botUsername} is connected to “${notification.workspaceName}”.`,
        )
        .pipe(
          Effect.flatMap(() => repo.markNotificationDelivered(notification.id, now)),
          Effect.catchTag("ManagerBotSender.SendFailed", () =>
            repo.deferNotification(notification.id, now),
          ),
        ),
    { concurrency: 4 },
  )
})
