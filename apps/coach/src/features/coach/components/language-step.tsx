import { type CoachLanguage, CoachLanguages } from "@praximo/domain"

import { ChoiceChip, Heading, PraximoMark, Text } from "@praximo/ui"
import { HostMainButton } from "@/mini-app.tsx"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { OnboardingProgress } from "@/features/coach/components/onboarding-progress.tsx"
import { type CoachCopy, languageNames } from "@/features/i18n/coach-copy.ts"

/**
 * First login, step one: Praximo introduces itself and says — in the first
 * person, in the language currently selected — what that selection means.
 *
 * The sentence is the control's label, not a caption beside it. A coach tapping
 * "Українська" watches the product switch languages mid-introduction, which is
 * the only way a language chooser can teach that it governs the *bot* too and
 * not just the page it sits on. That was the failure of putting a switcher on
 * the terms screen: it read as "translate this text".
 *
 * The selection is local until Continue, which persists it. Nothing here is
 * destructive and there is nothing to undo, so a confirmation step would only
 * be ceremony — but the write has to land before the terms render, because the
 * legal routes read `member.language` rather than anything this screen holds.
 */
export function LanguageStep({
  copy,
  language,
  onChange,
  onContinue,
  pending,
  error,
}: {
  readonly copy: CoachCopy
  readonly language: CoachLanguage
  readonly onChange: (language: CoachLanguage) => void
  readonly onContinue: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const label = pending ? copy.common.working : copy.language.continue

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col px-5 pt-10 pb-24">
      <OnboardingProgress step={1} label={copy.language.step} />

      <PraximoMark size={56} className="mt-9" />

      <Heading as="h1" role="page-title" className="mt-6 text-pretty">
        {copy.language.greeting}
      </Heading>
      <Text className="text-muted-foreground mt-3 text-pretty">{copy.language.introduction}</Text>
      <Text className="mt-5 text-pretty">
        {copy.language.writesLead}
        <span className="font-semibold">{copy.language.writesEmphasis}</span>
        {copy.language.writesTail}
      </Text>

      {/*
        The same chips as everywhere else a coach picks one of a few things
        (#58). They were a `ToggleGroup` until then, which answered the question
        with a pale `bg-muted` fill — the weakest statement of "this one is
        chosen" in the app, on the screen where the choice is the whole point.
      */}
      <div role="group" aria-label={copy.language.chipsLabel} className="mt-6 flex flex-wrap gap-2">
        {CoachLanguages.map((value) => (
          <ChoiceChip
            key={value}
            className="px-5"
            selected={language === value}
            disabled={pending}
            onClick={() => onChange(value)}
          >
            {languageNames[value]}
          </ChoiceChip>
        ))}
      </div>

      {error === undefined ? null : (
        <div role="alert">
          <Text className="text-destructive mt-6">{error}</Text>
        </div>
      )}

      <HostMainButton
        text={label}
        onClick={onContinue}
        fallback={
          // Pushed to the bottom of the column, where the host's own button
          // sits inside Telegram. Only local browser development ever sees it.
          <div className="mt-auto pt-12">
            <Button
              className="h-12 w-full text-base leading-relaxed"
              disabled={pending}
              onClick={onContinue}
            >
              {label}
            </Button>
          </div>
        }
      />
    </main>
  )
}
