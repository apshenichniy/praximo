import type { CoachLanguage } from "@praximo/domain"
import { DefaultTimeZone, sessionMoment } from "@praximo/i18n"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { CoachBadge } from "@/features/invite/coach-badge.tsx"
import type { SessionSummary } from "@/features/invite/session-summary.ts"
import type { WebRefusal } from "@/features/invite/web-refusal.ts"

/**
 * Everything this page shows that is not the form (#57): the confirmation, and
 * the four ways a link fails to open a door.
 *
 * All of them **drop the two-column frame**. It exists to keep the consent
 * beside the fields the client is filling in; around one sentence it is only a
 * long line to read across and a scroll position to wonder about.
 */

export function ConfirmationScreen({
  locale,
  coachName,
  email,
  session,
  coachTimezone,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  readonly email: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
}) {
  const copy = inviteCopy(locale)
  const moment =
    session === undefined
      ? undefined
      : sessionMoment(locale, new Date(session.scheduledAt), coachTimezone ?? DefaultTimeZone)

  return (
    <Centred>
      <CoachBadge locale={locale} coachName={coachName} />
      <b className="text-2xl font-[640] tracking-[-0.025em]">{copy.done.title}</b>
      {moment === undefined || session === undefined ? (
        <p className="text-muted-foreground text-[15px] leading-[1.65]">
          {copy.done.withoutSession(coachName)}
        </p>
      ) : (
        <p className="text-muted-foreground text-[15px] leading-[1.65]">
          {`${session.kind === "intake" ? copy.greeting.intake : copy.greeting.session}: ${moment.day}, ${moment.time} (${moment.offset}).`}
        </p>
      )}
      {/*
       * The address echoed back — the whole of the email verification in MVP.
       * Not double entry, which people defeat with paste, and not a magic link,
       * which would make acceptance two-legged and destroy the atomicity the
       * design is built on. A typo is catchable while the client is still here.
       */}
      <span className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-3 py-[5px] text-[12.5px] font-medium">
        {copy.done.remindersTo(email)}
      </span>
      <p className="text-muted-foreground text-xs leading-[1.45]">{copy.done.wrongAddress}</p>
    </Centred>
  )
}

/** The refusal union plus the one outcome that has no invitation behind it. */
export type NoticeKind = WebRefusal | "unknown"

/**
 * What each refusal shows, in one table rather than a cascade.
 *
 * `settled` marks the one that is not an error at all — the client scrolled up
 * and opened the link again — and gets the tick. `names` marks the two that say
 * who to ask, and is what puts the coach in the frame: their sentences cannot
 * carry the name in ru or uk without declining it, which
 * `docs/agents/product-copy.md` forbids.
 */
const NOTICES: Record<
  NoticeKind,
  {
    readonly read: (
      copy: ReturnType<typeof inviteCopy>["refusal"],
      coach: string,
    ) => {
      readonly title: string
      readonly body: string
    }
    readonly settled: boolean
    readonly names: boolean
  }
> = {
  "already-accepted": {
    // Says so, offers nothing to press, and discloses **no session details**:
    // the token is spent, and turning a forwarded invitation into a permanent
    // read-only view of somebody's schedule is not a trade worth making.
    read: (copy) => copy.alreadyAccepted,
    settled: true,
    names: false,
  },
  superseded: {
    read: (copy, coach) => ({ title: copy.superseded.title, body: copy.superseded.body(coach) }),
    settled: false,
    names: true,
  },
  expired: {
    read: (copy, coach) => ({ title: copy.expired.title, body: copy.expired.body(coach) }),
    settled: false,
    names: true,
  },
  // Names nobody and admits nothing. A typo and a token-guessing script get the
  // same page, so neither learns whether the code exists or whose it is.
  unknown: { read: (copy) => copy.unknown, settled: false, names: false },
}

export function RefusalScreen({
  locale,
  kind,
  coachName,
}: {
  readonly locale: CoachLanguage
  readonly kind: NoticeKind
  /** Absent for `unknown`, and absent by construction — there is no invitation. */
  readonly coachName?: string
}) {
  const notice = NOTICES[kind]
  const { title, body } = notice.read(inviteCopy(locale).refusal, coachName ?? "")
  const named = notice.names && coachName !== undefined

  return (
    <Centred>
      {named ? <CoachBadge locale={locale} coachName={coachName} withName /> : null}
      {notice.settled ? (
        <span className="bg-success-surface text-success grid size-[52px] place-items-center rounded-full text-[22px] font-bold">
          ✓
        </span>
      ) : null}
      <b className="text-[22px] font-[640] tracking-[-0.02em]">{title}</b>
      <p className="text-muted-foreground text-[15px] leading-[1.65]">{body}</p>
    </Centred>
  )
}

function Centred({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8">
      <div className="grid max-w-[44ch] justify-items-center gap-4 text-center">{children}</div>
    </div>
  )
}
