import { createHash } from "node:crypto"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, WorkspaceRepo } from "@praximo/db"
import { CoachLanguage, CreateWorkspaceInput, TelegramId } from "@praximo/domain"
import { ManagerBotSender } from "@praximo/telegram"
import { Clock, Context, Effect, Layer, Result, Schema } from "effect"
import { WorkspaceBrandingStorage } from "./workspace-branding-storage.ts"

export type DeliveryStatus = "sent" | "failed" | "unknown"

export interface CreateResult {
  readonly workspace: WorkspaceRepo.ListItem
  readonly inviteId: string
  readonly link: string
  readonly expiresAt: string
  readonly delivery: DeliveryStatus
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

const decodeCreateInput = Schema.decodeUnknownEffect(CreateWorkspaceInput)

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
          botStatus: "provisioning",
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

    return Service.of({ listWorkspaces, createWorkspace, resendInvite })
  }),
)

export * as AdminSurface from "./admin-surface.ts"
