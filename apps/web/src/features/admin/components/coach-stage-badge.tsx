import { Badge } from "@/components/ui/badge.tsx"
import type { AdminSurface } from "@/server/admin-surface.ts"
import { cn } from "@/lib/utils.ts"

type Stage = AdminSurface.CoachOnboardingStage

/**
 * Three tones carry the whole lifecycle: amber for something the admin can
 * still push forward, sky for progress that is now the coach's move, and a
 * muted neutral for terminal history. `expired` is amber rather than red — a
 * lapsed invite is routine and fixed by reissuing, not a failure.
 */
const stageTone = {
  invited: { badge: "bg-amber-400/12 text-amber-300 ring-amber-400/20", dot: "bg-amber-300" },
  accepted: { badge: "bg-sky-400/12 text-sky-300 ring-sky-400/20", dot: "bg-sky-300" },
  stalled: { badge: "bg-amber-400/12 text-amber-300 ring-amber-400/20", dot: "bg-amber-300" },
  "bot-connected": { badge: "bg-sky-400/12 text-sky-300 ring-sky-400/20", dot: "bg-sky-300" },
  expired: { badge: "bg-amber-400/12 text-amber-300 ring-amber-400/20", dot: "bg-amber-300" },
  declined: { badge: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
  reset: { badge: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
  "not-invited": {
    badge: "bg-muted text-muted-foreground ring-border",
    dot: "bg-muted-foreground/60",
  },
} as const satisfies Record<Stage, { badge: string; dot: string }>

const stageLabel = {
  invited: "Invited",
  accepted: "Accepted",
  stalled: "Setup stalled",
  "bot-connected": "Awaiting activation",
  expired: "Invite expired",
  declined: "Declined",
  reset: "Reset",
  "not-invited": "No invite",
} as const satisfies Record<Stage, string>

export function CoachStageBadge({ stage }: { readonly stage: Stage }) {
  const tone = stageTone[stage]
  return (
    <Badge className={cn("border-transparent ring-1", tone.badge)}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      {stageLabel[stage]}
    </Badge>
  )
}
