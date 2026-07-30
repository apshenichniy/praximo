/**
 * Somebody's initials, and the shipped fallback everywhere an avatar would go.
 *
 * They are **not a placeholder waiting for an image**. Nobody is ever asked to
 * upload one (#57), and most clients will never have a photo to capture — so for
 * them this *is* the design, which is why it has to be right in three alphabets
 * rather than merely present.
 *
 * Here rather than per surface since #231, when the surfaces that show a photo
 * became the same ones that show initials. Four copies had accumulated — this one,
 * two in the coach Mini App and Admin's — and three of them split on whitespace
 * alone and indexed by code unit, so a hyphenated name lost its second letter and
 * an astral character rendered as half a glyph. One implementation is the only way
 * that stays fixed.
 */
export const initials = (name: string): string => {
  const words = name
    .split(/[\s-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)

  // Two letters where there are two words, one where there is one. Never three:
  // a monogram is a shape at 60 pixels, and the third letter is what turns it
  // back into text.
  const letters = [words[0], words[1]]
    .filter((word): word is string => word !== undefined)
    // `Array.from`, not `[0]`: a surrogate pair indexed by code unit yields half
    // a character, and the half renders as a replacement glyph.
    .map((word) => Array.from(word)[0] ?? "")
    .join("")

  return letters.toLocaleUpperCase()
}
