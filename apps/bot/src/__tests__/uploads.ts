/**
 * The stage's R2 bucket, as tests need it: holding whatever objects a test says
 * it holds, and recording what was asked for.
 *
 * Since #138 the coach bot's starting avatar is a stored image rather than a
 * generated one, so `UPLOADS` is on the provisioning path of every suite that
 * activates a bot — which key is read, and what happens when nothing is there,
 * is part of the contract now rather than an incidental dependency.
 */

export interface UploadsStub {
  readonly bucket: R2Bucket
  /** Keys `get` was called with, in order. */
  readonly reads: Array<string>
}

/**
 * Only `get` is implemented — provisioning reads and never writes. Typing it as
 * `R2Bucket["get"]` keeps that one method honest against the real interface, and
 * the widening cast is confined to the return, so a caller that later reaches
 * for `head`/`put` meets an obviously incomplete stub rather than `undefined`.
 */
export const uploadsStub = (objects: Record<string, Uint8Array> = {}): UploadsStub => {
  const reads: Array<string> = []
  const get: R2Bucket["get"] = async (key: string) => {
    reads.push(key)
    const bytes = objects[key]
    if (bytes === undefined) return null
    // Enough of an R2ObjectBody for the single method the reader calls.
    return { arrayBuffer: async () => bytes.slice().buffer } as R2ObjectBody
  }

  return { bucket: { get } as R2Bucket, reads }
}

/** The key every stage holds its branding image at, matching `.env.example`. */
export const BRANDING_AVATAR_KEY = "branding/default-coach-avatar.jpg"

/** A recognisable stand-in for the branding JPEG, small enough to compare by eye. */
export const BRANDING_AVATAR_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01])
