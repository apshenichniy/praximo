import type { TelegramId } from "@praximo/domain"
import { type AvatarSubject, AvatarStore, avatarKey, MaxAvatarBytes } from "@praximo/storage"
import type { PhotoSize, UserProfilePhotos } from "grammy/types"
import { Effect, Result } from "effect"
import { apiFor, telegram } from "./telegram-api.ts"

/**
 * Snapshotting one Telegram profile photo into R2 — the three calls, the
 * comparison that usually makes them one, and nothing about whose photo it is
 * (#225, #231).
 *
 * Two paths import a photo and they have almost nothing else in common: the
 * coach's is refreshed daily through the manager bot and *withdrawn* when they
 * remove it, while a client's is captured once through the coach's own bot at the
 * moment they accept, with no refresh and no backfill. What is identical is
 * everything in this file — which size to take, what names the source, when not to
 * download, and the bound past which an avatar is not an avatar. A second copy of
 * that is a second place for the size check to be forgotten.
 *
 * **The policy stays with the caller.** This module never reads or writes a
 * column, never decides that an absent photo means a stored one should go, and
 * never fails: it says what it found, and the caller decides what that means for
 * the row it owns.
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
 * What one import found. Every case is terminal, and every one of them is an
 * ordinary answer about somebody's profile picture rather than an error.
 *
 * `Failed` carries nothing because there is nothing left to say: whatever went
 * wrong has already been logged here, against the subject, and no caller can act
 * on the difference between a refused call and a malformed answer — both mean
 * "believe nothing about this photo, keep whatever you had".
 */
export type PhotoImport =
  /** Downloaded and put in the bucket. The key is the caller's to write. */
  | { readonly _tag: "Stored"; readonly key: string }
  /** The photo Telegram reports is the one the caller already holds. */
  | { readonly _tag: "Unchanged"; readonly key: string }
  /** Telegram *definitely* reports no photo: none set, or hidden from bots. */
  | { readonly _tag: "Absent" }
  /** A photo too large to be an avatar; left alone rather than truncated. */
  | { readonly _tag: "Skipped" }
  /** Something did not answer, or contradicted itself. */
  | { readonly _tag: "Failed" }

/**
 * The photo to snapshot: the subject's current one, at the largest size Telegram
 * offers it in.
 *
 * `photos[0]` is the current photo and each entry is that one photo in several
 * sizes. The largest is taken because an avatar is stored once and displayed at
 * whatever size a surface wants — a profile photo's largest size is a few tens of
 * kilobytes, so there is nothing to save by storing a smaller one.
 *
 * `file_unique_id` rather than `file_id` names the source: Telegram documents it
 * as stable over time and across bots, where `file_id` is neither. That stability
 * is the whole of the change detection — it goes into the key, and the key is
 * compared against the column.
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
 * bot's token.
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

export interface PhotoImportInput {
  /**
   * The bot doing the asking, and the one credential all three calls use:
   * `getUserProfilePhotos` only answers for a user the bot can see, and both
   * `file_id` and the `file_path` a download needs are scoped to the bot that
   * obtained them.
   */
  readonly token: string
  /**
   * The Telegram transport, injected the way every other path in this Worker
   * injects it.
   *
   * Passed rather than read off a service, because the two callers reach it from
   * different places: the refresh already holds the provisioning runtime, while the
   * capture runs inside a webhook handler that has the Worker's own `fetch` and no
   * layer providing that runtime. One parameter is cheaper than hoisting a service
   * named after provisioning into a module that has nothing to do with it.
   */
  readonly fetch: typeof globalThis.fetch
  readonly telegramUserId: TelegramId
  readonly subject: AvatarSubject
  /** The row this picture hangs off — a workspace for a coach, a client for a client. */
  readonly subjectId: string
  /**
   * The key already stored, if any. Supplied rather than read, because reading it
   * means knowing which column — and it is what makes an unchanged photo cost one
   * API call and no bytes.
   */
  readonly heldKey: string | undefined
}

/**
 * The longest a whole import may take before it is abandoned.
 *
 * **Every caller runs inside a request Telegram is waiting on** — a webhook for the
 * client's acceptance, another for a provisioning — and none of them may be held
 * open by a file endpoint that stopped answering. `fetch` has no timeout of its own,
 * so without this a single hung download would cost the webhook its 200; Telegram
 * would redeliver, and on the acceptance path the redelivery would replace the
 * client's confirmation with "you are already set up".
 *
 * Ten seconds is far beyond the few hundred milliseconds the three calls and a
 * few tens of kilobytes actually take, so it never fires on a working import — it
 * is a bound on the pathological case, not a performance budget.
 */
export const ImportTimeoutMillis = 10_000

/**
 * Bring one subject's stored photo in step with the one their Telegram profile
 * currently shows.
 *
 * The order is what keeps this cheap: Telegram is asked which photo they have
 * *before* anything is downloaded, and the key derived from it is compared against
 * what the caller already holds. An unchanged photo therefore costs one API call
 * and no bytes — which is what makes a daily sweep an affordable place to run this
 * from, and what makes a redelivered acceptance harmless.
 */
const runImport = Effect.fn("BotWorker.importTelegramPhoto")(function* (input: PhotoImportInput) {
  const store = yield* AvatarStore.Service
  const api = apiFor(input.token, input.fetch)
  // One prefix for both paths, and the runbook greps by it: the subject and the
  // row it hangs off, never a cause, a URL or a token (ADR 0004).
  const about = `${input.subject} photo for ${input.subjectId}`
  const abandon = (because: string) =>
    Effect.as(Effect.logWarning(`${about}: ${because}`), { _tag: "Failed" } as const)

  const photos = yield* telegram("getUserProfilePhotos", () =>
    api.getUserProfilePhotos(Number(input.telegramUserId), { limit: 1 }),
  ).pipe(Effect.result)
  if (Result.isFailure(photos)) {
    // Not evidence of anything about their photo, so nothing may be concluded on
    // the strength of it.
    return yield* abandon("Telegram did not answer getUserProfilePhotos")
  }

  const source = currentPhoto(photos.success)
  if (source === undefined) {
    // `total_count` is the answer's own account of itself, and a count above zero
    // beside an empty list is Telegram contradicting itself rather than saying
    // there is no photo. Only a *definite* empty answer may be acted on, so this
    // one is not — the same rule `classifyCoachBotFailure` follows about refusals.
    return photos.success.total_count > 0
      ? yield* abandon("Telegram counted photos but listed none")
      : ({ _tag: "Absent" } as const)
  }

  const candidate = avatarKey({
    subject: input.subject,
    subjectId: input.subjectId,
    sourceId: source.sourceId,
    contentType: PhotoContentType,
  })
  if (candidate === undefined) {
    // Unreachable for a JPEG under a workspace or client id, and left as a branch
    // rather than an assertion: the key vocabulary is another package's, and a
    // silent `undefined` here would become an unexplained missing photo.
    return yield* abandon("no key could be composed for it")
  }
  // The comparison the whole design exists for: same photo, no download, no write,
  // nothing for the cleanup queue.
  if (candidate === input.heldKey) return { _tag: "Unchanged", key: candidate } as const

  const file = yield* telegram("getFile", () => api.getFile(source.fileId)).pipe(Effect.result)
  if (Result.isFailure(file)) return yield* abandon("Telegram did not answer getFile")
  const filePath = file.success.file_path
  if (filePath === undefined) return yield* abandon("Telegram named no path for the file")
  const size = file.success.file_size
  if (size !== undefined && size > MaxAvatarBytes) {
    // Refused on Telegram's own reported size, before the request: `AvatarStore`
    // enforces the same bound on the buffer, but doing it here is what keeps an
    // unbounded body out of a Worker's memory in the first place.
    yield* Effect.logWarning(`${about}: ${size} bytes is larger than an avatar may be`)
    return { _tag: "Skipped" } as const
  }

  const bytes = yield* download(input.fetch, fileUrl(input.token, filePath)).pipe(Effect.result)
  if (Result.isFailure(bytes)) return yield* abandon("the file did not download")

  const stored = yield* store
    .store({
      subject: input.subject,
      subjectId: input.subjectId,
      sourceId: source.sourceId,
      contentType: PhotoContentType,
      body: bytes.success,
    })
    .pipe(Effect.result)
  if (Result.isFailure(stored)) return yield* abandon(`not stored — ${stored.failure.reason}`)

  return { _tag: "Stored", key: stored.success } as const satisfies PhotoImport
})

/**
 * The import, bounded — see {@link ImportTimeoutMillis} for why the bound is not
 * optional.
 *
 * A timeout resolves to `Failed`, which every caller already treats as "believe
 * nothing about this photo, keep whatever you had". The subject names itself in the
 * line for the same reason the rest of this module's warnings do.
 */
export const importTelegramPhoto = Effect.fn("BotWorker.importTelegramPhotoBounded")(function* (
  input: PhotoImportInput,
) {
  const imported = yield* runImport(input).pipe(Effect.timeout(ImportTimeoutMillis), Effect.result)
  if (Result.isFailure(imported)) {
    yield* Effect.logWarning(
      `${input.subject} photo for ${input.subjectId}: gave up after ${ImportTimeoutMillis}ms`,
    )
    return { _tag: "Failed" } as const satisfies PhotoImport
  }
  return imported.success
})
