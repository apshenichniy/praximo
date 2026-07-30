import { type CoachLanguage, defaultDurationForKind, type SessionKind } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Heading } from "@praximo/ui"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { clock } from "@/features/coach/clock.ts"
import { dayView, type DayScheduleData } from "@/features/coach/day-view.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { HostBackButton, HostMainButton } from "@/mini-app.tsx"
import { selectionHaptic } from "@/mini-app.tsx"
import { calendarDate, DateField } from "@/features/coach/components/scheduling/date-field.tsx"
import { SchedulingFootnote } from "@/features/coach/components/scheduling/footnote.tsx"
import { SessionControls } from "@/features/coach/components/scheduling/session-controls.tsx"
import { TimeField } from "@/features/coach/components/scheduling/time-field.tsx"

export { calendarDate }

/**
 * A `YYYY-MM-DD` back as the local `Date` the calendar works in.
 *
 * Parsed by parts rather than by `new Date(string)`, which reads a bare date as
 * UTC midnight and lands the day before wherever the offset is negative. An
 * unreadable value falls back to today: the coach is choosing a new day anyway,
 * and an `Invalid Date` would take the whole screen down.
 */
const dayOf = (date: string, fallback: Date): Date => {
  const [year, month, day] = date.split("-").map(Number)
  if (year === undefined || month === undefined || day === undefined) return fallback
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

/** When a session is being put — the whole of what this screen decides. */
export interface SchedulingDraft {
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
}

/** A booking also decides the kind; a move never does. */
export interface NewSessionDraft extends SchedulingDraft {
  readonly kind: SessionKind
}

/**
 * What this screen is for, as one prop rather than as a handful of flags (#62).
 *
 * A discriminated union because the two errands disagree about three things at
 * once — whether the intake switch means anything, whether there is a slot to
 * open on, and what the submit produces — and three independent booleans would
 * make «a reschedule that is also a first session» a state somebody has to
 * remember is nonsense. Here it does not typecheck.
 */
export type SchedulingPurpose =
  | {
      readonly kind: "new"
      /**
       * Whether this client has no Sessions in Praximo yet, which turns the
       * intake switch on and is the only thing that ever does so on the coach's
       * behalf.
       */
      readonly firstSession: boolean
      readonly onSubmit: (draft: NewSessionDraft) => void
    }
  | {
      readonly kind: "reschedule"
      /**
       * Where the session is now. `startMinutes` is absent when that start is no
       * longer offerable — a session in the past, which nothing writes a
       * terminal state for before #42.
       */
      readonly from: {
        readonly date: string
        readonly startMinutes?: number
        readonly durationMinutes: number
      }
      readonly onSubmit: (draft: SchedulingDraft) => void
    }

/**
 * Date, first-session override, duration, and time — for a new Session, or for
 * one being moved (#62).
 *
 * The screen owns the draft. Extracted pieces own only self-contained
 * presentation state: the strip/month choreography and reveal rendering.
 */
export function SchedulingScreen({
  copy,
  backLabel,
  language,
  clientName,
  purpose,
  bookedDates,
  schedule,
  onDateChange,
  onDaysVisible,
  pending,
  error,
}: {
  readonly copy: ClientsCopy
  readonly backLabel: string
  readonly language: CoachLanguage
  readonly clientName: string
  readonly purpose: SchedulingPurpose
  /** `YYYY-MM-DD` for days that already carry a Session with this client. */
  readonly bookedDates: ReadonlyArray<string>
  readonly schedule: DayScheduleData | undefined
  readonly onDateChange: (date: string) => void
  readonly onDaysVisible: (from: string, days: number) => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const moving = purpose.kind === "reschedule" ? purpose.from : undefined
  const today = useMemo(() => new Date(), [])
  const openingKind: SessionKind =
    purpose.kind === "new" && purpose.firstSession ? "intake" : "regular"
  const [kind, setKind] = useState<SessionKind>(openingKind)
  // A move opens on the length the session already has, so the chips are
  // already the coach's answer rather than a default about to overwrite it.
  const [durationTouched, setDurationTouched] = useState(moving !== undefined)
  const [durationMinutes, setDurationMinutes] = useState<number>(
    moving?.durationMinutes ?? defaultDurationForKind(openingKind),
  )
  const [selectedDay, setSelectedDay] = useState<Date>(() =>
    moving === undefined ? today : dayOf(moving.date, today),
  )
  const [startMinutes, setStartMinutes] = useState<number | undefined>(moving?.startMinutes)
  /**
   * Kept across day changes: a coach looking outside their hours is usually
   * looking across more than one day. The keyed screen resets it per booking.
   */
  const [revealed, setRevealed] = useState({ earlier: false, later: false })
  const timeRef = useRef<HTMLDivElement>(null)
  /** The last painted grid height, held while the next day loads. */
  const lastTimeHeight = useRef<number>(undefined)

  const date = calendarDate(selectedDay)
  const view = useMemo(
    () =>
      dayView({
        schedule,
        durationMinutes,
        date: selectedDay,
        startMinutes,
        language,
        copy,
      }),
    [copy, durationMinutes, language, schedule, selectedDay, startMinutes],
  )
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(language), {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    [language],
  )
  const shortDayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(language), {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    [language],
  )

  const toggleFirstSession = useCallback(
    (checked: boolean) => {
      const next: SessionKind = checked ? "intake" : "regular"
      setKind(next)
      if (durationTouched) return
      setDurationMinutes(defaultDurationForKind(next))
      setStartMinutes(undefined)
    },
    [durationTouched],
  )

  const chooseDuration = useCallback(
    (minutes: number) => {
      if (minutes !== durationMinutes) selectionHaptic()
      setDurationTouched(true)
      setDurationMinutes(minutes)
      // A start legal for 30 minutes may overlap at 60, so ask again.
      setStartMinutes(undefined)
    },
    [durationMinutes],
  )

  const chooseDay = useCallback(
    (day: Date | undefined) => {
      if (day === undefined) return
      setSelectedDay(day)
      setStartMinutes(undefined)
      onDateChange(calendarDate(day))
    },
    [onDateChange],
  )

  const pickSlot = useCallback((minutes: number) => setStartMinutes(minutes), [])

  const submit = useCallback(() => {
    if (startMinutes === undefined) return
    const draft = { date, startMinutes, durationMinutes }
    if (purpose.kind === "new") purpose.onSubmit({ ...draft, kind })
    else purpose.onSubmit(draft)
  }, [date, durationMinutes, kind, purpose, startMinutes])

  useLayoutEffect(() => {
    if (schedule === undefined) return
    const node = timeRef.current
    if (node !== null) lastTimeHeight.current = node.offsetHeight
  }, [durationMinutes, schedule])

  const submitWord = moving === undefined ? copy.scheduleSubmit : copy.rescheduleSubmit
  const label =
    startMinutes === undefined
      ? copy.pickTime
      : `${submitWord} · ${shortDayFormat.format(selectedDay)}, ${clock(startMinutes)}`

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <HostBackButton label={backLabel} />

      <Heading as="h1" role="page-title" className="mt-2">
        {moving === undefined ? copy.sheetTitle : copy.rescheduleTitle}
      </Heading>

      <div className="mt-6">
        <DateField
          copy={copy}
          language={language}
          today={today}
          selectedDay={selectedDay}
          bookedDates={bookedDates}
          shortDayFormat={shortDayFormat}
          scrollTargetRef={timeRef}
          onSelectDay={chooseDay}
          onDaysVisible={onDaysVisible}
        />

        {/*
          A move never asks about the kind: whether this is a client's first
          session is a fact about their history, not about the slot it is being
          put in, and the session keeps the kind it already has.
        */}
        <SessionControls
          copy={copy}
          {...(purpose.kind === "new"
            ? {
                firstSession: purpose.firstSession,
                kind,
                onFirstSessionChange: toggleFirstSession,
              }
            : {})}
          durationMinutes={durationMinutes}
          onDurationChange={chooseDuration}
        />

        <TimeField
          copy={copy}
          view={view}
          loaded={schedule !== undefined}
          selected={startMinutes}
          day={dayFormat.format(selectedDay)}
          revealed={revealed}
          minimumHeight={lastTimeHeight.current}
          timeRef={timeRef}
          onPick={pickSlot}
          onRevealEarlier={(open) => setRevealed((was) => ({ ...was, earlier: open }))}
          onRevealLater={(open) => setRevealed((was) => ({ ...was, later: open }))}
          onNextDay={() => {
            const next = new Date(selectedDay)
            next.setDate(next.getDate() + 1)
            chooseDay(next)
          }}
        />

        <SchedulingFootnote
          copy={copy}
          clientName={clientName}
          offsetLabel={view.offsetLabel}
          startMinutes={startMinutes}
          kind={kind}
        />

        {error === undefined ? null : (
          <p className="text-destructive animate-in fade-in slide-in-from-bottom-1 mt-3 text-base leading-relaxed leading-5 duration-150">
            {error}
          </p>
        )}
      </div>

      <HostMainButton
        text={label}
        onClick={submit}
        fallback={
          <ActionBar>
            <Button
              className="w-full"
              disabled={startMinutes === undefined || pending}
              onClick={submit}
            >
              {label}
            </Button>
          </ActionBar>
        }
      />
    </main>
  )
}
