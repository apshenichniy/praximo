/**
 * Where an avatar lives in R2, and the vocabulary every writer of one shares.
 *
 * **The key is derived from the source image's identity, and that is the whole
 * point.** A stored avatar is a snapshot of a picture somebody else owns — a
 * Telegram profile photo, a Google `picture` — and the question every refresh
 * asks is "is this the same picture we already hold?". With the source's id in
 * the key, that question is a string comparison against the column, answerable
 * *before* anything is downloaded and without a second column to keep in step.
 *
 * Pure and synchronous on purpose: a caller composes the candidate key, compares
 * it, and only then spends a network round trip (#225).
 */

/** Whose picture this is. `client` arrives with the Google import (#59). */
export type AvatarSubject = "coach" | "client"

/**
 * The three shapes an avatar may be, and the extension each one wears.
 *
 * A closed set rather than a passthrough: the key names a file extension, and an
 * object stored under an extension nothing can decode is worse than no object at
 * all. SVG is deliberately absent — it is a document that can carry script, and
 * an avatar is a photograph.
 */
export const AvatarExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export type AvatarContentType = keyof typeof AvatarExtensions

/**
 * A content type as it arrives off a wire — cased however the server felt, and
 * possibly carrying parameters — reduced to the bare type.
 */
export const bareContentType = (value: string): string =>
  (value.split(";")[0] ?? "").trim().toLowerCase()

/**
 * The content type an avatar of this type is stored under, and the extension its
 * key wears — or `undefined` when it is not a type an avatar may be.
 *
 * Both together rather than the extension alone, because a caller that stores the
 * object needs the normalised type to put on it and would otherwise re-derive it.
 */
export const avatarContentType = (
  contentType: string,
): { readonly type: AvatarContentType; readonly extension: string } | undefined => {
  const bare = bareContentType(contentType)
  return Object.hasOwn(AvatarExtensions, bare)
    ? { type: bare as AvatarContentType, extension: AvatarExtensions[bare as AvatarContentType] }
    : undefined
}

export const avatarExtension = (contentType: string): string | undefined =>
  avatarContentType(contentType)?.extension

/**
 * How much of a source id survives into the key. Long enough that a Telegram
 * `file_unique_id` lands whole and readable in the bucket, short enough that a
 * URL used as a source id does not become the object's name.
 */
const StemMaxLength = 32

/** Everything an object key may safely be made of, and nothing else. */
const sanitize = (value: string): string => value.replaceAll(/[^A-Za-z0-9_-]/g, "")

/**
 * A short, stable checksum of the source id — FNV-1a, the same derivation
 * `suggestedBotUsername`'s workspace tag uses.
 *
 * It is what makes the truncation above safe: two sources whose readable stems
 * collide — the same 32 characters, or nothing sanitisable at all — still get
 * different keys, so a changed picture can never read as an unchanged one. Not a
 * secret and not a content hash: it names the *source*, not the bytes.
 *
 * Folded over UTF-16 code units rather than UTF-8 bytes so this package needs no
 * `TextEncoder` and therefore no DOM lib — determinism is the only property
 * asked of it, and both are equally deterministic.
 */
const checksum = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export interface AvatarKeyInput {
  readonly subject: AvatarSubject
  /** The row this picture hangs off — a workspace for a coach, a client for a client. */
  readonly subjectId: string
  /**
   * A stable name for the picture itself. Telegram's `file_unique_id` for a
   * profile photo; whatever identifies the imported one for #59. Opaque here:
   * it is sanitised, truncated and checksummed, never parsed.
   */
  readonly sourceId: string
  readonly contentType: string
}

/**
 * The key, or `undefined` when there is nothing to compose one from: a content
 * type an avatar may not be, a subject with no usable id, or no source at all.
 * A caller that cannot get a key has nothing to store.
 */
export const avatarKey = (input: AvatarKeyInput): string | undefined => {
  const extension = avatarExtension(input.contentType)
  if (extension === undefined) return undefined
  const subjectId = sanitize(input.subjectId)
  if (subjectId.length === 0 || input.sourceId.length === 0) return undefined
  const readable = sanitize(input.sourceId).slice(0, StemMaxLength)
  const digest = checksum(input.sourceId)
  const stem = readable.length === 0 ? digest : `${readable}-${digest}`
  return `avatars/${input.subject}/${subjectId}/${stem}.${extension}`
}
