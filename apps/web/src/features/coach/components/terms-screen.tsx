import { Link } from "@tanstack/react-router"

import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { LEGAL_PATHS } from "@/features/legal/content.ts"

/**
 * What every coach agrees to, in five lines they will actually read, with the
 * full texts one tap away on internal routes — a link that ejected them into a
 * browser mid-onboarding is one they may not come back from.
 *
 * There is no Decline: declining is closing the app, and a button that ends
 * onboarding with no way back is a trap, not a choice. There is no
 * scroll-to-the-end gate either — it measures scrolling, not reading, and it
 * makes the summary above pointless.
 */
const summary = [
  "You decide what client data enters Praximo and what happens to it. We run the software on your instructions.",
  "The AI notes are assistive, not authoritative. Review them before you rely on them with a client.",
  "The competency framework the self-review draws on is described in our own words. We are not affiliated with any coaching federation.",
  "This is early access: features change, and there is no uptime guarantee.",
  "Everything is stored in the EU, except the AI analysis, which runs on providers in the United States.",
]

export function TermsScreen({
  onAccept,
  pending,
  error,
}: {
  readonly onAccept: () => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const label = pending ? "One moment…" : "I agree and continue"

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-12 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight text-pretty">Before you start</h1>
      <p className="text-muted-foreground mt-3 text-[15px] leading-6 text-pretty">
        The short version of what you are agreeing to.
      </p>

      <ul className="mt-7 space-y-4">
        {summary.map((line) => (
          <li key={line} className="text-foreground/90 flex gap-3 text-[15px] leading-6">
            <span
              aria-hidden="true"
              className="bg-primary/60 mt-2.5 size-1.5 shrink-0 rounded-full"
            />
            <span className="text-pretty">{line}</span>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-8 text-[13px] leading-5">
        The full{" "}
        <Link to={LEGAL_PATHS.terms} className="text-primary underline underline-offset-4">
          terms of service
        </Link>{" "}
        and{" "}
        <Link to={LEGAL_PATHS.privacy} className="text-primary underline underline-offset-4">
          privacy policy
        </Link>{" "}
        are what you are accepting.
      </p>

      {error === undefined ? null : (
        <p role="alert" className="text-destructive mt-6 text-sm">
          {error}
        </p>
      )}

      <TelegramMainButton
        text={label}
        onClick={onAccept}
        fallback={
          <div className="mt-8">
            <Button className="w-full" disabled={pending} onClick={onAccept}>
              {label}
            </Button>
          </div>
        }
      />
    </main>
  )
}
