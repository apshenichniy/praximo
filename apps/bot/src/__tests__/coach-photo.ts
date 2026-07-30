import { AvatarRepo } from "@praximo/db"
import { Effect, Layer } from "effect"

/**
 * The coach's Telegram profile photo, as the three calls that import it see it
 * (#225) — plus the member column it lands on.
 *
 * Shared rather than restated per suite because the photo refresh runs on the
 * tail of every provisioning path *and* on every healthy sweep tick, so more than
 * one suite has to be able to answer for it. The R2 side has no double here on
 * purpose: `AvatarStore.testLayer` is the storage package's own, so its rules are
 * exercised rather than imitated.
 */

export interface PhotoFixture {
  /** Stable across bots and over time; it is what the key is derived from. */
  readonly fileUniqueId: string
  /** Per-bot and per-moment; it is what `getFile` is asked about. */
  readonly fileId: string
  readonly filePath: string
  readonly bytes: Uint8Array
}

export const COACH_PHOTO: PhotoFixture = {
  fileUniqueId: "AQADBAADq6cxG4AB",
  fileId: "AgACAgIAAxUAAWfirst",
  filePath: "photos/file_11.jpg",
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
}

/** The same coach, a different picture — what a refresh has to notice. */
export const CHANGED_PHOTO: PhotoFixture = {
  fileUniqueId: "AQADBAADq6cxG4AC",
  fileId: "AgACAgIAAxUAAWfsecond",
  filePath: "photos/file_12.jpg",
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x47]),
}

export interface PhotoRouteOptions {
  /** What `getFile` claims the photo weighs. Defaults to the fixture's own size. */
  readonly fileSize?: number
  /** How each of the three calls answers, for the failure paths. */
  readonly refuse?: "getUserProfilePhotos" | "getFile" | "download"
  /** Telegram answers `getFile` without a path — rare, and documented as possible. */
  readonly withoutFilePath?: boolean
}

/**
 * Telegram's answers for the photo import, and `undefined` for anything else so a
 * suite's own stub keeps handling the calls it cares about.
 *
 * `"none"` is the coach with no photo, or one hidden from bots: `total_count: 0`
 * with an empty list, which is exactly what the Bot API returns for both.
 */
export const telegramPhotoRoutes =
  (photo: PhotoFixture | "none", options: PhotoRouteOptions = {}) =>
  (url: string): Response | undefined => {
    const { pathname } = new URL(url)
    const refused = Response.json(
      { ok: false, error_code: 400, description: "Bad Request: something went wrong" },
      { status: 400 },
    )

    if (pathname.endsWith("/getUserProfilePhotos")) {
      if (options.refuse === "getUserProfilePhotos") return refused
      if (photo === "none")
        return Response.json({ ok: true, result: { total_count: 0, photos: [] } })
      return Response.json({
        ok: true,
        result: {
          total_count: 1,
          // One photo in two sizes, smallest first: the import takes the largest,
          // so the fixture's ids belong to the *last* entry.
          photos: [
            [
              {
                file_id: `${photo.fileId}-160`,
                file_unique_id: `${photo.fileUniqueId}-160`,
                width: 160,
                height: 160,
                file_size: 8_000,
              },
              {
                file_id: photo.fileId,
                file_unique_id: photo.fileUniqueId,
                width: 640,
                height: 640,
                file_size: options.fileSize ?? photo.bytes.byteLength,
              },
            ],
          ],
        },
      })
    }

    if (pathname.endsWith("/getFile")) {
      if (options.refuse === "getFile") return refused
      if (photo === "none") return refused
      return Response.json({
        ok: true,
        result: {
          file_id: photo.fileId,
          file_unique_id: photo.fileUniqueId,
          file_size: options.fileSize ?? photo.bytes.byteLength,
          ...(options.withoutFilePath === true ? {} : { file_path: photo.filePath }),
        },
      })
    }

    // Not an API method: `/file/bot<token>/<file_path>` is Telegram's own file
    // endpoint, and the only place the token appears in a URL we build.
    if (pathname.startsWith("/file/bot")) {
      if (options.refuse === "download" || photo === "none") {
        return new Response(null, { status: 404 })
      }
      return new Response(photo.bytes)
    }

    return undefined
  }

export interface AvatarRepoStub {
  readonly layer: Layer.Layer<AvatarRepo.Service>
  /** Every key written, in order; `undefined` is a clear. */
  readonly writes: Array<string | undefined>
  /** What the column holds now. */
  readonly key: () => string | undefined
}

/**
 * The member column, in memory, behaving the way the statement behaves: a write
 * of the key it already holds is not a change.
 */
export const avatarRepoStub = (initial?: string): AvatarRepoStub => {
  const writes: Array<string | undefined> = []
  let current = initial
  return {
    layer: Layer.succeed(
      AvatarRepo.Service,
      AvatarRepo.Service.of({
        coachAvatarKey: () => Effect.succeed(current),
        setCoachAvatar: (input) =>
          Effect.sync(() => {
            writes.push(input.r2Key)
            const superseded = current
            if (superseded === input.r2Key) return { outcome: "unchanged" }
            current = input.r2Key
            return {
              outcome: "written",
              ...(superseded === undefined ? {} : { superseded }),
            }
          }),
      }),
    ),
    writes,
    key: () => current,
  }
}
