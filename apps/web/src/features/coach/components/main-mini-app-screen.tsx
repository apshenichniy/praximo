import { useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"

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

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <TelegramBackButton label={copy.common.back} />

      <h1 className="mt-2 text-title font-semibold tracking-tight">{copy.home.mainMiniAppTitle}</h1>

      {/*
        Four steps, because the row on Today promised four. A run-on sentence
        naming them would meet the letter of that promise and break it: this is a
        sequence a coach follows with @BotFather open in the other chat.
      */}
      <ol className="mt-6 flex flex-col gap-3">
        {copy.home.mainMiniAppSteps.map((step, index) => (
          <li key={step} className="flex items-start gap-3">
            <span className="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold tabular-nums">
              {index + 1}
            </span>
            {/* The steps are what this screen is; the paragraph under them only
                explains what following them gets you. They were the smaller of
                the two, which is the hierarchy upside down (#198). */}
            <span className="text-body">{step}</span>
          </li>
        ))}
      </ol>

      <p className="text-muted-foreground mt-6 text-body leading-6">
        {copy.home.mainMiniAppLead}
        <span className="text-foreground">{copy.home.mainMiniAppOpen}</span>
        {copy.home.mainMiniAppTail}
      </p>

      <p className="text-muted-foreground mt-8 px-1 text-caption font-semibold tracking-wide uppercase">
        {copy.home.mainMiniAppUrlLabel}
      </p>
      {/* A value the reader has to transcribe is never a caption (#198). This is
          the one thing on the screen that gets read character by character and
          pasted into another app, and a wrong character produces a Mini App that
          opens nothing. Monospace also reads smaller than proportional type at
          the same nominal size, so 13px here was two steps down, not one. */}
      <p className="border-border bg-card text-foreground mt-2 overflow-x-auto rounded-xl border px-3.5 py-2.5 font-mono text-body break-all">
        {mainMiniAppUrl}
      </p>

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
