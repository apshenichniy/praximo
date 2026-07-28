import { useState } from "react"

import { HostBackButton } from "@/presentation-host"
import { Heading } from "@praximo/ui"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { InviteLinkPanel } from "@/features/mini-app/components/invite-link-panel.tsx"
import { useCopyLink } from "@/features/mini-app/hooks/use-copy-link.ts"

/**
 * The optional @BotFather steps, on a screen of their own (#61).
 *
 * #56 kept this as a standing instruction card on the home screen with a Hide
 * control beside it. Today replaces that home, and the hint takes the shape it
 * was always meant to have: **one row on the dashboard, reading as its payoff**,
 * and everything else — the steps, the per-bot address, and Hide — here.
 *
 * **Hide lives on this screen and nowhere else.** A control that puts the row
 * away from the dashboard is a control a coach uses without ever reading what
 * they are putting away; here they have read it. And for everyone who actually
 * did the steps the row dismisses itself, because Telegram then reports
 * `has_main_web_app` and nobody has to tell us anything (#55, #56).
 */
export function MainMiniAppScreen({
  copy,
  mainMiniAppUrl,
  onHide,
}: {
  readonly copy: CoachCopy
  /** This coach's own bot's Mini App address — the exact string @BotFather wants. */
  readonly mainMiniAppUrl: string
  readonly onHide: () => void
}) {
  const [hidden, setHidden] = useState(false)
  const copyAddress = useCopyLink(mainMiniAppUrl)

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={copy.common.back} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.home.mainMiniAppTitle}
      </Heading>

      {/*
        Four steps, because the row on Today promised four. A run-on sentence
        naming them would meet the letter of that promise and break it: this is a
        sequence a coach follows with @BotFather open in the other chat.
      */}
      <ol className="mt-6 flex flex-col gap-3">
        {copy.home.mainMiniAppSteps.map((step, index) => (
          <li key={step} className="flex items-start gap-3">
            <span className="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs leading-normal font-semibold tabular-nums">
              {index + 1}
            </span>
            {/* The steps are what this screen is; the paragraph under them only
                explains what following them gets you. They were the smaller of
                the two, which is the hierarchy upside down (#198). */}
            <span className="text-base leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      <p className="text-muted-foreground mt-6 text-base leading-relaxed leading-6">
        {copy.home.mainMiniAppLead}
        <span className="text-foreground">{copy.home.mainMiniAppOpen}</span>
        {copy.home.mainMiniAppTail}
      </p>

      <p className="text-muted-foreground mt-8 px-1 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.home.mainMiniAppUrlLabel}
      </p>
      {/* The address is a read-only field rather than text to transcribe: one
          wrong character produces a Mini App that opens nothing. The inline
          control follows the same copy/select fallback as client invitations,
          while the field remains focusable for manual selection (#218). */}
      <div className="mt-2">
        <InviteLinkPanel
          link={mainMiniAppUrl}
          ariaLabel={copy.home.mainMiniAppUrlLabel}
          controller={copyAddress}
          copyLabel={copy.home.mainMiniAppCopy}
          copiedLabel={copy.home.mainMiniAppCopied}
        />
      </div>

      {/* Outline, not ghost (#198). A ghost button has no fill and no edge, and
          its only resting mark is a `hover:` that does not exist on a phone — so
          this read as a grey paragraph that happened to respond to a tap. The
          same defect as the slots, in a variant rather than at a call site.

          Ghost is still right where something else already marks the control: an
          icon button inside a field, a day inside the calendar's grid, or the
          quiet destructive action under a big Cancel, which #197 made quiet on
          purpose. Standing alone on a page it marks nothing. */}
      <Button
        variant="outline"
        className="text-muted-foreground mt-8"
        disabled={hidden}
        onClick={() => {
          // Optimistic on purpose: this is a preference, and a coach who put a
          // row away must not watch it sit there while a write lands.
          setHidden(true)
          onHide()
        }}
      >
        {copy.home.mainMiniAppHide}
      </Button>
    </main>
  )
}
