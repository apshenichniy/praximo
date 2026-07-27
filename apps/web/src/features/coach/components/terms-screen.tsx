import type { CoachLanguage } from "@praximo/domain"
import { Link } from "@tanstack/react-router"

import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { OnboardingProgress } from "@/features/coach/components/onboarding-progress.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { LEGAL_PATHS } from "@praximo/i18n"

/**
 * First login, step two: what every coach agrees to, in five lines they will
 * actually read, with the full texts one tap away on internal routes — a link
 * that ejected them into a browser mid-onboarding is one they may not come back
 * from.
 *
 * There is no Decline: declining is closing the app, and a button that ends
 * onboarding with no way back is a trap, not a choice. There is no
 * scroll-to-the-end gate either — it measures scrolling, not reading, and it
 * makes the summary above pointless.
 *
 * Every word of it renders in the language settled one step earlier, and the
 * links carry that language so the full texts open in it too (#130) — including
 * for a coach who has not finished onboarding, since those routes are public and
 * have no credential to read a member from.
 */
export function TermsScreen({
  copy,
  locale,
  onAccept,
  pending,
  error,
}: {
  readonly copy: CoachCopy
  readonly locale: CoachLanguage
  readonly onAccept: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const label = pending ? copy.common.working : copy.terms.accept

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-10 pb-24">
      <OnboardingProgress step={2} label={copy.terms.step} />

      <h1 className="mt-9 text-title font-semibold tracking-tight text-pretty">
        {copy.terms.title}
      </h1>
      <p className="text-muted-foreground mt-3 text-body leading-6 text-pretty">
        {copy.terms.lead}
      </p>

      <ul className="mt-7 space-y-4">
        {copy.terms.points.map((line) => (
          <li key={line} className="text-foreground/90 flex gap-3 text-body leading-6">
            <span
              aria-hidden="true"
              className="bg-primary/60 mt-2.5 size-1.5 shrink-0 rounded-full"
            />
            <span className="text-pretty">{line}</span>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-8 text-caption leading-5">
        {copy.terms.legalLead}
        <Link
          to={LEGAL_PATHS.terms}
          search={{ lang: locale }}
          className="text-primary underline underline-offset-4"
        >
          {copy.terms.legalTerms}
        </Link>
        {copy.terms.legalAnd}
        <Link
          to={LEGAL_PATHS.privacy}
          search={{ lang: locale }}
          className="text-primary underline underline-offset-4"
        >
          {copy.terms.legalPrivacy}
        </Link>
        {copy.terms.legalTail}
      </p>

      {error === undefined ? null : (
        <p role="alert" className="text-destructive mt-6 text-body">
          {error}
        </p>
      )}

      <TelegramMainButton
        text={label}
        onClick={onAccept}
        fallback={
          <div className="mt-8">
            <Button className="h-12 w-full text-body" disabled={pending} onClick={onAccept}>
              {label}
            </Button>
          </div>
        }
      />
    </main>
  )
}
