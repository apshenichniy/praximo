/**
 * FNV-1a over a text, as seven lowercase hex characters.
 *
 * Not a security primitive — its whole job is that two different texts cannot
 * share a version. It lives here rather than beside the legal texts because a
 * version derived from content is what every piece of versioned copy needs:
 * Client dates the coach terms and the privacy policy with it today, and the
 * client-facing consent text needs one per language next (#56).
 */
export const contentDigest = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0").slice(1)
}
