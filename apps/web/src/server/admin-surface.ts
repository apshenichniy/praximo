import { createHash } from "node:crypto"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, WorkspaceDeletionRepo, WorkspaceRepo } from "@praximo/db"
import {
  CoachLanguage,
  CreateInviteDelivery,
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  TelegramId,
  UpdateWorkspaceProfileInput,
  WorkspaceId,
  WorkspaceRunCancellationResult,
} from "@praximo/domain"
import { CoachBotBranding, CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { Clock, Context, DateTime, Effect, Layer, Result, Schema } from "effect"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

export type DeliveryStatus = "sent" | "failed" | "unknown"

export interface CreateResult {
  readonly workspace: WorkspaceRepo.ListItem
  readonly inviteId: string
  readonly link: string
  readonly expiresAt: string
  readonly delivery: DeliveryStatus
  /** The full forwardable invite message in the chosen invite language. */
  readonly message: string
}

export interface PrepareShareResult {
  /** The short-lived prepared-message id handed to `WebApp.shareMessage`. */
  readonly preparedMessageId: string
}

export interface WorkspaceDetail {
  readonly id: WorkspaceId
  readonly name: string
  readonly description?: string
  readonly shortDescription?: string
  readonly hasCustomAvatar: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly coachLanguage?: CoachLanguage
  readonly botStatus: WorkspaceRepo.BotConnectionStatus
  readonly botUsername?: string
  readonly termsAcceptedAt?: string
  readonly lastLoginAt?: string
  readonly lastActivityAt?: string
  readonly invite?: {
    readonly id: string
    readonly status: "pending" | "used" | "expired"
    readonly issuedAt: string
    readonly expiresAt: string
    readonly link?: string
  }
  readonly canReissue: boolean
}

export interface UpdateProfileResult {
  readonly workspace: WorkspaceDetail
  readonly status: "saved" | "saved-branding-failed"
  readonly retryAvatar: boolean
}

export interface DeleteResult {
  readonly status: "deleted" | "deleted-farewell-undeliverable"
}

export interface Interface {
  readonly listWorkspaces: (
    initData: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceRepo.ListItem>, AccessDenied | LoadFailed>
  readonly createWorkspace: (
    initData: string,
    input: unknown,
    delivery: unknown,
  ) => Effect.Effect<
    CreateResult,
    AccessDenied | ValidationFailed | IdempotencyConflict | LoadFailed
  >
  readonly prepareInviteShareMessage: (
    initData: string,
    inviteId: string,
    language: unknown,
  ) => Effect.Effect<
    PrepareShareResult,
    AccessDenied | ValidationFailed | LoadFailed | SharePreparationFailed
  >
  readonly recordInviteShare: (
    initData: string,
    inviteId: string,
    language: unknown,
  ) => Effect.Effect<void, AccessDenied | ValidationFailed | LoadFailed>
  readonly resendInvite: (
    initData: string,
    inviteId: string,
  ) => Effect.Effect<CreateResult, AccessDenied | LoadFailed>
  readonly getWorkspace: (
    initData: string,
    workspaceId: string,
  ) => Effect.Effect<WorkspaceDetail, AccessDenied | LoadFailed>
  readonly getWorkspaceAvatar: (
    initData: string,
    workspaceId: string,
  ) => Effect.Effect<
    WorkspaceBrandingStorage.LoadedAvatar,
    AccessDenied | AvatarUnavailable | LoadFailed
  >
  readonly updateWorkspaceProfile: (
    initData: string,
    workspaceId: string,
    input: unknown,
    avatar?: Uint8Array,
  ) => Effect.Effect<
    UpdateProfileResult,
    | AccessDenied
    | ValidationFailed
    | ProfileConflict
    | WorkspaceBrandingStorage.InvalidAvatar
    | WorkspaceBrandingStorage.UploadFailed
    | LoadFailed
  >
  readonly retryWorkspaceBranding: (
    initData: string,
    workspaceId: string,
    retryAvatar: boolean,
  ) => Effect.Effect<UpdateProfileResult, AccessDenied | LoadFailed>
  readonly reissueWorkspaceInvite: (
    initData: string,
    workspaceId: string,
    expectedInviteId: string,
    requestId: string,
  ) => Effect.Effect<CreateResult, AccessDenied | ReissueUnavailable | LoadFailed>
  readonly deleteWorkspace: (
    initData: string,
    workspaceId: string,
    input: unknown,
  ) => Effect.Effect<
    DeleteResult,
    | AccessDenied
    | ValidationFailed
    | DeleteConfirmationMismatch
    | DeletionConflict
    | DeletionRetryable
    | DeletionFailed
    | LoadFailed
  >
}

export class Service extends Context.Service<Service, Interface>()("@praximo/web/AdminSurface") {}

export class AccessDenied extends Schema.TaggedErrorClass<AccessDenied>()(
  "AdminSurface.AccessDenied",
  {},
) {}

export class LoadFailed extends Schema.TaggedErrorClass<LoadFailed>()("AdminSurface.LoadFailed", {
  operation: Schema.String,
}) {}

export class ValidationFailed extends Schema.TaggedErrorClass<ValidationFailed>()(
  "AdminSurface.ValidationFailed",
  {},
) {}

export class IdempotencyConflict extends Schema.TaggedErrorClass<IdempotencyConflict>()(
  "AdminSurface.IdempotencyConflict",
  {},
) {}

export class ProfileConflict extends Schema.TaggedErrorClass<ProfileConflict>()(
  "AdminSurface.ProfileConflict",
  {},
) {}

export class ReissueUnavailable extends Schema.TaggedErrorClass<ReissueUnavailable>()(
  "AdminSurface.ReissueUnavailable",
  {},
) {}

/**
 * The prepared inline message could not be saved (Bot API failure, or a
 * short-lived message that expired before sharing). Retryable: the invite stays
 * pending and the manager can tap Share again to mint a fresh prepared message.
 */
export class SharePreparationFailed extends Schema.TaggedErrorClass<SharePreparationFailed>()(
  "AdminSurface.SharePreparationFailed",
  {},
) {}

export class AvatarUnavailable extends Schema.TaggedErrorClass<AvatarUnavailable>()(
  "AdminSurface.AvatarUnavailable",
  {},
) {}

export class DeleteConfirmationMismatch extends Schema.TaggedErrorClass<DeleteConfirmationMismatch>()(
  "AdminSurface.DeleteConfirmationMismatch",
  {},
) {}

export class DeletionConflict extends Schema.TaggedErrorClass<DeletionConflict>()(
  "AdminSurface.DeletionConflict",
  {},
) {}

export class DeletionRetryable extends Schema.TaggedErrorClass<DeletionRetryable>()(
  "AdminSurface.DeletionRetryable",
  { operation: Schema.Literals(["pipeline", "farewell", "bot-release", "finalize"]) },
) {}

export class DeletionFailed extends Schema.TaggedErrorClass<DeletionFailed>()(
  "AdminSurface.DeletionFailed",
  { operation: Schema.Literal("bot-release") },
) {}

const decodeCreateInput = Schema.decodeUnknownEffect(CreateWorkspaceInput)
const decodeCreateDelivery = Schema.decodeUnknownEffect(CreateInviteDelivery)
const decodeCoachLanguage = Schema.decodeUnknownEffect(CoachLanguage)
const decodeUpdateInput = Schema.decodeUnknownEffect(UpdateWorkspaceProfileInput)
const decodeDeleteInput = Schema.decodeUnknownEffect(DeleteWorkspaceInput)
const decodeWorkspaceId = Schema.decodeUnknownEffect(WorkspaceId)
const decodeInviteId = Schema.decodeUnknownEffect(
  Schema.NonEmptyString.pipe(Schema.brand("CoachOnboardingInviteId")),
)
const decodeRequestId = Schema.decodeUnknownEffect(Schema.String.check(Schema.isUUID(4)))

// The invite-first workspace may carry no label yet, so each language has a
// named and an unnamed opening line.
const forwardableCopy = {
  uk: {
    named: (name: string) => `Ваш простір Praximo «${name}» готовий.`,
    unnamed: "Ваш простір Praximo готовий.",
    tail: "Відкрийте це одноразове посилання протягом 7 днів, щоб підключити свого бота:",
  },
  ru: {
    named: (name: string) => `Ваше пространство Praximo «${name}» готово.`,
    unnamed: "Ваше пространство Praximo готово.",
    tail: "Откройте эту одноразовую ссылку в течение 7 дней, чтобы подключить своего бота:",
  },
  en: {
    named: (name: string) => `Your Praximo workspace “${name}” is ready.`,
    unnamed: "Your Praximo workspace is ready.",
    tail: "Open this one-time link within 7 days to connect your bot:",
  },
} as const

const forwardableMessage = (language: CoachLanguage, name: string, link: string): string => {
  const copy = forwardableCopy[language]
  const opening = name.length === 0 ? copy.unnamed : copy.named(name)
  return `${opening}\n\n${copy.tail}\n${link}`
}

// The inline "open the deep link" button on the bot-authored prepared message.
const startOnboardingLabel: Record<CoachLanguage, string> = {
  uk: "Почати налаштування",
  ru: "Начать настройку",
  en: "Start onboarding",
}

const deletionFarewell = (language: CoachLanguage, name: string): string => {
  switch (language) {
    case "uk":
      return `Ваш простір Praximo «${name}» видалено. Бот більше не підключений до Praximo.`
    case "ru":
      return `Ваше пространство Praximo «${name}» удалено. Бот больше не подключён к Praximo.`
    case "en":
      return `Your Praximo workspace “${name}” has been deleted. The bot is no longer connected to Praximo.`
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const initData = yield* ManagerInitData.Service
    const admins = yield* AdminRepo.Service
    const workspaces = yield* WorkspaceRepo.Service
    const onboarding = yield* CoachOnboardingRepo.Service
    const tokens = yield* CoachOnboardingToken.Service
    const storage = yield* WorkspaceBrandingStorage.Service
    const sender = yield* ManagerBotSender.Service
    const botBranding = yield* CoachBotBranding.Service
    const deletions = yield* WorkspaceDeletionRepo.Service
    const runCancellation = yield* WorkspaceRunCancellation.Service
    const botRelease = yield* CoachBotRelease.Service
    const verifyAdmin = Effect.fn("AdminSurface.verifyAdmin")(function* (rawInitData: string) {
      const telegramId = yield* initData
        .verify(rawInitData)
        .pipe(Effect.mapError(() => new AccessDenied()))

      yield* admins
        .findByTelegramId(telegramId)
        .pipe(
          Effect.mapError((error) =>
            error._tag === "Domain.AdminNotFound"
              ? new AccessDenied()
              : new LoadFailed({ operation: "findAdmin" }),
          ),
        )
      return telegramId
    })

    const listWorkspaces = Effect.fn("AdminSurface.listWorkspaces")(function* (
      rawInitData: string,
    ) {
      yield* verifyAdmin(rawInitData)

      return yield* workspaces
        .list()
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "listWorkspaces" })))
    })

    const loadWorkspace = Effect.fn("AdminSurface.loadWorkspace")(function* (
      rawWorkspaceId: string,
    ) {
      const workspaceId = yield* decodeWorkspaceId(rawWorkspaceId).pipe(
        Effect.mapError(() => new LoadFailed({ operation: "getWorkspace" })),
      )
      return yield* workspaces
        .getDetail(workspaceId)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "getWorkspace" })))
    })

    const presentWorkspace = Effect.fn("AdminSurface.presentWorkspace")(function* (
      detail: WorkspaceRepo.Detail,
    ) {
      const now = new Date(yield* Clock.currentTimeMillis)
      const inviteStatus =
        detail.invite?.status === "pending" && detail.invite.expiresAt.getTime() <= now.getTime()
          ? "expired"
          : detail.invite?.status
      const canReissue =
        detail.botStatus === "awaiting-setup" && detail.ownerTelegramUserId === undefined
      const link =
        detail.invite !== undefined && inviteStatus === "pending" && canReissue
          ? yield* tokens.linkFor(detail.invite.code)
          : undefined

      return {
        id: detail.id,
        name: detail.name,
        ...(detail.description === undefined ? {} : { description: detail.description }),
        ...(detail.shortDescription === undefined
          ? {}
          : { shortDescription: detail.shortDescription }),
        hasCustomAvatar: detail.avatarR2Key !== undefined,
        createdAt: detail.createdAt.toISOString(),
        updatedAt: detail.updatedAt.toISOString(),
        ...(detail.coachLanguage === undefined ? {} : { coachLanguage: detail.coachLanguage }),
        botStatus: detail.botStatus,
        ...(detail.botUsername === undefined ? {} : { botUsername: detail.botUsername }),
        ...(detail.termsAcceptedAt === undefined
          ? {}
          : { termsAcceptedAt: detail.termsAcceptedAt.toISOString() }),
        ...(detail.lastLoginAt === undefined
          ? {}
          : { lastLoginAt: detail.lastLoginAt.toISOString() }),
        ...(detail.lastActivityAt === undefined
          ? {}
          : { lastActivityAt: detail.lastActivityAt.toISOString() }),
        ...(detail.invite === undefined || inviteStatus === undefined
          ? {}
          : {
              invite: {
                id: detail.invite.id,
                status: inviteStatus,
                issuedAt: detail.invite.issuedAt.toISOString(),
                expiresAt: detail.invite.expiresAt.toISOString(),
                ...(link === undefined ? {} : { link }),
              },
            }),
        canReissue,
      } satisfies WorkspaceDetail
    })

    const getWorkspace = Effect.fn("AdminSurface.getWorkspace")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
    ) {
      yield* verifyAdmin(rawInitData)
      return yield* presentWorkspace(yield* loadWorkspace(rawWorkspaceId))
    })

    const getWorkspaceAvatar = Effect.fn("AdminSurface.getWorkspaceAvatar")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
    ) {
      yield* verifyAdmin(rawInitData)
      const detail = yield* loadWorkspace(rawWorkspaceId)
      if (detail.avatarR2Key === undefined) return yield* new AvatarUnavailable()
      return yield* storage
        .getAvatar(detail.avatarR2Key)
        .pipe(Effect.mapError(() => new AvatarUnavailable()))
    })

    const buildResult = Effect.fn("AdminSurface.buildResult")(function* (
      aggregate: CoachOnboardingRepo.Aggregate,
      delivery: DeliveryStatus,
      language: CoachLanguage,
    ) {
      const link = yield* tokens.linkFor(aggregate.invite.code)
      return {
        workspace: WorkspaceRepo.ListItem.make({
          id: aggregate.workspace.id,
          name: aggregate.workspace.name,
          botStatus: "awaiting-setup",
          hasCustomAvatar: aggregate.workspace.avatarR2Key !== undefined,
        }),
        inviteId: aggregate.invite.id,
        link,
        expiresAt: aggregate.invite.expiresAt.toISOString(),
        delivery,
        message: forwardableMessage(language, aggregate.workspace.name, link),
      } satisfies CreateResult
    })

    /**
     * Interim Telegram channel until the prepared share message (#104): the
     * forwardable message goes to the manager's own chat. A successful send is
     * remembered on the invite row; the record is best-effort — the message
     * already left, so a bookkeeping failure must not fail the operation.
     */
    const deliver = Effect.fn("AdminSurface.deliver")(function* (
      recipient: TelegramId,
      aggregate: CoachOnboardingRepo.Aggregate,
      language: CoachLanguage,
    ) {
      const result = yield* buildResult(aggregate, "sent", language)
      return yield* sender.sendText(recipient, result.message).pipe(
        Effect.andThen(
          onboarding
            .recordDelivery(aggregate.invite.id, {
              channel: "telegram",
              destination: recipient,
              language,
            })
            .pipe(Effect.ignore),
        ),
        Effect.as(result),
        Effect.catchTag("ManagerBotSender.SendFailed", () =>
          buildResult(aggregate, "failed", language),
        ),
      )
    })

    /**
     * The lazy create behind the delivery actions (#103): the workspace +
     * invite come into being on the first action, and a retry of the same
     * action replays the same aggregate (requestId idempotency) and delivers
     * again — repeat delivery is the point of a retry, duplication is not.
     */
    const createWorkspace = Effect.fn("AdminSurface.createWorkspace")(function* (
      rawInitData: string,
      rawInput: unknown,
      rawDelivery: unknown,
    ) {
      const recipient = yield* verifyAdmin(rawInitData)
      const input = yield* decodeCreateInput(rawInput).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const delivery = yield* decodeCreateDelivery(rawDelivery).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            requestId: input.requestId,
            name: input.name ?? null,
            coachLanguage: input.coachLanguage ?? null,
            description: input.description ?? null,
            shortDescription: input.shortDescription ?? null,
            avatarDigest: null,
          }),
        )
        .digest("hex")
      const now = new Date(yield* Clock.currentTimeMillis)
      const outcome = yield* onboarding
        .createOrGet({
          requestId: input.requestId,
          requestFingerprint: fingerprint,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.coachLanguage === undefined ? {} : { coachLanguage: input.coachLanguage }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.shortDescription === undefined
            ? {}
            : { shortDescription: input.shortDescription }),
          issuedByTelegramId: recipient,
          now,
        })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "CoachOnboardingRepo.IdempotencyConflict"
              ? new IdempotencyConflict()
              : new LoadFailed({ operation: "createWorkspace" }),
          ),
        )

      switch (delivery.channel) {
        case "copy": {
          // The record *is* the delivery evidence for the copy channel, so
          // unlike the telegram bookkeeping it must not be best-effort.
          yield* onboarding
            .recordDelivery(outcome.aggregate.invite.id, {
              channel: "copy",
              language: delivery.language,
            })
            .pipe(Effect.mapError(() => new LoadFailed({ operation: "createWorkspace.record" })))
          return yield* buildResult(outcome.aggregate, "sent", delivery.language)
        }
        case "telegram":
          // The invite is only minted here; the manager shares it from the Mini
          // App in a follow-up `prepareInviteShareMessage` + `WebApp.shareMessage`
          // step. Delivery stays "unknown" because the chat picker can still be
          // cancelled, and nothing is recorded until a prepared message is saved.
          return yield* buildResult(outcome.aggregate, "unknown", delivery.language)
      }
    })

    /**
     * The Telegram share step (#104): mint a short-lived prepared inline message
     * the manager forwards into a coach's chat via the native picker. The coach
     * receives a *bot-authored* message carrying the onboarding deep-link button.
     * Prepared messages are short-lived, so this runs on tap, not on page load.
     */
    const prepareInviteShareMessage = Effect.fn("AdminSurface.prepareInviteShareMessage")(
      function* (rawInitData: string, rawInviteId: string, rawLanguage: unknown) {
        const recipient = yield* verifyAdmin(rawInitData)
        const inviteId = yield* decodeInviteId(rawInviteId).pipe(
          Effect.mapError(() => new LoadFailed({ operation: "prepareInviteShareMessage" })),
        )
        const language = yield* decodeCoachLanguage(rawLanguage).pipe(
          Effect.mapError(() => new ValidationFailed()),
        )
        const aggregate = yield* onboarding
          .verifyPending(inviteId, new Date(yield* Clock.currentTimeMillis))
          .pipe(Effect.mapError(() => new LoadFailed({ operation: "prepareInviteShareMessage" })))

        const link = yield* tokens.linkFor(aggregate.invite.code)
        const prepared = yield* sender
          .prepareInlineInvite(recipient, {
            title: aggregate.workspace.name.length === 0 ? "Praximo" : aggregate.workspace.name,
            text: forwardableMessage(language, aggregate.workspace.name, link),
            buttonText: startOnboardingLabel[language],
            buttonUrl: link,
          })
          .pipe(Effect.mapError(() => new SharePreparationFailed()))

        // Delivery is recorded only once the client confirms the share landed
        // (`recordInviteShare`) — a cancelled picker prepared a message that was
        // never sent, so recording here would mislabel a dismissal as delivered.
        return { preparedMessageId: prepared.id } satisfies PrepareShareResult
      },
    )

    /**
     * Record that a Telegram invite left through the share sheet — the only
     * server-visible evidence of an outcome the Mini App observes client-side.
     * Called after the picker confirms a share (or after the pre-8.0 share-url
     * fallback opens), never on a dismissal. The coach is unknown until they
     * claim the invite, so no destination is recorded. Best-effort: the invite
     * is already out, so a bookkeeping hiccup must not fail the caller.
     */
    const recordInviteShare = Effect.fn("AdminSurface.recordInviteShare")(function* (
      rawInitData: string,
      rawInviteId: string,
      rawLanguage: unknown,
    ) {
      yield* verifyAdmin(rawInitData)
      const inviteId = yield* decodeInviteId(rawInviteId).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const language = yield* decodeCoachLanguage(rawLanguage).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      yield* onboarding
        .recordDelivery(inviteId, { channel: "telegram", language })
        .pipe(Effect.ignore)
    })

    const resendInvite = Effect.fn("AdminSurface.resendInvite")(function* (
      rawInitData: string,
      rawInviteId: string,
    ) {
      const recipient = yield* verifyAdmin(rawInitData)
      const inviteId = Schema.decodeUnknownEffect(
        Schema.NonEmptyString.pipe(Schema.brand("CoachOnboardingInviteId")),
      )(rawInviteId).pipe(Effect.mapError(() => new LoadFailed({ operation: "resendInvite" })))
      const aggregate = yield* onboarding
        .verifyPending(yield* inviteId, new Date(yield* Clock.currentTimeMillis))
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "resendInvite" })))
      // Resend keeps the language the invite last left in.
      return yield* deliver(
        recipient,
        aggregate,
        aggregate.invite.delivery?.language ?? aggregate.owner.language,
      )
    })

    const applyBranding = Effect.fn("AdminSurface.applyBranding")(function* (
      detail: WorkspaceRepo.Detail,
      retryAvatar: boolean,
    ) {
      if (detail.botStatus !== "connected") return "saved" as const
      const avatar = retryAvatar
        ? CoachBotBranding.AvatarUpdate.cases.Apply.make({
            r2Key: yield* storage.resolveAvatarKey(detail.avatarR2Key),
          })
        : CoachBotBranding.AvatarUpdate.cases.Keep.make({})
      return yield* botBranding
        .apply({
          workspaceId: detail.id,
          ...(detail.description === undefined ? {} : { description: detail.description }),
          ...(detail.shortDescription === undefined
            ? {}
            : { shortDescription: detail.shortDescription }),
          avatar,
        })
        .pipe(
          Effect.as("saved" as const),
          Effect.catchTag("CoachBotBranding.ApplyFailed", () =>
            Effect.succeed("saved-branding-failed" as const),
          ),
        )
    })

    const updateWorkspaceProfile = Effect.fn("AdminSurface.updateWorkspaceProfile")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
      rawInput: unknown,
      avatar?: Uint8Array,
    ) {
      yield* verifyAdmin(rawInitData)
      const workspaceId = yield* decodeWorkspaceId(rawWorkspaceId).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const input = yield* decodeUpdateInput(rawInput).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      if ((input.avatarIntent === "replace") !== (avatar !== undefined)) {
        return yield* new ValidationFailed()
      }
      const existing = yield* workspaces
        .getDetail(workspaceId)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "updateProfile.load" })))
      const storedAvatar =
        input.avatarIntent === "replace" && avatar !== undefined
          ? yield* storage.putAvatar(input.requestId, avatar)
          : undefined
      const nextAvatarKey =
        input.avatarIntent === "keep"
          ? existing.avatarR2Key
          : input.avatarIntent === "replace"
            ? storedAvatar?.key
            : undefined
      const expectedUpdatedAt = DateTime.toDate(input.expectedUpdatedAt)
      const updateTime = new Date(
        Math.max(yield* Clock.currentTimeMillis, expectedUpdatedAt.getTime() + 1),
      )
      const update = yield* workspaces
        .updateProfile({
          id: workspaceId,
          expectedUpdatedAt,
          name: input.name,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.shortDescription === undefined
            ? {}
            : { shortDescription: input.shortDescription }),
          ...(nextAvatarKey === undefined ? {} : { avatarR2Key: nextAvatarKey }),
          now: updateTime,
        })
        .pipe(Effect.result)

      let updated: WorkspaceRepo.Detail
      if (Result.isFailure(update)) {
        const reconciliation = yield* workspaces.getDetail(workspaceId).pipe(Effect.result)
        const reconciled =
          Result.isSuccess(reconciliation) &&
          reconciliation.success.name === input.name &&
          reconciliation.success.description === input.description &&
          reconciliation.success.shortDescription === input.shortDescription &&
          reconciliation.success.avatarR2Key === nextAvatarKey
            ? reconciliation.success
            : undefined
        if (reconciled !== undefined) {
          updated = reconciled
        } else {
          if (
            storedAvatar !== undefined &&
            (Result.isFailure(reconciliation) ||
              reconciliation.success.avatarR2Key !== storedAvatar.key)
          ) {
            if (Result.isSuccess(reconciliation)) {
              yield* storage.deleteAvatar(storedAvatar.key).pipe(Effect.ignore)
            }
          }
          if (update.failure._tag === "WorkspaceRepo.UpdateConflict") {
            return yield* new ProfileConflict()
          }
          return yield* new LoadFailed({ operation: "updateProfile.save" })
        }
      } else {
        updated = update.success
      }

      if (
        existing.avatarR2Key !== undefined &&
        existing.avatarR2Key !== updated.avatarR2Key &&
        input.avatarIntent !== "keep"
      ) {
        yield* storage.deleteAvatar(existing.avatarR2Key).pipe(Effect.ignore)
      }
      const retryAvatar = input.avatarIntent !== "keep"
      const status = yield* applyBranding(updated, retryAvatar)
      return {
        workspace: yield* presentWorkspace(updated),
        status,
        retryAvatar,
      } satisfies UpdateProfileResult
    })

    const retryWorkspaceBranding = Effect.fn("AdminSurface.retryWorkspaceBranding")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
      retryAvatar: boolean,
    ) {
      yield* verifyAdmin(rawInitData)
      const detail = yield* loadWorkspace(rawWorkspaceId)
      const status = yield* applyBranding(detail, retryAvatar)
      return {
        workspace: yield* presentWorkspace(detail),
        status,
        retryAvatar,
      } satisfies UpdateProfileResult
    })

    const reissueWorkspaceInvite = Effect.fn("AdminSurface.reissueWorkspaceInvite")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
      rawExpectedInviteId: string,
      rawRequestId: string,
    ) {
      const recipient = yield* verifyAdmin(rawInitData)
      const workspaceId = yield* decodeWorkspaceId(rawWorkspaceId).pipe(
        Effect.mapError(() => new ReissueUnavailable()),
      )
      const expectedInviteId = yield* decodeInviteId(rawExpectedInviteId).pipe(
        Effect.mapError(() => new ReissueUnavailable()),
      )
      const requestId = yield* decodeRequestId(rawRequestId).pipe(
        Effect.mapError(() => new ReissueUnavailable()),
      )
      const aggregate = yield* onboarding
        .reissue({
          workspaceId,
          expectedInviteId,
          requestId,
          issuedByTelegramId: recipient,
          now: new Date(yield* Clock.currentTimeMillis),
        })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "CoachOnboardingRepo.ReissueUnavailable"
              ? new ReissueUnavailable()
              : new LoadFailed({ operation: "reissueInvite" }),
          ),
        )
      return yield* deliver(recipient, aggregate, aggregate.owner.language)
    })

    const deleteWorkspace = Effect.fn("AdminSurface.deleteWorkspace")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
      rawInput: unknown,
    ) {
      yield* verifyAdmin(rawInitData)
      const workspaceId = yield* decodeWorkspaceId(rawWorkspaceId).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const input = yield* decodeDeleteInput(rawInput).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      let operation = yield* deletions
        .prepare(
          workspaceId,
          input.requestId,
          input.confirmationName,
          new Date(yield* Clock.currentTimeMillis),
        )
        .pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "WorkspaceDeletionRepo.NameMismatch":
                return new DeleteConfirmationMismatch()
              case "WorkspaceDeletionRepo.RequestConflict":
                return new DeletionConflict()
              default:
                return new LoadFailed({ operation: "deleteWorkspace.prepare" })
            }
          }),
        )

      // prepare may adopt an in-flight operation created under an earlier
      // requestId (the client mints a fresh one per dialog mount). Drive the
      // remaining stages by the operation's own requestId, not the client input.
      const operationRequestId = operation.requestId

      if (operation.state === "completed") {
        return {
          status:
            operation.farewellStatus === "undeliverable"
              ? "deleted-farewell-undeliverable"
              : "deleted",
        } satisfies DeleteResult
      }

      if (operation.pipelineStatus === "pending") {
        const cancellation = yield* runCancellation.cancel(workspaceId)
        if (WorkspaceRunCancellationResult.guards.Failed(cancellation)) {
          return yield* new DeletionRetryable({ operation: "pipeline" })
        }
        operation = yield* deletions
          .markPipeline(
            operationRequestId,
            WorkspaceRunCancellationResult.guards.Cancelled(cancellation)
              ? "cancelled"
              : "nothing-active",
            new Date(yield* Clock.currentTimeMillis),
          )
          .pipe(Effect.mapError(() => new DeletionRetryable({ operation: "pipeline" })))
      }

      if (operation.farewellStatus === "pending") {
        if (
          operation.coachTelegramId === undefined ||
          operation.coachLanguage === undefined ||
          operation.workspaceName === undefined
        ) {
          operation = yield* deletions
            .markFarewell(
              operationRequestId,
              "not-applicable",
              new Date(yield* Clock.currentTimeMillis),
            )
            .pipe(Effect.mapError(() => new DeletionRetryable({ operation: "farewell" })))
        } else {
          const recipient = yield* Schema.decodeUnknownEffect(TelegramId)(
            operation.coachTelegramId,
          ).pipe(Effect.mapError(() => new DeletionRetryable({ operation: "farewell" })))
          const farewell = yield* sender
            .sendText(recipient, deletionFarewell(operation.coachLanguage, operation.workspaceName))
            .pipe(Effect.result)
          if (Result.isFailure(farewell) && farewell.failure.category !== "undeliverable") {
            return yield* new DeletionRetryable({ operation: "farewell" })
          }
          operation = yield* deletions
            .markFarewell(
              operationRequestId,
              Result.isFailure(farewell) ? "undeliverable" : "sent",
              new Date(yield* Clock.currentTimeMillis),
            )
            .pipe(Effect.mapError(() => new DeletionRetryable({ operation: "farewell" })))
        }
      }

      if (operation.botReleaseStatus === "pending") {
        const released = yield* botRelease.release(workspaceId)
        if (CoachBotRelease.Result.guards.Failed(released)) {
          return yield* released.retryable
            ? new DeletionRetryable({ operation: "bot-release" })
            : new DeletionFailed({ operation: "bot-release" })
        }
        operation = yield* deletions
          .markBotReleased(
            operationRequestId,
            CoachBotRelease.Result.guards.Released(released)
              ? "released"
              : CoachBotRelease.Result.guards.AlreadyReleased(released)
                ? "already-released"
                : "not-connected",
            new Date(yield* Clock.currentTimeMillis),
          )
          .pipe(Effect.mapError(() => new DeletionRetryable({ operation: "bot-release" })))
      }

      operation = yield* deletions
        .finalize(operationRequestId, new Date(yield* Clock.currentTimeMillis))
        .pipe(Effect.mapError(() => new DeletionRetryable({ operation: "finalize" })))
      yield* runCancellation.kickObjectCleanup()

      return {
        status:
          operation.farewellStatus === "undeliverable"
            ? "deleted-farewell-undeliverable"
            : "deleted",
      } satisfies DeleteResult
    })

    return Service.of({
      listWorkspaces,
      createWorkspace,
      prepareInviteShareMessage,
      recordInviteShare,
      resendInvite,
      getWorkspace,
      getWorkspaceAvatar,
      updateWorkspaceProfile,
      retryWorkspaceBranding,
      reissueWorkspaceInvite,
      deleteWorkspace,
    })
  }),
)

export * as AdminSurface from "./admin-surface.ts"
