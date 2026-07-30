import { AvatarRepo } from "@praximo/db"
import type { TelegramId, WorkspaceId } from "@praximo/domain"
import { AvatarStore, avatarKey, MaxAvatarBytes } from "@praximo/storage"
import type { PhotoSize, UserProfilePhotos } from "grammy/types"
import { Clock, Effect, Result } from "effect"
import { CoachBotProvisioningRuntime } from "./coach-bot-provisioning-runtime.ts"
import { apiFor, telegram } from "./telegram-api.ts"

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
 * have been opened yet. `file_id` and the `file_path` a download needs are both
 * scoped to the bot that obtained them, so all three calls use the one token.
 */

/** Telegram delivers profile photos as JPEG, and only as JPEG. */
const PhotoContentType = "image/jpeg"

/**
 * Where a Telegram file is downloaded from — **not** the API root the Bot API
 * methods live under.
 *
 * The token is in the path, which is why no failure on this path ever logs a URL
 * (ADR 0004) and why the size is checked before the request rather than after.
 */
const fileUrl = (token: string, filePath: string): string =>
  `https://api.telegram.org/file/bot${token}/${filePath}`

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
 * The photo to snapshot: the coach's current one, at the largest size Telegram
 * offers it in.
 *
 * `photos[0]` is the current photo and each entry is that one photo in several
 * sizes. The largest is taken because an avatar is stored once and displayed at
 * whatever size a surface wants — a profile photo's largest size is a few tens of
 * kilobytes, so there is nothing to save by storing a smaller one.
 *
 * `file_unique_id` rather than `file_id` names the source: Telegram documents it
 * as stable over time and across bots, where `file_id` is neither. That
 * stability is the whole of the change detection — it goes into the key, and the
 * key is compared against the column.
 */
const currentPhoto = (
  photos: UserProfilePhotos,
): { readonly sourceId: string; readonly fileId: string } | undefined => {
  const sizes: ReadonlyArray<PhotoSize> = photos.photos[0] ?? []
  const largest = sizes.at(-1)
  return largest === undefined
    ? undefined
    : { sourceId: largest.file_unique_id, fileId: largest.file_id }
}

/**
 * The bytes behind a `file_path`.
 *
 * Deliberately not routed through `telegram()`: this is not a Bot API method, it
 * has no `ok`/`description` envelope, and the failure it can produce is an HTTP
 * status. Only the word "download" escapes — never the URL, which carries the
 * manager bot's token.
 */
const download = (fetch: typeof globalThis.fetch, url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`file endpoint answered ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    catch: () => "download" as const,
  })

/**
 * Give up, saying why, and leave the coach with whatever photo they had.
 *
 * Every abandonment on this path is this shape, so it is one function: the
 * workspace names itself in the line — the runbook greps the Worker log by
 * workspace and bot id — and no cause, URL or token ever joins it (ADR 0004).
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
 * The order is what keeps this cheap: Telegram is asked which photo the coach has
 * *before* anything is downloaded, and the key derived from it is compared
 * against the column. An unchanged photo therefore costs one API call and one
 * indexed read — which is what makes the daily sweep an affordable place to run
 * this from.
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
  const store = yield* AvatarStore.Service
  const api = apiFor(runtime.managerBotToken, runtime.fetch)
  const workspaceId = input.workspaceId

  const photos = yield* telegram("getUserProfilePhotos", () =>
    api.getUserProfilePhotos(Number(input.coachTelegramId), { limit: 1 }),
  ).pipe(Effect.result)
  if (Result.isFailure(photos)) {
    // Not evidence of anything about the coach's photo, so nothing is changed on
    // the strength of it — the next sweep asks again.
    return yield* abandon(workspaceId, "Telegram did not answer getUserProfilePhotos")
  }

  const held = yield* avatars.coachAvatarKey(workspaceId).pipe(Effect.result)
  if (Result.isFailure(held)) {
    return yield* abandon(workspaceId, `could not read the stored key — ${held.failure.operation}`)
  }
  const heldKey = held.success

  const source = currentPhoto(photos.success)
  if (source === undefined) {
    // `total_count` is the answer's own account of itself, and a count above zero
    // beside an empty list is Telegram contradicting itself rather than telling us
    // the coach has no photo. Only a *definite* empty answer may act, so this one
    // does not — the same rule `classifyCoachBotFailure` follows about refusals.
    if (photos.success.total_count > 0) {
      return yield* abandon(workspaceId, "Telegram counted photos but listed none")
    }
    if (heldKey === undefined) return "absent" as const satisfies CoachPhotoOutcome
    // Definitely empty, so it acts. A coach who removed their photo, or hid it
    // from bots, has withdrawn it — the two are indistinguishable from here, so
    // both are honoured the same way. The object goes to the cleanup queue with
    // the column, and initials take over.
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

  const candidate = avatarKey({
    subject: "coach",
    subjectId: workspaceId,
    sourceId: source.sourceId,
    contentType: PhotoContentType,
  })
  if (candidate === undefined) {
    // Unreachable for a JPEG under a workspace id, and left as a branch rather
    // than an assertion: the key vocabulary is another package's, and a silent
    // `undefined` here would otherwise become an unexplained missing photo.
    return yield* abandon(workspaceId, "no key could be composed for it")
  }
  // The comparison the whole design exists for: same photo, no download, no
  // write, nothing for the cleanup queue.
  if (candidate === heldKey) return "unchanged" as const satisfies CoachPhotoOutcome

  const file = yield* telegram("getFile", () => api.getFile(source.fileId)).pipe(Effect.result)
  if (Result.isFailure(file)) {
    return yield* abandon(workspaceId, "Telegram did not answer getFile")
  }
  const filePath = file.success.file_path
  if (filePath === undefined) {
    return yield* abandon(workspaceId, "Telegram named no path for the file")
  }
  const size = file.success.file_size
  if (size !== undefined && size > MaxAvatarBytes) {
    // Refused on Telegram's own reported size, before the request: `AvatarStore`
    // enforces the same bound on the buffer, but doing it here is what keeps an
    // unbounded body out of a Worker's memory in the first place.
    yield* Effect.logWarning(
      `coach photo for ${workspaceId}: ${size} bytes is larger than an avatar may be`,
    )
    return "skipped" as const satisfies CoachPhotoOutcome
  }

  const bytes = yield* download(runtime.fetch, fileUrl(runtime.managerBotToken, filePath)).pipe(
    Effect.result,
  )
  if (Result.isFailure(bytes)) {
    return yield* abandon(workspaceId, "the file did not download")
  }

  const stored = yield* store
    .store({
      subject: "coach",
      subjectId: workspaceId,
      sourceId: source.sourceId,
      contentType: PhotoContentType,
      body: bytes.success,
    })
    .pipe(Effect.result)
  if (Result.isFailure(stored)) {
    return yield* abandon(workspaceId, `not stored — ${stored.failure.reason}`)
  }

  const written = yield* avatars
    .setCoachAvatar({
      workspaceId,
      r2Key: stored.success,
      now: new Date(yield* Clock.currentTimeMillis),
    })
    .pipe(Effect.result)
  if (Result.isFailure(written)) {
    return yield* abandon(
      workspaceId,
      `stored at ${stored.success} but the member row was not updated — ${written.failure.operation}`,
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
      `stored at ${stored.success} but the member row kept its own key — ${written.success.outcome}`,
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
