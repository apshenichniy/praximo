import {
  Alert02Icon,
  BotIcon,
  LockKeyIcon,
  Message01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback } from "react"

import { Text, cn } from "@praximo/ui"
import { Button } from "@praximo/ui/components/button"
import { Card, CardContent } from "@praximo/ui/components/card"
import { HostMainButton } from "@/presentation-host"
import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import {
  type CoachStep,
  type CoachStepState,
  coachScreen,
  type EntryView,
} from "@/features/entry/entry-view.ts"
import { openTelegramLink } from "@/presentation-host"
import type { ViewerRole } from "@/server/viewer-role.ts"

const markerClass = {
  done: "border-success/30 bg-success/12 text-success",
  current: "border-primary/30 bg-primary/10 text-primary",
  upcoming: "border-border text-muted-foreground/70",
} as const satisfies Record<CoachStepState, string>

/** Screen-reader equivalent of what the marker's colour and glyph convey. */
const stateLabel = {
  done: "Done",
  current: "In progress",
  upcoming: "Not started",
} as const satisfies Record<CoachStepState, string>

/**
 * The same progression the admin sees on a coach's details screen, told from
 * the coach's side. The rail is drawn between markers rather than around them,
 * so three steps read as one journey instead of three unrelated rows.
 */
function CoachSteps({ steps }: { readonly steps: ReadonlyArray<CoachStep> }) {
  return (
    <Card size="sm" className="mt-9">
      <CardContent>
        <ol className="flex flex-col">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs leading-normal font-semibold",
                    markerClass[step.state],
                  )}
                >
                  {step.state === "done" ? (
                    <HugeiconsIcon icon={Tick02Icon} size={15} strokeWidth={2.4} />
                  ) : (
                    index + 1
                  )}
                </span>
                {index === steps.length - 1 ? null : (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "w-px flex-1",
                      step.state === "done" ? "bg-success/30" : "bg-border",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0 pb-5", index === steps.length - 1 && "pb-0")}>
                <Text
                  as="div"
                  role="label"
                  className={cn(step.state === "upcoming" && "text-muted-foreground")}
                >
                  {step.title}
                  <span className="sr-only"> — {stateLabel[step.state]}</span>
                </Text>
                <Text role="caption" className="text-muted-foreground mt-1">
                  {step.description}
                </Text>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * A coach who opened the manager app. Every state here hands off somewhere else
 * — the manager chat while the bot is still being created, their own bot once
 * it exists — so the screen's one action is a link out, given to the host's
 * bottom button where there is one.
 *
 * It never redirects on its own: a Mini App that throws the viewer into another
 * chat unasked is indistinguishable from one that crashed (#112).
 */
function CoachEntry({ coach }: { readonly coach: ViewerRole.ViewerCoach }) {
  const screen = coachScreen(coach)
  const open = useCallback(() => void openTelegramLink(coach.link), [coach.link])

  return (
    <EntryFrame
      icon={coach.state === "accepted" ? Message01Icon : BotIcon}
      title={screen.title}
      body={screen.body}
    >
      {screen.steps.length === 0 ? null : <CoachSteps steps={screen.steps} />}
      <div className="mt-9">
        <HostMainButton
          text={screen.action}
          onClick={open}
          fallback={
            <Button size="lg" className="w-full" onClick={open}>
              {screen.action}
            </Button>
          }
        />
      </div>
    </EntryFrame>
  )
}

/**
 * Everyone else. It says what this app is and how one gets in, and offers
 * nothing to press: there is no self-service path into Praximo, so a button
 * here could only lead somewhere that would turn the person away again.
 */
function InviteOnlyLanding() {
  return (
    <EntryFrame
      icon={LockKeyIcon}
      title="Praximo is invite-only"
      body="Coaching workspaces are set up by a Praximo administrator. If you are expecting an invitation, open the one-time link they sent you."
    />
  )
}

/** The gate itself failed. The role is unknown, so nothing beyond a retry. */
function EntryUnavailable({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <EntryFrame
      icon={Alert02Icon}
      tone="muted"
      title="We couldn’t open Praximo"
      body="Something went wrong while checking your account. Try again in a moment — if it keeps happening, ask your Praximo administrator."
    >
      <div className="mt-9">
        <Button size="lg" variant="outline" className="w-full" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </EntryFrame>
  )
}

/**
 * The non-admin half of the entry dispatch. The admin tree is rendered by the
 * route itself and never reaches this component — which is the point: no admin
 * screen is mounted, even briefly, for a viewer the gate did not admit.
 *
 * Retrying is the route's business rather than the screen's, so it arrives as a
 * callback: re-resolving the role means re-running the gate, and only the route
 * knows how to do that.
 */
export function EntryScreen({
  view,
  onRetry,
}: {
  readonly view: Exclude<EntryView, { kind: "admin" }>
  readonly onRetry: () => void
}) {
  switch (view.kind) {
    case "coach":
      return <CoachEntry coach={view.coach} />
    case "landing":
      return <InviteOnlyLanding />
    case "unavailable":
      return <EntryUnavailable onRetry={onRetry} />
  }
}
