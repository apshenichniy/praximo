/**
 * The coach's initials, and the shipped fallback everywhere an avatar would go.
 *
 * #57 touches R2 zero times: the coach's Telegram photo is #225 and Google's
 * picture is #59, so on this page initials are not a placeholder waiting for an
 * image — they are the design. Which is also why they have to be right in three
 * alphabets rather than merely present.
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
