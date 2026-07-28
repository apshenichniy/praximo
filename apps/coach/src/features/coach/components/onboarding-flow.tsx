import type { CoachLanguage } from "@praximo/domain"
import { useCallback, useState } from "react"

import { HostBackButton } from "@/presentation-host"
import { LanguageStep } from "@/features/coach/components/language-step.tsx"
import { TermsScreen } from "@/features/coach/components/terms-screen.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"

export type OnboardingStep = "language" | "terms"

/**
 * First login, both steps of it (#130).
 *
 * The step lives in component state rather than in the URL for the same reason
 * the whole of first login does: `terms-required` is a state of the entry, not a
 * route (mini-app.md §First login), and a blocking screen with an address is a
 * screen that can be bookmarked past. Stepping back is the host's own back
 * button, which on this screen would otherwise close the app.
 *
 * The language shown is the server's, not this component's: `language` here is
 * only what the coach has tapped and not yet confirmed. Continue persists it and
 * the entry is re-read, so by the time the terms render, `member.language` — the
 * thing the bot and the legal routes read — already says the same thing the
 * screen does.
 */
export function OnboardingFlow({
  language,
  legalOrigin,
  onChooseLanguage,
  onAccept,
  pending,
  error,
}: {
  /** The coach's language as the server currently has it. */
  readonly language: CoachLanguage
  /** Where the full legal texts live — the client app's origin, from the entry. */
  readonly legalOrigin: string
  readonly onChooseLanguage: (language: CoachLanguage) => Promise<boolean>
  readonly onAccept: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const [step, setStep] = useState<OnboardingStep>("language")
  const [selected, setSelected] = useState<CoachLanguage>(language)

  const copy = coachCopy(step === "language" ? selected : language)

  const confirmLanguage = useCallback(() => {
    void onChooseLanguage(selected).then((saved) => {
      if (saved) setStep("terms")
    })
  }, [onChooseLanguage, selected])

  const backToLanguage = useCallback(() => setStep("language"), [])

  if (step === "language") {
    return (
      <LanguageStep
        copy={copy}
        language={selected}
        onChange={setSelected}
        onContinue={confirmLanguage}
        pending={pending}
        error={error}
      />
    )
  }

  return (
    <>
      <HostBackButton onBack={backToLanguage} label={copy.common.back} />
      <TermsScreen
        copy={copy}
        locale={language}
        legalOrigin={legalOrigin}
        onAccept={onAccept}
        pending={pending}
        error={error}
      />
    </>
  )
}
