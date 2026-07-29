/**
 * What counts as an email address, in one place (#58).
 *
 * It lived in two independently, with the same regex written twice: the Admin
 * section's invite sheet and the Acceptance Page's commit. #58 would have opened
 * a third, on the coach's own screen — and three copies of a rule about what a
 * *Channel* may hold is three chances for the coach's screen to accept an
 * address the client's page then refuses.
 *
 * It belongs here rather than in a validation helper because "every client is
 * addressable" is a domain constraint (`client-onboarding-auth.md` §Every client
 * is addressable), not a detail of any one form.
 *
 * `apps/admin` keeps its own copy on purpose: it checks a *coach's* address
 * during platform onboarding, which is a different subject that happens to share
 * a shape today.
 */

/**
 * Deliberately permissive: catch the client who typed nothing or typed obvious
 * nonsense, not adjudicate RFC 5322. A regex strict enough to be interesting is
 * a regex that eventually rejects somebody's real address, and on the Acceptance
 * Page being turned away means not reaching your coach.
 *
 * What it says: there is something either side of an `@`, with a dot after it.
 */
const EmailShape = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

/**
 * RFC 5321's ceiling for a whole address — a stop, not a budget, so nothing
 * counts down to it on screen.
 *
 * The two former copies disagreed here: the Acceptance Page allowed 320, the
 * theoretical sum of the local-part and domain maxima, while the shipped invite
 * sheet already used 254, which is the figure the standard actually gives for
 * the address as a whole. 254 wins. Addresses in the gap do not exist in
 * practice, and a limit the send would reject anyway is worth catching while the
 * keyboard is still up.
 */
export const EmailAddressMaxLength = 254

/**
 * The address, trimmed — or `undefined` when the value is not one.
 *
 * Answers with the value rather than with a boolean so no caller can validate a
 * string and then store an untrimmed one beside it.
 */
export const readEmailAddress = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (trimmed.length > EmailAddressMaxLength) return undefined
  return EmailShape.test(trimmed) ? trimmed : undefined
}
