import type { CoachLanguage } from "@praximo/domain"
import type { ReactNode } from "react"

import { AppearanceMenu } from "@/components/appearance-menu.tsx"
import { BrandLockup } from "@/components/brand-lockup.tsx"
import { LanguageMenu } from "@/components/language-menu.tsx"
import { chromeCopy } from "@/features/i18n/chrome-copy.ts"

/**
 * The Acceptance Page's frame (#57) — and deliberately not `ClientShell`.
 *
 * That one puts the mark and the appearance control in a **footer**, which is
 * right for the legal texts: somebody came to read, the chrome should be out of
 * the way, and it is in the same place on every page so it can be found once.
 *
 * This page is not read, it is *acted on*, and two things follow. The language
 * control has to be reachable before the reader commits rather than after they
 * scroll past a consent text — so it goes up top. And the layout ends in a
 * sticky commit bar, so a footer would stack a second horizontal band directly
 * beneath the first; moving the brand and the controls into a header is what
 * removes one of them.
 */
export function InviteShell({
  children,
  locale,
  onLanguageChange,
}: {
  readonly children: ReactNode
  readonly locale: CoachLanguage
  /**
   * Changing the language re-renders the page in place and loses nothing,
   * because nothing is stored yet — which is the whole reason it can be a
   * control rather than a step. The bot has to ask first only because it cannot
   * show the consent text before asking.
   */
  readonly onLanguageChange: (language: CoachLanguage) => void
}) {
  const copy = chromeCopy(locale)

  return (
    <div className="bg-background text-foreground font-sans flex min-h-svh flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3.5 px-5 py-4 sm:px-11">
        <BrandLockup />
        <span className="flex items-center gap-0.5">
          <LanguageMenu locale={locale} label={copy.language} onChange={onLanguageChange} />
          <AppearanceMenu copy={copy} />
        </span>
      </header>

      {children}
    </div>
  )
}
