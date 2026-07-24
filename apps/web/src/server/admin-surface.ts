import { createHash } from "node:crypto"
import { CoachOnboardingToken, ManagerInitData } from "@praximo/auth"
import { AdminRepo, CoachOnboardingRepo, WorkspaceDeletionRepo, WorkspaceRepo } from "@praximo/db"
import {
  CoachLanguage,
  type CoachOnboardingInviteCancellationReason,
  type CoachOnboardingInviteStatus,
  CreateInviteDelivery,
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  type InviteDeliveryChannel,
  RenameWorkspaceInput,
  TelegramId,
  WorkspaceId,
  WorkspaceRunCancellationResult,
} from "@praximo/domain"
import { CoachBotRelease, ManagerBotSender } from "@praximo/telegram"
import { Clock, Context, DateTime, Effect, Layer, Result, Schema } from "effect"
import { WorkspaceRunCancellation } from "./workspace-run-cancellation.ts"

export type DeliveryStatus = "sent" | "failed" | "unknown"

export interface CreateResult {
  readonly workspaceId: WorkspaceId
  readonly inviteId: string
  readonly link: string
  readonly expiresAt: string
  readonly delivery: DeliveryStatus
  /** The full forwardable invite message in the chosen invite language. */
  readonly message: string
}

/**
 * Where a coach stands on the accepted onboarding lifecycle (#112), as the
 * coaches list reads it. Every stage but `not-invited` is recoverable state the
 * admin can act on; an active coach carries no stage at all.
 *
 * - `invited` — a live `pending` invite; the only stage with a countdown.
 * - `accepted` — the claim is exclusive; the invite TTL no longer applies.
 * - `stalled` — accepted over 24h ago and still incomplete. Informational only:
 *   it never releases the claim.
 * - `bot-connected` — provisioning finished, first login + ToS still pending.
 * - `expired` — an unaccepted invite reached its TTL.
 * - `declined` / `reset` — terminal cancellation, by the coach or the admin.
 * - `not-invited` — a workspace with no invite row at all.
 */
export type CoachOnboardingStage =
  | "invited"
  | "accepted"
  | "stalled"
  | "bot-connected"
  | "expired"
  | "declined"
  | "reset"
  | "not-invited"

/**
 * The list is a read surface: a row states where the coach stands and links
 * through to the details screen, which owns Resend / Copy and every other
 * invite action (#108). Nothing here mints a link or a message per row.
 */
export interface CoachOnboarding {
  readonly stage: CoachOnboardingStage
  readonly channel?: InviteDeliveryChannel
  /** Only ever set while `invited` — an accepted claim shows no countdown. */
  readonly expiresAt?: string
  readonly acceptedAt?: string
  readonly cancelledAt?: string
}

export interface CoachListEntry {
  readonly id: WorkspaceId
  readonly name: string
  readonly botStatus: WorkspaceRepo.BotConnectionStatus
  readonly botUsername?: string
  readonly lastActivityAt?: string
  /** Absent exactly when onboarding is complete — an active coach. */
  readonly onboarding?: CoachOnboarding
  /**
   * A deletion is in flight for this coach (#110). It outranks every other
   * state the row could report: nothing else about a workspace being purged is
   * worth acting on, and the row's only remaining job is to offer a resume.
   */
  readonly deleting?: true
}

/**
 * The admin's own coach hat, when they wear one. Resolved from the same
 * aggregate the list is built from, so the contextual action costs no extra
 * query and no extra entry hop (#107); #106 owns the general role dispatch.
 */
export type ViewerCoach =
  | { readonly state: "accepted"; readonly workspaceId: WorkspaceId; readonly link: string }
  | { readonly state: "bot-connected"; readonly workspaceId: WorkspaceId; readonly link: string }
  | { readonly state: "active"; readonly workspaceId: WorkspaceId; readonly link: string }

export interface CoachListResult {
  /** Incomplete onboarding first (newest invite first), then active coaches A→Z. */
  readonly coaches: ReadonlyArray<CoachListEntry>
  readonly viewerCoach?: ViewerCoach
}

export interface PrepareShareResult {
  /** The short-lived prepared-message id handed to `WebApp.shareMessage`. */
  readonly preparedMessageId: string
}

/**
 * The details screen's read model (#108). It is status-first: everything here
 * either says where the coach stands or names the one thing the admin still
 * owns — the internal label. Bot branding is absent by design; the coach owns
 * their bot's identity and rebrands from their side.
 *
 * `onboarding` is the same stage the list rows carry, so both surfaces agree on
 * what a coach's state is called. Its absence is the variant switch: a coach
 * with no stage has finished onboarding and gets the active screen.
 */
export interface WorkspaceDetail {
  readonly id: WorkspaceId
  readonly name: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly coachLanguage?: CoachLanguage
  readonly botStatus: WorkspaceRepo.BotConnectionStatus
  readonly botUsername?: string
  /** Onboarding completion — terms acceptance, or the owner member's creation. */
  readonly joinedAt?: string
  readonly termsAcceptedAt?: string
  readonly lastLoginAt?: string
  readonly lastActivityAt?: string
  readonly onboarding?: CoachOnboardingStage
  readonly invite?: {
    readonly id: string
    readonly status: CoachOnboardingInviteStatus
    readonly channel?: InviteDeliveryChannel
    readonly issuedAt: string
    readonly expiresAt: string
    readonly acceptedAt?: string
    readonly cancelledAt?: string
    readonly cancellationReason?: CoachOnboardingInviteCancellationReason
    /** Minted only while the invite is still claimable — the copy/share source. */
    readonly link?: string
    /** The forwardable message a resend shares, in the invite's own language. */
    readonly message?: string
    readonly language?: CoachLanguage
  }
  readonly canReissue: boolean
}

export interface DeleteResult {
  readonly status: "deleted" | "deleted-farewell-undeliverable"
}

/**
 * The deletion pipeline as the progress sheet reads it (#110): one settled-or-
 * pending status per stage, straight off the operation's own receipt, plus how
 * long the current driver's claim still has to run.
 *
 * It survives its own workspace: the receipt is kept for a week after the
 * cascade, so the sheet can watch the last stage complete instead of losing
 * the screen the moment the workspace row disappears.
 */
export interface DeletionProgress {
  readonly workspaceId: WorkspaceId
  readonly state: "prepared" | "completed"
  readonly pipeline: WorkspaceDeletionRepo.PipelineStatus
  readonly farewell: WorkspaceDeletionRepo.FarewellStatus
  readonly botRelease: WorkspaceDeletionRepo.BotReleaseStatus
  /** The label the workspace carried; absent once the cascade has removed it. */
  readonly workspaceName?: string
  readonly startedAt: string
  /**
   * How much longer somebody is driving this operation — `0` when nobody is.
   * The driver lease answers that outright, so the screen no longer has to
   * infer it from how recently a stage happened to land.
   *
   * It is a duration rather than an instant on purpose: a client whose clock
   * disagrees with the server's would misread a deadline, and the two mistakes
   * are not symmetric — calling a live attempt "paused" invites a second one.
   */
  readonly drivingLapsesInMs: number
  readonly completedAt?: string
}

export interface Interface {
  readonly listWorkspaces: (
    initData: string,
  ) => Effect.Effect<CoachListResult, AccessDenied | LoadFailed>
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
  readonly getWorkspace: (
    initData: string,
    workspaceId: string,
  ) => Effect.Effect<WorkspaceDetail, AccessDenied | LoadFailed>
  readonly renameWorkspace: (
    initData: string,
    workspaceId: string,
    input: unknown,
  ) => Effect.Effect<WorkspaceDetail, AccessDenied | ValidationFailed | RenameConflict | LoadFailed>
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
    | DeletionConflict
    | DeletionRetryable
    | DeletionFailed
    | LoadFailed
  >
  readonly getWorkspaceDeletion: (
    initData: string,
    workspaceId: string,
  ) => Effect.Effect<DeletionProgress | undefined, AccessDenied | LoadFailed>
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

/** The label was renamed elsewhere since this screen loaded (#108). */
export class RenameConflict extends Schema.TaggedErrorClass<RenameConflict>()(
  "AdminSurface.RenameConflict",
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
const decodeRenameInput = Schema.decodeUnknownEffect(RenameWorkspaceInput)
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

/**
 * How long an accepted claim may sit incomplete before the card calls it out.
 * Informational only — the claim itself never lapses (#112).
 */
export const SetupStalledAfterMilliseconds = 24 * 60 * 60 * 1_000

/**
 * The three facts a lifecycle stage is read from. Structural rather than tied
 * to `ListItem`, so the list and the details screen — which project different
 * aggregates — cannot drift on what a coach's state is called (#108).
 */
interface OnboardingFacts {
  readonly termsAcceptedAt?: Date
  readonly botStatus: WorkspaceRepo.BotConnectionStatus
  readonly invite?: WorkspaceRepo.ListInvite
}

/**
 * Read the coach's position on the onboarding lifecycle off the aggregate row.
 * `undefined` means onboarding is complete: terms acceptance is the single
 * completion signal, so an active coach is never pinned to the top of the list.
 */
const onboardingStage = (item: OnboardingFacts, now: Date): CoachOnboardingStage | undefined => {
  if (item.termsAcceptedAt !== undefined) return undefined
  // A connected bot outranks whatever the invite row still says: provisioning
  // has happened, and only the coach's first login plus ToS is outstanding.
  if (item.botStatus !== "awaiting-setup") return "bot-connected"
  const invite = item.invite
  if (invite === undefined) return "not-invited"
  switch (invite.status) {
    case "pending":
      return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "invited"
    case "accepted":
      return invite.acceptedAt !== undefined &&
        now.getTime() - invite.acceptedAt.getTime() >= SetupStalledAfterMilliseconds
        ? "stalled"
        : "accepted"
    case "used":
      return "bot-connected"
    case "expired":
      return "expired"
    case "cancelled":
      return invite.cancellationReason === "declined_by_coach" ? "declined" : "reset"
  }
}

/** Project one aggregate row into the row the list renders. */
const presentCoach = (
  item: WorkspaceRepo.ListItem,
  stage: CoachOnboardingStage | undefined,
  deleting: boolean,
): CoachListEntry => {
  const invite = item.invite

  return {
    id: item.id,
    name: item.name,
    botStatus: item.botStatus,
    ...(deleting ? { deleting: true as const } : {}),
    ...(item.botUsername === undefined ? {} : { botUsername: item.botUsername }),
    ...(item.lastActivityAt === undefined
      ? {}
      : { lastActivityAt: item.lastActivityAt.toISOString() }),
    ...(stage === undefined
      ? {}
      : {
          onboarding: {
            stage,
            ...(invite?.delivery === undefined ? {} : { channel: invite.delivery.channel }),
            // The expiry is carried while the invite is still measured by
            // it — counting down, or already lapsed. An accepted claim
            // retired that deadline, so it never travels with one.
            ...((stage === "invited" || stage === "expired") && invite !== undefined
              ? { expiresAt: invite.expiresAt.toISOString() }
              : {}),
            ...(invite?.acceptedAt === undefined
              ? {}
              : { acceptedAt: invite.acceptedAt.toISOString() }),
            ...(invite?.cancelledAt === undefined
              ? {}
              : { cancelledAt: invite.cancelledAt.toISOString() }),
          },
        }),
  }
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
    const sender = yield* ManagerBotSender.Service
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

    /**
     * The admin's own coach hat, if any. An active bot outranks a bot-connected
     * one, which outranks an unclaimed-but-accepted invite — the most advanced
     * state is the one worth acting on.
     */
    const resolveViewerCoach = Effect.fn("AdminSurface.resolveViewerCoach")(function* (
      items: ReadonlyArray<WorkspaceRepo.ListItem>,
      viewer: TelegramId,
    ) {
      let accepted: ViewerCoach | undefined
      let connected: ViewerCoach | undefined
      for (const item of items) {
        if (item.ownerTelegramUserId === viewer && item.botUsername !== undefined) {
          const candidate = {
            state:
              item.termsAcceptedAt === undefined ? ("bot-connected" as const) : ("active" as const),
            workspaceId: item.id,
            link: `https://t.me/${item.botUsername}`,
          }
          if (candidate.state === "active") return candidate
          connected ??= candidate
          continue
        }
        if (
          accepted === undefined &&
          item.invite?.status === "accepted" &&
          item.invite.acceptedByTelegramId === viewer
        ) {
          // The original short code resumes the claim idempotently (#112), so
          // the deep link is the honest "continue where you left off" target.
          accepted = {
            state: "accepted",
            workspaceId: item.id,
            link: yield* tokens.linkFor(item.invite.code),
          }
        }
      }
      return connected ?? accepted
    })

    const listWorkspaces = Effect.fn("AdminSurface.listWorkspaces")(function* (
      rawInitData: string,
    ) {
      const viewer = yield* verifyAdmin(rawInitData)
      const items = yield* workspaces
        .list()
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "listWorkspaces" })))
      const now = new Date(yield* Clock.currentTimeMillis)
      const staged = items.map((item) => ({ item, stage: onboardingStage(item, now) }))

      // The repo already returns A→Z, which is the order active coaches keep.
      // Incomplete onboarding is pinned above them, newest invite first, so a
      // fresh invite lands where the admin is already looking.
      const incomplete = staged.filter((entry) => entry.stage !== undefined)
      // In-place is safe and intended: `filter` already handed back a private
      // array, and the ES2022 target has no `toSorted` to copy it again.
      // oxlint-disable-next-line unicorn/no-array-sort
      const pinned = incomplete.sort(
        (left, right) =>
          (right.item.invite?.issuedAt.getTime() ?? 0) -
          (left.item.invite?.issuedAt.getTime() ?? 0),
      )

      // One query for the whole list rather than one per row: a deletion in
      // flight is rare, so the common answer is an empty set.
      const deleting = new Set(
        yield* deletions
          .listPrepared()
          .pipe(Effect.mapError(() => new LoadFailed({ operation: "listWorkspaces.deleting" }))),
      )

      const coaches = [...pinned, ...staged.filter((entry) => entry.stage === undefined)].map(
        (entry) => presentCoach(entry.item, entry.stage, deleting.has(entry.item.id)),
      )

      const viewerCoach = yield* resolveViewerCoach(items, viewer)
      return {
        coaches,
        ...(viewerCoach === undefined ? {} : { viewerCoach }),
      } satisfies CoachListResult
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
      // A resend re-delivers the *same* invite, so it keeps the language that
      // invite last left in; English is the fallback the invite screen defaults
      // to when nothing was recorded.
      const language = detail.invite?.delivery?.language ?? "en"
      const stage = onboardingStage(detail, now)

      return {
        id: detail.id,
        name: detail.name,
        createdAt: detail.createdAt.toISOString(),
        updatedAt: detail.updatedAt.toISOString(),
        ...(detail.coachLanguage === undefined ? {} : { coachLanguage: detail.coachLanguage }),
        botStatus: detail.botStatus,
        ...(detail.botUsername === undefined ? {} : { botUsername: detail.botUsername }),
        ...(detail.joinedAt === undefined ? {} : { joinedAt: detail.joinedAt.toISOString() }),
        ...(detail.termsAcceptedAt === undefined
          ? {}
          : { termsAcceptedAt: detail.termsAcceptedAt.toISOString() }),
        ...(detail.lastLoginAt === undefined
          ? {}
          : { lastLoginAt: detail.lastLoginAt.toISOString() }),
        ...(detail.lastActivityAt === undefined
          ? {}
          : { lastActivityAt: detail.lastActivityAt.toISOString() }),
        ...(stage === undefined ? {} : { onboarding: stage }),
        ...(detail.invite === undefined || inviteStatus === undefined
          ? {}
          : {
              invite: {
                id: detail.invite.id,
                status: inviteStatus,
                ...(detail.invite.delivery === undefined
                  ? {}
                  : { channel: detail.invite.delivery.channel }),
                issuedAt: detail.invite.issuedAt.toISOString(),
                expiresAt: detail.invite.expiresAt.toISOString(),
                ...(detail.invite.acceptedAt === undefined
                  ? {}
                  : { acceptedAt: detail.invite.acceptedAt.toISOString() }),
                ...(detail.invite.cancelledAt === undefined
                  ? {}
                  : { cancelledAt: detail.invite.cancelledAt.toISOString() }),
                ...(detail.invite.cancellationReason === undefined
                  ? {}
                  : { cancellationReason: detail.invite.cancellationReason }),
                ...(link === undefined
                  ? {}
                  : {
                      link,
                      message: forwardableMessage(language, detail.name, link),
                      language,
                    }),
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

    const buildResult = Effect.fn("AdminSurface.buildResult")(function* (
      aggregate: CoachOnboardingRepo.Aggregate,
      delivery: DeliveryStatus,
      language: CoachLanguage,
    ) {
      const link = yield* tokens.linkFor(aggregate.invite.code)
      return {
        workspaceId: aggregate.workspace.id,
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

    /**
     * Rename the internal label — the only workspace field an admin writes
     * (#108). Optimistic concurrency is carried by `expectedUpdatedAt`: a stale
     * screen is refused rather than silently overwriting a concurrent rename.
     * A losing write is reconciled first, so a retry of a request that actually
     * landed reports success instead of a phantom conflict.
     */
    const renameWorkspace = Effect.fn("AdminSurface.renameWorkspace")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
      rawInput: unknown,
    ) {
      yield* verifyAdmin(rawInitData)
      const workspaceId = yield* decodeWorkspaceId(rawWorkspaceId).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const input = yield* decodeRenameInput(rawInput).pipe(
        Effect.mapError(() => new ValidationFailed()),
      )
      const expectedUpdatedAt = DateTime.toDate(input.expectedUpdatedAt)
      // The version column is the concurrency token, so the new value must be
      // strictly newer than the one the client held even if the clock is not.
      const renameTime = new Date(
        Math.max(yield* Clock.currentTimeMillis, expectedUpdatedAt.getTime() + 1),
      )
      const renamed = yield* workspaces
        .rename({ id: workspaceId, expectedUpdatedAt, name: input.name, now: renameTime })
        .pipe(Effect.result)

      if (Result.isSuccess(renamed)) return yield* presentWorkspace(renamed.success)

      const reconciliation = yield* workspaces.getDetail(workspaceId).pipe(Effect.result)
      if (Result.isSuccess(reconciliation) && reconciliation.success.name === input.name) {
        return yield* presentWorkspace(reconciliation.success)
      }
      if (renamed.failure._tag === "WorkspaceRepo.UpdateConflict") {
        return yield* new RenameConflict()
      }
      return yield* new LoadFailed({ operation: "renameWorkspace" })
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

    /**
     * The stages, run by the one attempt that holds the operation's lease. Each
     * stage reads its status from the receipt and marks it before moving on, so
     * a resumed attempt skips whatever already happened; the lease is what keeps
     * a second attempt from reading the same `pending` and repeating the side
     * effect — a coach must not be told goodbye twice.
     */
    const driveDeletion = Effect.fn("AdminSurface.driveDeletion")(function* (
      workspaceId: WorkspaceId,
      lease: WorkspaceDeletionRepo.Lease,
      claimed: WorkspaceDeletionRepo.Operation,
    ) {
      let operation = claimed

      if (operation.pipelineStatus === "pending") {
        const cancellation = yield* runCancellation.cancel(workspaceId)
        if (WorkspaceRunCancellationResult.guards.Failed(cancellation)) {
          return yield* new DeletionRetryable({ operation: "pipeline" })
        }
        operation = yield* deletions
          .markPipeline(
            lease,
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
            .markFarewell(lease, "not-applicable", new Date(yield* Clock.currentTimeMillis))
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
              lease,
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
            lease,
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
        .finalize(lease, new Date(yield* Clock.currentTimeMillis))
        .pipe(Effect.mapError(() => new DeletionRetryable({ operation: "finalize" })))
      yield* runCancellation.kickObjectCleanup()

      return {
        status:
          operation.farewellStatus === "undeliverable"
            ? "deleted-farewell-undeliverable"
            : "deleted",
      } satisfies DeleteResult
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
      const prepared = yield* deletions
        .prepare(workspaceId, input.requestId, new Date(yield* Clock.currentTimeMillis))
        .pipe(
          Effect.mapError((error) =>
            error._tag === "WorkspaceDeletionRepo.RequestConflict"
              ? new DeletionConflict()
              : new LoadFailed({ operation: "deleteWorkspace.prepare" }),
          ),
        )

      // prepare may adopt an in-flight operation created under an earlier
      // requestId (the client mints a fresh one per dialog mount). Claim by the
      // operation's own requestId, not the client input, so both the first
      // attempt and a resumed one contend for the same lease.
      const { lease, operation } = yield* deletions
        .claim(prepared.requestId, new Date(yield* Clock.currentTimeMillis))
        .pipe(
          Effect.mapError((error) =>
            error._tag === "WorkspaceDeletionRepo.LeaseHeld"
              ? new DeletionConflict()
              : new LoadFailed({ operation: "deleteWorkspace.claim" }),
          ),
        )

      // Replay of a finished deletion: nothing was claimed and nothing is run.
      if (operation.state === "completed") {
        return {
          status:
            operation.farewellStatus === "undeliverable"
              ? "deleted-farewell-undeliverable"
              : "deleted",
        } satisfies DeleteResult
      }

      // Hand the lease back on every exit — success, failure, or interruption —
      // so a retry after a failed stage is not stuck behind its own dead
      // attempt. Only a process that dies outright leaves it to the TTL.
      return yield* driveDeletion(workspaceId, lease, operation).pipe(
        Effect.ensuring(deletions.release(lease).pipe(Effect.ignore)),
      )
    })

    /**
     * What the progress sheet and the resume panel read. `undefined` is the
     * ordinary answer — a workspace nobody has ever tried to delete — and the
     * caller treats it as "nothing in flight" rather than as an error.
     */
    const getWorkspaceDeletion = Effect.fn("AdminSurface.getWorkspaceDeletion")(function* (
      rawInitData: string,
      rawWorkspaceId: string,
    ) {
      yield* verifyAdmin(rawInitData)
      const workspaceId = yield* decodeWorkspaceId(rawWorkspaceId).pipe(
        Effect.mapError(() => new LoadFailed({ operation: "getWorkspaceDeletion" })),
      )
      const operation = yield* deletions
        .findByWorkspace(workspaceId)
        .pipe(Effect.mapError(() => new LoadFailed({ operation: "getWorkspaceDeletion" })))
      if (operation === undefined) return undefined

      return {
        workspaceId: operation.workspaceId,
        state: operation.state,
        pipeline: operation.pipelineStatus,
        farewell: operation.farewellStatus,
        botRelease: operation.botReleaseStatus,
        ...(operation.workspaceName === undefined
          ? {}
          : { workspaceName: operation.workspaceName }),
        startedAt: operation.createdAt.toISOString(),
        drivingLapsesInMs:
          operation.leaseUntil === undefined
            ? 0
            : Math.max(0, operation.leaseUntil.getTime() - (yield* Clock.currentTimeMillis)),
        ...(operation.completedAt === undefined
          ? {}
          : { completedAt: operation.completedAt.toISOString() }),
      } satisfies DeletionProgress
    })

    return Service.of({
      listWorkspaces,
      createWorkspace,
      prepareInviteShareMessage,
      recordInviteShare,
      getWorkspace,
      renameWorkspace,
      reissueWorkspaceInvite,
      deleteWorkspace,
      getWorkspaceDeletion,
    })
  }),
)

export * as AdminSurface from "./admin-surface.ts"
