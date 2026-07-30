import { AvatarRepo } from "@praximo/db"
import type { TelegramId, WorkspaceId } from "@praximo/domain"
import { Clock, Effect, Result } from "effect"
import { importTelegramPhoto } from "./telegram-photo.ts"

/**
 * The client's Telegram profile photo, snapshotted into R2 at the moment they
 * accept (#231).
 *
 * The client is never *asked* for a picture — that was dropped from #57
 * deliberately, to keep the Acceptance Page one page. Not asking is not a reason
 * to discard one the platform already has: people look for their own face, and a
 * roster of grey initials is a roster of records rather than of people.
 *
 * Three things are only true of a client, and they are the whole of this file:
 *
 * - **The coach's own bot makes the calls.** The client `/start`ed *it*, so it is
 *   the only bot that can see them — the mirror image of #225, where the manager
 *   bot is the one guaranteed to see the coach.
 * - **No refresh and no backfill.** The coach's photo is the practice's public
 *   face and rides the daily health sweep; a client's is a snapshot of who walked
 *   in, there is no per-client sweep to hang a refresh on, and inventing one buys
 *   nothing. Which is also why there is no `cleared` here: nothing ever asks
 *   Telegram about this client again, so nothing can observe a withdrawal.
 * - **It runs after the commit that carries the consent**, never inside it. Both
 *   halves of that matter. Storing somebody's photograph before they have agreed
 *   to anything would be processing without consent, and an abandoned tap would
 *   leave an object nothing references; and the commit is atomic and must not wait
 *   on Telegram's file endpoint or be undone by it.
 */

/**
 * What one capture settled into — for the log, and for a test that needs to say
 * which branch ran. `absent` is the ordinary answer for most people.
 */
export type ClientPhotoOutcome =
  /** Downloaded, stored, and the key written to the column and the snapshot. */
  | "stored"
  /** The column already names this photo — a redelivered tap, or a second door. */
  | "unchanged"
  /** Telegram reports no photo, or one hidden from bots. Initials, as designed. */
  | "absent"
  /** A photo too large to be an avatar; left alone rather than truncated. */
  | "skipped"
  /** Something did not answer. The client simply has no photo stored. */
  | "failed"

/**
 * Give up, saying why, and leave the client without a photo.
 *
 * Only the *column's* own failures reach this — the import has already spoken for
 * everything Telegram did. The client names itself in the line rather than the
 * workspace, because that is what a runbook has to look up here, and no cause, URL
 * or token ever joins it (ADR 0004).
 */
const abandon = (clientId: string, because: string) =>
  Effect.as(
    Effect.logWarning(`client photo for ${clientId}: ${because}`),
    "failed" as const satisfies ClientPhotoOutcome,
  )

export interface ClientPhotoCapture {
  readonly workspaceId: WorkspaceId
  readonly clientId: string
  readonly clientTelegramId: TelegramId
  /**
   * The **coach bot's** credential, handed in rather than resolved.
   *
   * Only the webhook handler knows which bot this update arrived on, and it
   * already holds the decrypted token — resolving it a second time through the
   * registry would be a second decryption to answer a question the caller can
   * already answer. It never reaches a log or a service: the import puts it in a
   * URL and nothing else.
   */
  readonly coachBotToken: string
  /** The Worker's Telegram transport, injectable for the same reason every other is. */
  readonly fetch: typeof globalThis.fetch
}

/**
 * Capture the photo, and write it to the client's row and their channel snapshot.
 *
 * The column is read first because the import compares against it: a redelivered
 * `ca:` callback, or a client who somehow arrives twice, costs one Bot API call
 * and no bytes.
 *
 * R2 is written before the row, deliberately — a row naming an object that does
 * not exist is a broken surface, while an object no row names is a few kilobytes
 * the sweeper will never be told about.
 */
export const captureClientPhoto = Effect.fn("BotWorker.captureClientPhoto")(function* (
  input: ClientPhotoCapture,
) {
  const avatars = yield* AvatarRepo.Service
  const { workspaceId, clientId } = input

  const held = yield* avatars.clientAvatarKey(workspaceId, clientId).pipe(Effect.result)
  if (Result.isFailure(held)) {
    return yield* abandon(clientId, `could not read the stored key — ${held.failure.operation}`)
  }

  const imported = yield* importTelegramPhoto({
    token: input.coachBotToken,
    fetch: input.fetch,
    telegramUserId: input.clientTelegramId,
    subject: "client",
    subjectId: clientId,
    heldKey: held.success,
  })

  if (imported._tag === "Failed") return "failed" as const satisfies ClientPhotoOutcome
  if (imported._tag === "Skipped") return "skipped" as const satisfies ClientPhotoOutcome
  if (imported._tag === "Unchanged") return "unchanged" as const satisfies ClientPhotoOutcome
  // A client with no photo, or one hidden from bots, is the ordinary case and not
  // a fault. Nothing is written and nothing is cleared: there was never a photo
  // here to withdraw.
  if (imported._tag === "Absent") return "absent" as const satisfies ClientPhotoOutcome

  const written = yield* avatars
    .setClientAvatar({
      workspaceId,
      clientId,
      r2Key: imported.key,
      now: new Date(yield* Clock.currentTimeMillis),
    })
    .pipe(Effect.result)
  if (Result.isFailure(written)) {
    return yield* abandon(
      clientId,
      `stored at ${imported.key} but the client row was not updated — ${written.failure.operation}`,
    )
  }
  // The key differed from what was read a moment ago, so anything but a write is
  // the statement reporting a state this could not see: no such client in this
  // workspace, or a cleanup worker deleting that very object under a live lease.
  // Either way the object is now unreferenced, and saying "stored" would put a key
  // in the log that no row carries.
  if (written.success.outcome !== "written") {
    return yield* abandon(
      clientId,
      `stored at ${imported.key} but the client row kept its own key — ${written.success.outcome}`,
    )
  }
  return "stored" as const satisfies ClientPhotoOutcome
})

/**
 * The capture as its one caller wants it: run it, say what happened at debug
 * volume, and never let it be the reason anything else failed.
 *
 * **Including a defect.** `captureClientPhoto` has no failure channel by
 * construction, but a Telegram response that contradicts its own documented shape
 * would raise where no `tryPromise` is looking — and a client must not see an error
 * after they have already been shown their confirmation, over a profile picture
 * nobody asked them for. The defect is not printed, for the reason `telegram()`
 * drops its causes: what a raised value carries here is unknown, and a bot's token
 * travels in the URLs on this path (ADR 0004).
 */
export const captureClientPhotoQuietly = Effect.fn("BotWorker.captureClientPhotoQuietly")(
  function* (input: ClientPhotoCapture) {
    const outcome = yield* captureClientPhoto(input).pipe(
      Effect.catchDefect(() =>
        Effect.as(
          Effect.logWarning(
            `client photo for ${input.clientId}: the import raised, and they keep their initials`,
          ),
          "failed" as const,
        ),
      ),
    )
    yield* Effect.logDebug(`client photo for ${input.clientId}: ${outcome}`)
  },
)
