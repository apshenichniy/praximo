import "@tanstack/react-start/server-only"

import { AvatarRepo } from "@praximo/db"
import type { WorkspaceId } from "@praximo/domain"
import { AvatarStore, MaxAvatarBytes } from "@praximo/storage"
import { Clock, Effect, Result } from "effect"

import { googlePictureUrl } from "./google-identity.ts"

/**
 * The Google `picture`, snapshotted into R2 at the moment the client accepts
 * (#59) — the client Worker's half of the writer #225 built.
 *
 * **Why a snapshot at all.** A `googleusercontent` URL is not a stable address:
 * it changes when the picture does and stops resolving when the account does, so
 * a column holding one would be a column that quietly rots. The bytes are taken
 * once and the key names the source, exactly as the Telegram path's does.
 *
 * **Why after the commit, never inside it.** Both halves carry weight, and they
 * are the same two the bot's capture is built on. The commit is what carries the
 * consent, so fetching somebody's photograph before it would be processing
 * without one, and an abandoned page would leave an object nothing references.
 * And the commit is atomic: it must not wait on Google's CDN or be undone by it.
 *
 * **Why no refresh and no backfill.** A client's avatar is a snapshot of who
 * walked in, not a face the product keeps in step — the rule #231 set for the
 * Telegram path, and there is even less to hang a refresh on here: no token was
 * kept, so there is nothing to ask Google with.
 */

/**
 * The longest the whole capture may take before it is abandoned.
 *
 * **This one runs inside the request the client is watching for their
 * confirmation**, which makes the bound different in kind from the bot's. Five
 * seconds is far beyond the few hundred milliseconds a profile picture takes, so
 * it never fires on a working import; what it rules out is a client left staring
 * at a spinner because a CDN stopped answering, over a picture nobody asked them
 * for.
 */
export const PictureTimeoutMillis = 5_000

/**
 * What one capture settled into — for the log, and for a test that needs to say
 * which branch ran. `absent` is the ordinary answer for a client who typed their
 * details instead of importing them.
 */
export type GooglePictureOutcome =
  /** Downloaded, stored, and the key written to the row and the channel snapshot. */
  | "stored"
  /** There was no picture to fetch. Initials, as designed everywhere. */
  | "absent"
  /** Not an address, a type or a size an avatar may have. Nothing was stored. */
  | "rejected"
  /** Something did not answer, or the row kept its own key. */
  | "failed"

export interface GooglePictureCapture {
  readonly workspaceId: WorkspaceId
  readonly clientId: string
  /**
   * The address Google gave, as it was sealed into the import cookie — and
   * checked again here rather than trusted. See {@link googlePictureUrl}.
   */
  readonly pictureUrl: string | undefined
  /** The Worker's transport, injected the way every other path here injects it. */
  readonly fetch: typeof globalThis.fetch
}

/**
 * Give up, saying why, and leave the client with their initials.
 *
 * The client names itself in the line because that is what a runbook looks up,
 * and no cause, URL or address ever joins it: this path's URLs identify a named
 * person's photograph (ADR 0004).
 */
const abandon = (clientId: string, because: string, as: GooglePictureOutcome = "failed") =>
  Effect.as(Effect.logWarning(`google picture for ${clientId}: ${because}`), as)

const download = (fetch: typeof globalThis.fetch, url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`picture endpoint answered ${response.status}`)
      const declared = Number(response.headers.get("content-length") ?? Number.NaN)
      // Refused on the reported length, before the body is held: `AvatarStore`
      // enforces the same bound on the buffer, and doing it here is what keeps
      // an unbounded body out of a Worker's memory in the first place.
      if (Number.isFinite(declared) && declared > MaxAvatarBytes) return "too-large" as const
      return {
        contentType: response.headers.get("content-type") ?? "",
        bytes: new Uint8Array(await response.arrayBuffer()),
      }
    },
    catch: () => "download" as const,
  })

const run = Effect.fn("ClientWorker.captureGooglePicture")(function* (input: GooglePictureCapture) {
  const store = yield* AvatarStore.Service
  const avatars = yield* AvatarRepo.Service
  const { workspaceId, clientId } = input

  // Most clients type their details, and a client without a picture is the
  // ordinary case rather than a fault. Nothing is fetched and nothing is written.
  if (input.pictureUrl === undefined) return "absent" as const satisfies GooglePictureOutcome

  const url = googlePictureUrl(input.pictureUrl)
  if (url === undefined) {
    return yield* abandon(clientId, "the address was not Google's, and was not fetched", "rejected")
  }

  const downloaded = yield* download(input.fetch, url).pipe(Effect.result)
  if (Result.isFailure(downloaded)) return yield* abandon(clientId, "the picture did not download")
  if (downloaded.success === "too-large") {
    return yield* abandon(clientId, "it is larger than an avatar may be", "rejected")
  }

  const stored = yield* store
    .store({
      subject: "client",
      subjectId: clientId,
      // The URL names the source, which is what makes the key change exactly when
      // the picture does. It is sanitised, truncated and checksummed by
      // `avatarKey` and never parsed.
      sourceId: url,
      contentType: downloaded.success.contentType,
      body: downloaded.success.bytes,
    })
    .pipe(Effect.result)
  if (Result.isFailure(stored)) {
    // Every reason the store refuses for is a fact about the picture rather than
    // a fault of ours: a type an avatar may not be, an empty body, a size past
    // the bound. `write-failed` is the exception and is rare enough to share the
    // line rather than earn a branch.
    return yield* abandon(clientId, `not stored — ${stored.failure.reason}`, "rejected")
  }

  const written = yield* avatars
    .setClientAvatar({
      workspaceId,
      clientId,
      r2Key: stored.success,
      now: new Date(yield* Clock.currentTimeMillis),
    })
    .pipe(Effect.result)
  if (Result.isFailure(written)) {
    return yield* abandon(
      clientId,
      `stored at ${stored.success} but the client row was not updated — ${written.failure.operation}`,
    )
  }
  // `unchanged` is a real success: the row already names this exact object, which
  // is what a second commit on the same invitation would produce. Anything else
  // is the statement reporting a state this could not see — no such client in
  // this workspace, or a cleanup worker holding a live lease on that very key —
  // and the object is now unreferenced, so saying "stored" would put a key in the
  // log that no row carries.
  if (written.success.outcome !== "written" && written.success.outcome !== "unchanged") {
    return yield* abandon(
      clientId,
      `stored at ${stored.success} but the client row kept its own key — ${written.success.outcome}`,
    )
  }
  return "stored" as const satisfies GooglePictureOutcome
})

/**
 * The capture as its one caller wants it: bounded, quiet, and incapable of being
 * the reason anything else failed.
 *
 * **Including a defect.** There is no failure channel by construction, but a
 * response that contradicts its own documented shape would raise where no
 * `tryPromise` is looking — and a client must not be shown an error *after* their
 * acceptance has already been committed, over a profile picture nobody asked them
 * for. The raised value is not printed, for the reason the warnings above carry no
 * URL: what it holds is unknown, and the addresses on this path name a person.
 */
export const captureGooglePicture = Effect.fn("ClientWorker.captureGooglePictureQuietly")(
  function* (input: GooglePictureCapture) {
    const outcome = yield* run(input).pipe(
      Effect.timeout(PictureTimeoutMillis),
      Effect.catchCause(() =>
        abandon(input.clientId, `gave up after ${PictureTimeoutMillis}ms, and they keep initials`),
      ),
    )
    yield* Effect.logDebug(`google picture for ${input.clientId}: ${outcome}`)
    return outcome
  },
)
