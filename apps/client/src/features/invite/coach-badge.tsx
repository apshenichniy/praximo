import type { CoachLanguage } from "@praximo/domain"
import { Avatar, AvatarFallback } from "@praximo/ui/components/avatar"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { initials } from "@/features/invite/initials.ts"

/**
 * The coach, as this page shows them: initials on a ringed disc, optionally
 * with their name underneath.
 *
 * Initials rather than a photo, and not as a placeholder — #57 touches R2 zero
 * times. The coach's Telegram photo is #225 and Google's picture is #59; here
 * this *is* the design.
 *
 * `withName` exists for the refusals that say who to ask. Those sentences do not
 * contain the name in ru or uk — «попросите у …» takes the genitive, and
 * `docs/agents/product-copy.md` forbids declining an operator-entered string —
 * so the screen owes the name in a nominative slot instead, and this is it.
 */
export function CoachBadge({
  locale,
  coachName,
  withName = false,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  readonly withName?: boolean
}) {
  const disc = (
    <Avatar className="ring-background outline-primary/45 size-[60px] ring-[3px] outline-[1.5px]">
      <AvatarFallback className="bg-secondary text-secondary-foreground text-xl font-[620]">
        {initials(coachName)}
      </AvatarFallback>
    </Avatar>
  )

  if (!withName) return disc

  return (
    <div className="grid justify-items-center gap-2">
      {disc}
      <span className="grid justify-items-center gap-0.5">
        <span className="text-muted-foreground text-xs">
          {inviteCopy(locale).refusal.yourCoach}
        </span>
        {/* Nominative, and only ever nominative — it is a label's value, not part
            of a sentence, so no case agreement is asked of it. */}
        <b className="text-[15px] font-[620] tracking-[-0.01em]">{coachName}</b>
      </span>
    </div>
  )
}
