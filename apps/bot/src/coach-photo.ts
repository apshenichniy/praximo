import { AvatarRepo } from "@praximo/db"
import type { TelegramId, WorkspaceId } from "@praximo/domain"
import { Clock, Effect, Result } from "effect"
import { CoachBotProvisioningRuntime } from "./coach-bot-provisioning-runtime.ts"
import { importTelegramPhoto } from "./telegram-photo.ts"

/**
 * The coach's own Telegram profile photo, snapshotted into R2 (#225).
 *
 * It is what makes the client's Acceptance Page read as a continuation of the
 * conversation they have been having with their coach rather than a stranger's
 * consent wall — and it is a *snapshot*, because a Telegram file reference is not
 * a URL anybody outside a bot can render.
 *
 * **Everything here is best-effort, and that is a property rather than a
 * concession.** Initials are the specified fallback on every surface that shows a
 * coach, so a photo that could not be fetched costs a courtesy and nothing else.
 * No branch of this may fail a provisioning, a repair, or a health decision.
 *
 * **The manager bot makes the calls, not the coach's own.** `getUserProfilePhotos`
 * only answers for a user the bot can see, and the coach `/start`ed the manager
 * bot to begin onboarding at all — where their freshly created coach bot may not
 * have been opened yet.
 *
 * The three calls themselves live in `telegram-photo.ts`, shared with the client's
 * capture (#231). What stays here is the part that is only true of a coach: the
 * daily cadence, and that a photo they removed is one they *withdrew*.
 */

/**
 * What one refresh settled into. Every case is terminal for the call that
 * produced it; the caller logs nothing, because each branch below has already
 * said whatever was worth saying.
 *
 * `absent` and `unchanged` are the two ordinary answers — a coach with no photo,
 * and a coach whose photo we already hold. Neither is a fault.
 */
export type CoachPhotoOutcome =
  /** Downloaded, stored, and the key written. */
  | "stored"
  /** The photo Telegram reports is the one the column already names. */
  | "unchanged"
  /** Telegram reports no photo, and the key we held has been dropped. */
  | "cleared"
  /** Telegram reports no photo and we never held one. */
  | "absent"
  /** A photo too large to be an avatar; left alone rather than truncated. */
  | "skipped"
  /** Something did not answer. The coach keeps whatever they had. */
  | "failed"

/**
 * Give up, saying why, and leave the coach with whatever photo they had.
 *
 * Only the *column's* own failures reach this — the import has already spoken for
 * everything Telegram did. The workspace names itself in the line, because the
 * runbook greps the Worker log by workspace and bot id, and no cause, URL or token
 * ever joins it (ADR 0004).
 */
const abandon = (workspaceId: WorkspaceId, because: string) =>
  Effect.as(
    Effect.logWarning(`coach photo for ${workspaceId}: ${because}`),
    "failed" as const satisfies CoachPhotoOutcome,
  )

/**
 * Bring the coach's stored photo in step with the one their Telegram profile
 * currently shows.
 *
 * The column is read first, because the import needs it: the key it composes is
 * compared against this one *before* anything is downloaded, so an unchanged photo
 * costs one API call and one indexed read. That is what makes the daily sweep an
 * affordable place to run this from.
 *
 * R2 is written before the column, deliberately. A row naming an object that does
 * not exist is a broken surface; an object no row names is a few kilobytes the
 * sweeper will never be told about. Only one of those is worth avoiding.
 */
export const refreshCoachPhoto = Effect.fn("BotWorker.refreshCoachPhoto")(function* (input: {
  readonly workspaceId: WorkspaceId
  readonly coachTelegramId: TelegramId
}) {
  const runtime = yield* CoachBotProvisioningRuntime.Service
  const avatars = yield* AvatarRepo.Service
  const workspaceId = input.workspaceId

  const held = yield* avatars.coachAvatarKey(workspaceId).pipe(Effect.result)
  if (Result.isFailure(held)) {
    return yield* abandon(workspaceId, `could not read the stored key — ${held.failure.operation}`)
  }
  const heldKey = held.success

  const imported = yield* importTelegramPhoto({
    token: runtime.managerBotToken,
    fetch: runtime.fetch,
    telegramUserId: input.coachTelegramId,
    subject: "coach",
    subjectId: workspaceId,
    heldKey,
  })

  if (imported._tag === "Failed") return "failed" as const satisfies CoachPhotoOutcome
  if (imported._tag === "Skipped") return "skipped" as const satisfies CoachPhotoOutcome
  if (imported._tag === "Unchanged") return "unchanged" as const satisfies CoachPhotoOutcome

  if (imported._tag === "Absent") {
    if (heldKey === undefined) return "absent" as const satisfies CoachPhotoOutcome
    // Definitely empty, so it acts. A coach who removed their photo, or hid it
    // from bots, has withdrawn it — the two are indistinguishable from here, so
    // both are honoured the same way. The object goes to the cleanup queue with
    // the column, and initials take over.
    //
    // This branch is the coach's alone: a client's photo is a snapshot of who
    // walked in, and there is no occasion on which we ask Telegram about them
    // again (#231).
    const cleared = yield* avatars
      .setCoachAvatar({ workspaceId, now: new Date(yield* Clock.currentTimeMillis) })
      .pipe(Effect.result)
    if (Result.isFailure(cleared)) {
      return yield* abandon(
        workspaceId,
        `withdrawn at Telegram but still on the member row — ${cleared.failure.operation}`,
      )
    }
    return "cleared" as const satisfies CoachPhotoOutcome
  }

  const written = yield* avatars
    .setCoachAvatar({
      workspaceId,
      r2Key: imported.key,
      now: new Date(yield* Clock.currentTimeMillis),
    })
    .pipe(Effect.result)
  if (Result.isFailure(written)) {
    return yield* abandon(
      workspaceId,
      `stored at ${imported.key} but the member row was not updated — ${written.failure.operation}`,
    )
  }
  // The key differed from what was read a moment ago, so anything but a write is
  // the statement reporting a state this could not see: no owner member to hold
  // it, or a cleanup worker deleting that very object under a live lease. Either
  // way the object is now unreferenced, and saying "stored" would put a key in the
  // log that no row carries.
  if (written.success.outcome !== "written") {
    return yield* abandon(
      workspaceId,
      `stored at ${imported.key} but the member row kept its own key — ${written.success.outcome}`,
    )
  }
  return "stored" as const satisfies CoachPhotoOutcome
})

/**
 * The same refresh, as every caller wants it: run it, say what happened at debug
 * volume, and never let it be the reason something else failed.
 *
 * Provisioning, the BotFather fallback and the health sweep all call it exactly
 * this way — the wrapper exists so that "best-effort" is one decision in one
 * place rather than three call sites that each remembered to be careful.
 *
 * **Including a defect**, which is the part worth having a wrapper for at all.
 * `refreshCoachPhoto` has no failure channel by construction, but a Telegram
 * response that contradicts its own documented shape would raise where no
 * `tryPromise` is looking — and a coach must not lose their onboarding to a
 * malformed answer about their profile picture. The defect is not printed, for
 * the same reason `telegram()` drops its causes: what a raised value carries here
 * is unknown, and a bot's token travels in the URLs on this path (ADR 0004).
 */
export const refreshCoachPhotoQuietly = Effect.fn("BotWorker.refreshCoachPhotoQuietly")(
  function* (input: {
    readonly workspaceId: WorkspaceId
    /** Absent means no coach identity is bound, so there is nobody to ask about. */
    readonly coachTelegramId?: TelegramId
  }) {
    if (input.coachTelegramId === undefined) return
    const outcome = yield* refreshCoachPhoto({
      workspaceId: input.workspaceId,
      coachTelegramId: input.coachTelegramId,
    }).pipe(
      Effect.catchDefect(() =>
        Effect.as(
          Effect.logWarning(
            `coach photo for ${input.workspaceId}: the import raised, and the coach keeps whatever they had`,
          ),
          "failed" as const,
        ),
      ),
    )
    yield* Effect.logDebug(`coach photo for ${input.workspaceId}: ${outcome}`)
  },
)
