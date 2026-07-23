import { createHash } from "node:crypto"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, WorkspaceRepo } from "@praximo/db"
import {
  CoachLanguage,
  CreateWorkspaceInput,
  TelegramId,
  UpdateWorkspaceProfileInput,
  WorkspaceId,
} from "@praximo/domain"
import { CoachBotBranding, ManagerBotSender } from "@praximo/telegram"
import { Clock, Context, DateTime, Effect, Layer, Result, Schema } from "effect"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"

export type DeliveryStatus = "sent" | "failed" | "unknown"

export interface CreateResult {
  readonly workspace: WorkspaceRepo.ListItem
  readonly inviteId: string
  readonly link: string
  readonly expiresAt: string
  readonly delivery: DeliveryStatus
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

export interface Interface {
  readonly listWorkspaces: (
    initData: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceRepo.ListItem>, AccessDenied | LoadFailed>
  readonly createWorkspace: (
    initData: string,
    input: unknown,
    avatar?: Uint8Array,
  ) => Effect.Effect<
    CreateResult,
    | AccessDenied
    | ValidationFailed
    | IdempotencyConflict
    | WorkspaceBrandingStorage.InvalidAvatar
    | WorkspaceBrandingStorage.UploadFailed
    | LoadFailed
  >
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

export class AvatarUnavailable extends Schema.TaggedErrorClass<AvatarUnavailable>()(
  "AdminSurface.AvatarUnavailable",
  {},
) {}

const decodeCreateInput = Schema.decodeUnknownEffect(CreateWorkspaceInput)
const decodeUpdateInput = Schema.decodeUnknownEffect(UpdateWorkspaceProfileInput)
const decodeWorkspaceId = Schema.decodeUnknownEffect(WorkspaceId)
const decodeInviteId = Schema.decodeUnknownEffect(
  Schema.NonEmptyString.pipe(Schema.brand("CoachOnboardingInviteId")),
)
const decodeRequestId = Schema.decodeUnknownEffect(Schema.String.check(Schema.isUUID(4)))

const forwardableMessage = (language: CoachLanguage, name: string, link: string): string => {
  switch (language) {
    case "uk":
      return `Ваш простір Praximo «${name}» готовий.\n\nВідкрийте це одноразове посилання протягом 7 днів, щоб підключити свого бота:\n${link}`
    case "ru":
      return `Ваше пространство Praximo «${name}» готово.\n\nОткройте эту одноразовую ссылку в течение 7 дней, чтобы подключить своего бота:\n${link}`
    case "en":
      return `Your Praximo workspace “${name}” is ready.\n\nOpen this one-time link within 7 days to connect your bot:\n${link}`
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
          ? yield* tokens
              .linkFor(detail.invite.id)
              .pipe(Effect.mapError(() => new LoadFailed({ operation: "getWorkspace.link" })))
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
    ) {
      const link = yield* tokens
        .linkFor(aggregate.invite.id)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "buildInviteLink" })))
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
      } satisfies CreateResult
    })

    const deliver = Effect.fn("AdminSurface.deliver")(function* (
      recipient: TelegramId,
      aggregate: CoachOnboardingRepo.Aggregate,
    ) {
      const result = yield* buildResult(aggregate, "sent")
      return yield* sender
        .sendText(
          recipient,
          forwardableMessage(aggregate.owner.language, aggregate.workspace.name, result.link),
        )
        .pipe(
          Effect.as(result),
          Effect.catchTag("ManagerBotSender.SendFailed", () => buildResult(aggregate, "failed")),
        )
    })

    const createWorkspace = Effect.fn("AdminSurface.createWorkspace")(function* (
      rawInitData: string,
      rawInput: unknown,
      avatar?: Uint8Array,
    ) {
      const recipient = yield* verifyAdmin(rawInitData)
      const input = yield* decodeCreateInput(rawInput).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const inspectedAvatar =
        avatar === undefined ? undefined : yield* storage.inspectAvatar(avatar)
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            requestId: input.requestId,
            name: input.name,
            coachLanguage: input.coachLanguage,
            description: input.description ?? null,
            shortDescription: input.shortDescription ?? null,
            avatarDigest: inspectedAvatar?.digest ?? null,
          }),
        )
        .digest("hex")
      const now = new Date(yield* Clock.currentTimeMillis)
      const dbInput = (avatarR2Key?: string): CoachOnboardingRepo.CreateInput => ({
        requestId: input.requestId,
        requestFingerprint: fingerprint,
        name: input.name,
        coachLanguage: input.coachLanguage,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.shortDescription === undefined
          ? {}
          : { shortDescription: input.shortDescription }),
        ...(avatarR2Key === undefined ? {} : { avatarR2Key }),
        now,
      })
      const preflight = yield* onboarding
        .lookupCreate(dbInput())
        .pipe(
          Effect.mapError((error) =>
            error._tag === "CoachOnboardingRepo.IdempotencyConflict"
              ? new IdempotencyConflict()
              : new LoadFailed({ operation: "createWorkspace.preflight" }),
          ),
        )
      if (preflight !== undefined) return yield* buildResult(preflight.aggregate, "unknown")

      const storedAvatar =
        avatar === undefined || inspectedAvatar === undefined
          ? undefined
          : yield* storage.putInspectedAvatar(input.requestId, avatar, inspectedAvatar)
      const creation = yield* onboarding.createOrGet(dbInput(storedAvatar?.key)).pipe(Effect.result)

      if (Result.isSuccess(creation)) {
        const outcome = creation.success
        if (
          !outcome.created &&
          storedAvatar !== undefined &&
          outcome.aggregate.workspace.avatarR2Key !== storedAvatar.key
        ) {
          yield* storage.deleteAvatar(storedAvatar.key).pipe(Effect.ignore)
        }
        if (!outcome.created) return yield* buildResult(outcome.aggregate, "unknown")
        return yield* deliver(recipient, outcome.aggregate)
      }

      const reconciled = yield* onboarding
        .lookupCreate(
          dbInput(
            creation.failure._tag === "CoachOnboardingRepo.IdempotencyConflict"
              ? creation.failure.existingAvatarR2Key
              : storedAvatar?.key,
          ),
        )
        .pipe(Effect.result)
      if (Result.isFailure(reconciled)) {
        if (reconciled.failure._tag === "CoachOnboardingRepo.IdempotencyConflict") {
          if (
            storedAvatar !== undefined &&
            reconciled.failure.existingAvatarR2Key !== storedAvatar.key
          ) {
            yield* storage.deleteAvatar(storedAvatar.key).pipe(Effect.ignore)
          }
          return yield* new IdempotencyConflict()
        }
        return yield* new LoadFailed({ operation: "createWorkspace.reconcile" })
      }
      if (Result.isSuccess(reconciled) && reconciled.success !== undefined) {
        if (
          storedAvatar !== undefined &&
          reconciled.success.aggregate.workspace.avatarR2Key !== storedAvatar.key
        ) {
          yield* storage.deleteAvatar(storedAvatar.key).pipe(Effect.ignore)
        }
        return yield* buildResult(reconciled.success.aggregate, "unknown")
      }
      if (storedAvatar !== undefined) {
        yield* storage.deleteAvatar(storedAvatar.key).pipe(Effect.ignore)
      }
      return yield* creation.failure._tag === "CoachOnboardingRepo.IdempotencyConflict"
        ? new IdempotencyConflict()
        : new LoadFailed({ operation: "createWorkspace" })
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
      return yield* deliver(recipient, aggregate)
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
          now: new Date(yield* Clock.currentTimeMillis),
        })
        .pipe(
          Effect.mapError((error) =>
            error._tag === "CoachOnboardingRepo.ReissueUnavailable"
              ? new ReissueUnavailable()
              : new LoadFailed({ operation: "reissueInvite" }),
          ),
        )
      return yield* deliver(recipient, aggregate)
    })

    return Service.of({
      listWorkspaces,
      createWorkspace,
      resendInvite,
      getWorkspace,
      getWorkspaceAvatar,
      updateWorkspaceProfile,
      retryWorkspaceBranding,
      reissueWorkspaceInvite,
    })
  }),
)

export * as AdminSurface from "./admin-surface.ts"
