import type { CoachLanguage } from "@praximo/domain"

import { Heading, Text, typographyRecipe } from "@praximo/ui"
import { HostMainButton } from "@/presentation-host"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { OnboardingProgress } from "@/features/coach/components/onboarding-progress.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { legalUrl, type LegalDocumentName } from "@praximo/i18n"
import { openExternalLink } from "@/presentation-host"

/**
 * First login, step two: what every coach agrees to, in five lines they will
 * actually read, with the full texts one tap away.
 *
 * Those texts are on another host since #191 — `me.praximo.io`, the Client app —
 * so the two links are external where they used to be router links. The warning
 * that used to sit here still stands and is now answered rather than avoided: a
 * link that ejects a coach into the system browser mid-onboarding is one they
 * may not come back from, so these open through `openLink`, in Telegram's own
 * in-app browser, over a Mini App that is still running with a back arrow to it.
 * Outside a Telegram launch the `href` does its ordinary job.
 *
 * There is no Decline: declining is closing the app, and a button that ends
 * onboarding with no way back is a trap, not a choice. There is no
 * scroll-to-the-end gate either — it measures scrolling, not reading, and it
 * makes the summary above pointless.
 *
 * Every word of it renders in the language settled one step earlier, and the
 * links carry that language so the full texts open in it too (#130) — including
 * for a coach who has not finished onboarding, since those pages are public and
 * have no credential to read a member from.
 */
export function TermsScreen({
  copy,
  locale,
  legalOrigin,
  onAccept,
  pending,
  error,
}: {
  readonly copy: CoachCopy
  readonly locale: CoachLanguage
  /** The client app's origin, from the Worker's configuration — never a literal. */
  readonly legalOrigin: string
  readonly onAccept: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const label = pending ? copy.common.working : copy.terms.accept

  const legalLink = (document: LegalDocumentName, text: string) => (
    <a
      href={legalUrl(legalOrigin, document, locale)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4"
      onClick={(event) => {
        // Inside Telegram the bridge opens it and the default navigation is
        // exactly what must not happen — it would replace the Mini App. Outside,
        // this reports that it did nothing and the anchor behaves like an anchor.
        if (openExternalLink(event.currentTarget.href)) event.preventDefault()
      }}
    >
      {text}
    </a>
  )

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-10 pb-24">
      <OnboardingProgress step={2} label={copy.terms.step} />

      <Heading as="h1" role="page-title" className="mt-9 text-pretty">
        {copy.terms.title}
      </Heading>
      <Text className="text-muted-foreground mt-3 text-pretty">{copy.terms.lead}</Text>

      <ul className="mt-7 space-y-4">
        {copy.terms.points.map((line) => (
          <li
            key={line}
            className={`${typographyRecipe({ role: "body" })} text-foreground/90 flex gap-3`}
          >
            <span
              aria-hidden="true"
              className="bg-primary/60 mt-2.5 size-1.5 shrink-0 rounded-full"
            />
            <span className="text-pretty">{line}</span>
          </li>
        ))}
      </ul>

      <Text role="caption" className="text-muted-foreground mt-8">
        {copy.terms.legalLead}
        {legalLink("terms", copy.terms.legalTerms)}
        {copy.terms.legalAnd}
        {legalLink("privacy", copy.terms.legalPrivacy)}
        {copy.terms.legalTail}
      </Text>

      {error === undefined ? null : (
        <div role="alert">
          <Text className="text-destructive mt-6">{error}</Text>
        </div>
      )}

      <HostMainButton
        text={label}
        onClick={onAccept}
        fallback={
          <div className="mt-8">
            <Button
              className="h-12 w-full text-base leading-relaxed"
              disabled={pending}
              onClick={onAccept}
            >
              {label}
            </Button>
          </div>
        }
      />
    </main>
  )
}
