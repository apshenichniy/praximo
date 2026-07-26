import { Alert01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Card, CardContent } from "@/components/ui/card.tsx"
import { Section, SectionTitle } from "@/features/mini-app/components/section.tsx"
import {
  onboardingSteps,
  type StepState,
  type WorkspaceDetail,
} from "@/features/admin/workspace-detail.ts"
import { cn } from "@/lib/utils.ts"

const markerClass = {
  done: "border-emerald-400/30 bg-emerald-400/12 text-emerald-300",
  current: "border-primary/50 bg-primary/10 text-primary",
  upcoming: "border-border text-muted-foreground/70",
  blocked: "border-amber-400/30 bg-amber-400/12 text-amber-300",
} as const satisfies Record<StepState, string>

function StepMarker({ state, index }: { readonly state: StepState; readonly index: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border text-caption font-semibold",
        markerClass[state],
      )}
    >
      {state === "done" ? (
        <HugeiconsIcon icon={Tick02Icon} size={15} strokeWidth={2.4} />
      ) : state === "blocked" ? (
        <HugeiconsIcon icon={Alert01Icon} size={15} strokeWidth={2.2} />
      ) : (
        index + 1
      )}
    </span>
  )
}

/** Screen-reader equivalent of what the marker's colour and glyph convey. */
const stateLabel = {
  done: "Done",
  current: "In progress",
  upcoming: "Not started",
  blocked: "Blocked",
} as const satisfies Record<StepState, string>

/**
 * The coach's own onboarding, mirrored for the admin (ADR 0004). It answers the
 * question a pending row provokes — "what is the coach actually doing right
 * now, and what is left" — which no single status line can.
 *
 * The connecting rail is drawn between markers rather than around them, so the
 * list reads as one progression instead of three unrelated cards.
 */
export function OnboardingStepsSection({ workspace }: { readonly workspace: WorkspaceDetail }) {
  const steps = onboardingSteps(workspace)

  return (
    <Section aria-labelledby="next-heading">
      <SectionTitle id="next-heading">What happens next</SectionTitle>
      <Card size="sm" className="mt-4">
        <CardContent>
          <ol className="flex flex-col">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <StepMarker state={step.state} index={index} />
                  {index === steps.length - 1 ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "w-px flex-1",
                        step.state === "done" ? "bg-emerald-400/30" : "bg-border",
                      )}
                    />
                  )}
                </div>
                <div className={cn("min-w-0 pb-5", index === steps.length - 1 && "pb-0")}>
                  <p
                    className={cn(
                      "text-body font-semibold",
                      step.state === "upcoming" && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                    <span className="sr-only"> — {stateLabel[step.state]}</span>
                  </p>
                  <p className="text-muted-foreground mt-1 text-footnote leading-[18px]">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </Section>
  )
}
