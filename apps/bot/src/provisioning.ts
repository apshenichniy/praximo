import { CoachOnboardingToken } from "@praximo/auth"
import { CoachBotProvisioningRepo, CoachOnboardingRepo } from "@praximo/db"
import { TelegramId } from "@praximo/domain"
import { CoachBotBranding, CoachBotCredential, ManagerBotSender } from "@praximo/telegram"
import { Api, InputFile } from "grammy"
import type { User } from "grammy/types"
import { Clock, Effect, Result, Schema } from "effect"

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

const telegram = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: () => new TelegramSetupFailed({ operation }),
  })

const webhookSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(value))
      .then((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
  )

const configureCoachBot = Effect.fn("BotWorker.configureCoachBot")(function* (
  env: ProvisioningEnv,
  token: string,
  botId: string,
  workspace: CoachBotProvisioningRepo.WorkspaceProfile,
  webhookOrigin: string,
) {
  const api = new Api(token)
  const botInfo = yield* telegram("getMe", () => api.getMe())
  const miniAppUrl = yield* Effect.try({
    try: () => {
      const url = new URL(env.COACH_MINI_APP_URL)
      if (url.protocol !== "https:") throw new Error("Mini App URL must use HTTPS")
      return url.toString()
    },
    catch: () => new TelegramSetupFailed({ operation: "miniAppUrl.validate" }),
  })
  const avatarKey = workspace.avatarR2Key ?? env.DEFAULT_COACH_BOT_AVATAR_R2_KEY
  const avatar = yield* Effect.tryPromise({
    try: () => env.UPLOADS.get(avatarKey),
    catch: () => new TelegramSetupFailed({ operation: "avatar.load" }),
  })
  if (avatar === null) return yield* new TelegramSetupFailed({ operation: "avatar.not-found" })
  const avatarBytes = new Uint8Array(
    yield* Effect.tryPromise({
      try: () => avatar.arrayBuffer(),
      catch: () => new TelegramSetupFailed({ operation: "avatar.read" }),
    }),
  )
  const secret = webhookSecret()

  yield* telegram("setMyProfilePhoto", () =>
    api.setMyProfilePhoto({
      type: "static",
      photo: new InputFile(avatarBytes, "avatar.jpg"),
    }),
  )
  yield* telegram("setMyDescription", () => api.setMyDescription(workspace.description ?? ""))
  yield* telegram("setMyShortDescription", () =>
    api.setMyShortDescription(workspace.shortDescription ?? ""),
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
        text: "Open",
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
    const configured = yield* configureCoachBot(
      env,
      token,
      existing.success.telegramBotId,
      profile,
      webhookOrigin,
    )
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
  const configured = yield* configureCoachBot(
    env,
    token,
    String(managedBot.id),
    provisioning.workspace,
    webhookOrigin,
  )
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

export const applyCoachBotBranding = Effect.fn("BotWorker.applyCoachBotBranding")(function* (
  env: ProvisioningEnv,
  profile: CoachBotBranding.Profile,
) {
  const repo = yield* CoachBotProvisioningRepo.Service
  const credentials = yield* CoachBotCredential.Service
  const installation = yield* repo.findByWorkspace(profile.workspaceId)
  const token = yield* credentials.decrypt(installation.encryptedToken)
  const api = new Api(token)
  yield* telegram("branding.setMyDescription", () =>
    api.setMyDescription(profile.description ?? ""),
  )
  yield* telegram("branding.setMyShortDescription", () =>
    api.setMyShortDescription(profile.shortDescription ?? ""),
  )
  if (profile.avatar._tag === "Apply") {
    const avatarKey = profile.avatar.r2Key
    const avatar = yield* Effect.tryPromise({
      try: () => env.UPLOADS.get(avatarKey),
      catch: () => new TelegramSetupFailed({ operation: "branding.avatar.load" }),
    })
    if (avatar === null) {
      return yield* new TelegramSetupFailed({ operation: "branding.avatar.not-found" })
    }
    const bytes = new Uint8Array(
      yield* Effect.tryPromise({
        try: () => avatar.arrayBuffer(),
        catch: () => new TelegramSetupFailed({ operation: "branding.avatar.read" }),
      }),
    )
    yield* telegram("branding.setMyProfilePhoto", () =>
      api.setMyProfilePhoto({
        type: "static",
        photo: new InputFile(bytes, "avatar.jpg"),
      }),
    )
  }
})
