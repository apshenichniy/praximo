import type { CoachLanguage } from "@praximo/domain"
import type { ReactNode } from "react"

import { AppearanceMenu } from "@/components/appearance-menu.tsx"
import { BrandLockup } from "@/components/brand-lockup.tsx"
import { chromeCopy } from "@/features/i18n/chrome-copy.ts"

/**
 * The frame every page of the client app sits in.
 *
 * Deliberately unlike the Mini App's `MiniAppShell`, which is a phone webview's
 * frame: safe-area insets published by Telegram, no chrome of its own, because
 * the host supplies all of it. This app has no host. It needs the two things a
 * page in a browser needs and a webview does not — something that says whose
 * page this is, and the reader's own control over how it looks.
 *
 * The footer is where both live. It is the conventional place for them, it is
 * out of the way of a person who came to read, and it is the same place on every
 * page so it can be found once rather than looked for.
 *
 * The mark and the appearance control are the *same two components* the
 * acceptance page's header uses. Only their position differs, and it differs for
 * a stated reason (`InviteShell`): a page that is read puts its chrome at the
 * bottom, a page that is acted on has to offer the language control before the
 * reader commits. What they must never differ in is what they look like — a
 * client meets these two pages one after the other, and the frame is the only
 * thing telling them it is still the same place.
 */
export function ClientShell({
  children,
  locale,
}: {
  readonly children: ReactNode
  /** The language the page is in — the footer speaks it too. */
  readonly locale: CoachLanguage
}) {
  const copy = chromeCopy(locale)

  return (
    <div className="bg-background text-foreground font-sans flex min-h-svh flex-col">
      <div className="flex-1">{children}</div>

      <footer className="border-border mx-auto flex w-full max-w-2xl items-center justify-between gap-4 border-t px-5 py-6">
        <BrandLockup />
        <AppearanceMenu copy={copy} />
      </footer>
    </div>
  )
}
