import type { CoachLanguage } from "@praximo/domain"
import { PersonAvatar } from "@praximo/ui/custom/person-avatar"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"

/**
 * The coach, as this page shows them: their photo on a ringed disc where the
 * platform has one, their initials where it does not.
 *
 * **Initials are not a placeholder.** Plenty of coaches will have no Telegram photo,
 * or will have hidden it from bots, so the fallback is an ordinary outcome and is what
 * #57 shipped. What the photo adds when there *is* one is the whole reason #225
 * captured it: this page reads as a continuation of the conversation the client has
 * been having with their coach rather than a stranger's consent wall.
 *
 * `photoSrc` is an address rather than the image itself, and it is the invitation's
 * own — `/i/<token>/coach-avatar`, resolved server-side. No object key reaches this
 * component, and a plain `<img>` works because the route authorises on the token
 * already in the URL (#231).
 *
 * `withName` exists for the refusals that say who to ask. Those sentences do not
 * contain the name in ru or uk — «попросите у …» takes the genitive, and
 * `docs/agents/product-copy.md` forbids declining an operator-entered string —
 * so the screen owes the name in a nominative slot instead, and this is it.
 */
export function CoachBadge({
  locale,
  coachName,
  photoSrc,
  withName = false,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  /** Absent when there is no photo to serve, which is most of the time. */
  readonly photoSrc?: string
  readonly withName?: boolean
}) {
  const disc = (
    <PersonAvatar
      name={coachName}
      {...(photoSrc === undefined ? {} : { photoSrc })}
      className="ring-background outline-primary/45 size-[60px] ring-[3px] outline-[1.5px]"
      fallbackClassName="bg-secondary text-secondary-foreground text-xl font-[620]"
    />
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
