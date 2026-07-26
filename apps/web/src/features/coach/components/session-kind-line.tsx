import { Calendar03Icon, FlagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { cn } from "@/lib/utils.ts"

/**
 * What a session *is*, in one line: the kind with its glyph, then how long it
 * runs.
 *
 * One component rather than the same ternary on four screens (#61). Kind is a
 * word with a glyph and **no colour of its own**: amber, rose and emerald
 * already mean invitation and session *state*, and a second colour vocabulary
 * makes both harder to read — which is precisely the rule a copy-pasted ternary
 * eventually breaks in one place and not the others.
 */
export function SessionKindLine({
  copy,
  kind,
  durationMinutes,
  className,
}: {
  readonly copy: ClientsCopy
  readonly kind: string
  readonly durationMinutes: number
  readonly className?: string
}) {
  return (
    <span className={cn("text-muted-foreground flex items-center gap-1.5 text-xs", className)}>
      <HugeiconsIcon
        icon={kind === "intake" ? FlagIcon : Calendar03Icon}
        size={14}
        strokeWidth={2}
      />
      {kind === "intake" ? copy.kindIntake : copy.kindRegular}
      {" · "}
      <span className="tabular-nums">
        {durationMinutes}
        {copy.durationSuffix}
      </span>
    </span>
  )
}
