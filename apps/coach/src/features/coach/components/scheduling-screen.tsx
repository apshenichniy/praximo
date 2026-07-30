import { type CoachLanguage, defaultDurationForKind, type SessionKind } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Heading } from "@praximo/ui"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { clock } from "@/features/coach/clock.ts"
import { dayView, type DayScheduleData } from "@/features/coach/day-view.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { HostBackButton, HostMainButton } from "@/presentation-host"
import { selectionHaptic } from "@/presentation-host"
import { calendarDate, DateField } from "@/features/coach/components/scheduling/date-field.tsx"
import { SchedulingFootnote } from "@/features/coach/components/scheduling/footnote.tsx"
import { SessionControls } from "@/features/coach/components/scheduling/session-controls.tsx"
import { TimeField } from "@/features/coach/components/scheduling/time-field.tsx"

export { calendarDate }

export interface SchedulingDraft {
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
  readonly kind: SessionKind
}

/**
 * Date, first-session override, duration, and time for a new Session.
 *
 * The screen owns the booking draft. Extracted pieces own only self-contained
 * presentation state: the strip/month choreography and reveal rendering.
 */
export function SchedulingScreen({
  copy,
  backLabel,
  language,
  clientName,
  firstSession,
  bookedDates,
  schedule,
  onDateChange,
  onDaysVisible,
  onSubmit,
  pending,
  error,
}: {
  readonly copy: ClientsCopy
  readonly backLabel: string
  readonly language: CoachLanguage
  readonly clientName: string
  /** Whether this client has no Sessions in Praximo yet. */
  readonly firstSession: boolean
  /** `YYYY-MM-DD` for days that already carry a Session with this client. */
  readonly bookedDates: ReadonlyArray<string>
  readonly schedule: DayScheduleData | undefined
  readonly onDateChange: (date: string) => void
  readonly onDaysVisible: (from: string, days: number) => void
  readonly onSubmit: (draft: SchedulingDraft) => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const today = useMemo(() => new Date(), [])
  const openingKind: SessionKind = firstSession ? "intake" : "regular"
  const [kind, setKind] = useState<SessionKind>(openingKind)
  const [durationTouched, setDurationTouched] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState<number>(
    defaultDurationForKind(openingKind),
  )
  const [selectedDay, setSelectedDay] = useState<Date>(today)
  const [startMinutes, setStartMinutes] = useState<number>()
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
    onSubmit({ date, startMinutes, durationMinutes, kind })
  }, [date, durationMinutes, kind, onSubmit, startMinutes])

  useLayoutEffect(() => {
    if (schedule === undefined) return
    const node = timeRef.current
    if (node !== null) lastTimeHeight.current = node.offsetHeight
  }, [durationMinutes, schedule])

  const label =
    startMinutes === undefined
      ? copy.pickTime
      : `${copy.scheduleSubmit} · ${shortDayFormat.format(selectedDay)}, ${clock(startMinutes)}`

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <HostBackButton label={backLabel} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.sheetTitle}
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

        <SessionControls
          copy={copy}
          firstSession={firstSession}
          kind={kind}
          durationMinutes={durationMinutes}
          onFirstSessionChange={toggleFirstSession}
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
