import type { CoachLanguage } from "@praximo/domain"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"

/**
 * **Continue with Google**, drawn by us (#59).
 *
 * **Why not Google Identity Services.** GIS would render a compliant, localised
 * button for free — and would load a third-party script and talk to Google
 * *before the client has touched anything*, on a page whose one promise is that
 * nothing has been saved yet. That is a promise a client can check by opening
 * their network tab, and it is worth more than the free button.
 *
 * The cost is that brand compliance is ours to carry at OAuth verification, and
 * that is what this file is:
 *
 * - **Google's own mark**, inlined as the four-path SVG rather than fetched, so
 *   the page still reaches Google for nothing. Never recoloured, never rotated,
 *   and never smaller than its 18px specification.
 * - **Google's own wording and Google's own translations.** «Продовжити з
 *   Google», «Продолжить с Google» are the approved strings, not ours —
 *   localising the CTA is explicitly encouraged, inventing it is not.
 * - **Google's colours, not this product's tokens.** White on `#747775` in the
 *   light theme and `#131314` on `#8e918f` in the dark one are both from their
 *   published button themes. A violet Praximo button with a G on it would be
 *   neither compliant nor honest about whose sign-in this is.
 * - **40px minimum height** and the specified padding either side of the mark.
 *
 * The corner radius and the type face are the two things their guidelines leave
 * to the product, and both are taken from the page around it so the button reads
 * as part of this document rather than as a widget dropped into it.
 */

/** The Google "G", exactly as their brand assets draw it. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export function GoogleButton({
  locale,
  busy,
  onPress,
}: {
  readonly locale: CoachLanguage
  /** The popup is open, or the exchange is in flight. */
  readonly busy: boolean
  readonly onPress: () => void
}) {
  const copy = inviteCopy(locale)

  return (
    // A plain `button` rather than the shared primitive, and this is the one
    // place in the app where that is right: the primitive's colours and radius
    // are Praximo's, and this control's have to be Google's.
    <button
      type="button"
      onClick={onPress}
      disabled={busy}
      className="flex h-10 w-full items-center justify-center gap-3 rounded-[9px] border border-[#747775] bg-white px-3 text-[14.5px] font-medium text-[#1f1f1f] transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-[#4285f4]/40 focus-visible:outline-none disabled:opacity-60 dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3]"
    >
      <GoogleMark />
      {copy.form.google}
    </button>
  )
}

/**
 * The line that replaces the button once the import has happened.
 *
 * **A sentence, not a badge.** Every field it filled stays an ordinary editable
 * field, so a mark reading "verified" beside them would be a claim the next
 * keystroke makes false. What the client is told is where the data came from,
 * which is a fact that stays true.
 *
 * `unverified` is what Google's own `email_verified: false` earns — it happens
 * when a non-Google domain is attached to the account (#28). The address is
 * filled in either way; it is simply not described as confirmed.
 */
export function GoogleOutcome({
  locale,
  outcome,
}: {
  readonly locale: CoachLanguage
  readonly outcome: "done" | "unverified" | "failed"
}) {
  const copy = inviteCopy(locale).form
  const text =
    outcome === "failed"
      ? copy.googleFailed
      : outcome === "unverified"
        ? copy.googleDoneUnverified
        : copy.googleDone

  return (
    // Muted in every case, failure included. A red line for a declined consent
    // screen would treat the client's own decision as an error; what they need is
    // the sentence saying the fields below are the way through, which is quiet.
    <p
      className="text-muted-foreground text-xs leading-[1.45]"
      // It still has to reach somebody whose eye is on the button they just
      // pressed rather than on the paragraph underneath it.
      role="status"
    >
      {text}
    </p>
  )
}

/**
 * The rule between the import and the fields it fills.
 *
 * Both halves are ways of giving the same two facts, so neither is the
 * alternative to the other — «или» sits between them as a word, not as a divider
 * with a heading.
 */
export function GoogleRule({ locale }: { readonly locale: CoachLanguage }) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span className="bg-border h-px flex-1" />
      {inviteCopy(locale).form.or}
      <span className="bg-border h-px flex-1" />
    </div>
  )
}
