import {
  type BusyInterval,
  type CoachLanguage,
  daySlots,
  defaultDurationForKind,
  freeSlotCounts,
  type PartOfDay,
  partOfDay,
  PartsOfDay,
  PlannedDurations,
  type SessionKind,
} from "@praximo/domain"
import { localeTag, sessionMoment } from "@praximo/i18n"
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { TelegramBackButton } from "@/components/telegram-back-button.tsx"
import { Button } from "@/components/ui/button.tsx"
import { Calendar } from "@/components/ui/calendar.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"
import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import { DayStrip } from "@/features/coach/components/day-strip.tsx"
import { extendStrip, sameDay, StripDays, stripWindow } from "@/features/coach/day-strip.ts"
import { calendarLocale } from "@/features/i18n/calendar-locale.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { cn } from "@/lib/utils.ts"

/**
 * The scheduling screen (#56 §Scheduling), in the order the ticket fixes:
 * **kind, date, duration, time**.
 *
 * Duration sits above time deliberately. Overlaps are forbidden, so a start is
 * only legal in combination with a length — 10:45 is free for 30 minutes and
 * taken for 60 when 11:00 is booked. Asking for the time first produces a choice
 * a later tap invalidates; asked in this order, the grid never offers what will
 * not fit.
 *
 * A screen rather than the drawer it was until #186. The form is a full screen's
 * worth of choices inside a scrolling body, which put "drag to reach the slots"
 * and "drag to dismiss" on the same gesture — and a dismissal threw the draft
 * away. On a route the flow gets the one back the rest of the app has, and the
 * draft survives everything except leaving it deliberately.
 */

export interface DayScheduleData {
  readonly busy: ReadonlyArray<BusyInterval>
  readonly earliestStartMinutes?: number
  readonly timezone: string
}

export interface SchedulingDraft {
  readonly date: string
  readonly startMinutes: number
  readonly durationMinutes: number
  readonly kind: SessionKind
}

const pad = (value: number): string => String(value).padStart(2, "0")

/** `YYYY-MM-DD` for a day the calendar hands back as a local `Date`. */
export const calendarDate = (day: Date): string =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`

const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

/**
 * The browser's own instant for a day and a minute of it. Good enough for
 * *reading* an offset — a zone's offset does not change within a day — while
 * the instant that gets stored is computed on the server, in the coach's zone.
 */
const instantAt = (day: Date, minutes: number): Date => {
  const at = new Date(day)
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return at
}

const partLabel = (copy: ClientsCopy, part: PartOfDay): string =>
  part === "morning" ? copy.morning : part === "afternoon" ? copy.afternoon : copy.evening

export function SchedulingScreen({
  copy,
  backLabel,
  language,
  clientName,
  firstSession,
  bookedDates,
  schedule,
  onDateChange,
  onSubmit,
  pending,
  error,
}: {
  readonly copy: ClientsCopy
  /** The one word on the host's back button, in the coach's language. */
  readonly backLabel: string
  readonly language: CoachLanguage
  readonly clientName: string
  /** Pre-selects `intake`: a client's first session usually is one, but never must be. */
  readonly firstSession: boolean
  /**
   * `YYYY-MM-DD` for every day that already carries a session **with this
   * client** — a dot on the month (#61).
   *
   * A coach booking a month ahead is placing a *rhythm* — every Monday, every
   * second Thursday — and the dot is what makes that rhythm visible while it is
   * being placed. It is also what stops the classic double booking of one
   * Tuesday. Free from a read both entrances already make.
   */
  readonly bookedDates: ReadonlyArray<string>
  /** The day being looked at, loaded by the screen when the date changes. */
  readonly schedule: DayScheduleData | undefined
  /** The screen owns the fetch, so a new day has to travel back out. */
  readonly onDateChange: (date: string) => void
  readonly onSubmit: (draft: SchedulingDraft) => void
  readonly pending: boolean
  readonly error: string | undefined
}) {
  const today = useMemo(() => new Date(), [])
  const [kind, setKind] = useState<SessionKind>(firstSession ? "intake" : "regular")
  const [durationTouched, setDurationTouched] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState<number>(
    defaultDurationForKind(firstSession ? "intake" : "regular"),
  )
  const [selectedDay, setSelectedDay] = useState<Date>(today)
  const [stripLength, setStripLength] = useState(StripDays)
  /**
   * Bumped whenever the date comes from the month rather than from the strip.
   * The strip's scroll position is its own — no state change accompanies
   * «Today» pressed on the day that is already chosen — so the ask is explicit.
   */
  const [centreRequest, setCentreRequest] = useState(0)
  /** The month under the thumb, which is not always the chosen day's month. */
  const [visibleMonth, setVisibleMonth] = useState<Date>(today)
  const [monthOpen, setMonthOpen] = useState(false)
  const [startMinutes, setStartMinutes] = useState<number>()
  const groupRefs = useRef(new Map<PartOfDay, HTMLDivElement>())
  const timeRef = useRef<HTMLDivElement>(null)
  /**
   * How tall the time field was the last time it held a grid. A day change
   * empties it for as long as the fetch takes, and a section that collapses to
   * a spinner and grows back is the layout jump this screen is being cured of.
   */
  const lastTimeHeight = useRef<number>(undefined)
  /** Set when the month collapses on a pick, so the scroll waits for it. */
  const scrollAfterMonth = useRef(false)

  const date = calendarDate(selectedDay)
  const booked = useMemo(() => new Set(bookedDates), [bookedDates])
  const days = useMemo(
    () => stripWindow(today, selectedDay, stripLength),
    [today, selectedDay, stripLength],
  )

  /**
   * The default follows the kind — intake 30, regular 60 — and stops following
   * the moment the coach touches the chips themselves.
   */
  const chooseKind = useCallback(
    (next: SessionKind) => {
      setKind(next)
      if (!durationTouched) setDurationMinutes(defaultDurationForKind(next))
      setStartMinutes(undefined)
    },
    [durationTouched],
  )

  const chooseDuration = useCallback((minutes: number) => {
    setDurationTouched(true)
    setDurationMinutes(minutes)
    // A start that fitted at 30 minutes may not at 60. Rather than silently
    // keeping an illegal choice, the time is asked again — which is the whole
    // reason duration is asked first.
    setStartMinutes(undefined)
  }, [])

  const chooseDay = useCallback(
    (day: Date | undefined) => {
      if (day === undefined) return
      setSelectedDay(day)
      setStartMinutes(undefined)
      onDateChange(calendarDate(day))
    },
    [onDateChange],
  )

  /**
   * A day taken from the month, which then folds away. That fold is the one
   * large height change left on this screen, so the time field is scrolled to
   * once it has finished — the coach asked for a date and what they want next
   * is the times on it.
   */
  const chooseMonthDay = useCallback(
    (day: Date | undefined) => {
      if (day === undefined) return
      chooseDay(day)
      // The window re-anchors on the day just chosen, so the fortnight it grew
      // scrolling forward is not a fortnight *behind* where the strip now opens.
      setStripLength(StripDays)
      setVisibleMonth(day)
      setCentreRequest((count) => count + 1)
      setMonthOpen(false)
      scrollAfterMonth.current = true
    },
    [chooseDay],
  )

  /** The strip reports every frame it scrolls; only a new month is a change. */
  const noteVisibleMonth = useCallback((day: Date) => {
    setVisibleMonth((current) =>
      current.getFullYear() === day.getFullYear() && current.getMonth() === day.getMonth()
        ? current
        : day,
    )
  }, [])

  const revealTime = useCallback(() => {
    if (!scrollAfterMonth.current) return
    scrollAfterMonth.current = false
    timeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const slots = useMemo(
    () =>
      schedule === undefined
        ? []
        : daySlots({
            durationMinutes,
            busy: schedule.busy,
            ...(schedule.earliestStartMinutes === undefined
              ? {}
              : { earliestStartMinutes: schedule.earliestStartMinutes }),
          }),
    [durationMinutes, schedule],
  )

  const counts = useMemo(() => freeSlotCounts(slots), [slots])
  const present = useMemo(
    () => PartsOfDay.filter((part) => slots.some((slot) => partOfDay(slot.startMinutes) === part)),
    [slots],
  )
  /**
   * Whether the day has anything at all. A part of day whose every start is
   * taken keeps its group and its "0 free" anchor — the list must not change
   * height between days — but a *day* with nothing left is a dead end, and a
   * dead end gets an exit rather than a wall of unpressable buttons.
   */
  const anyFree = useMemo(() => slots.some((slot) => slot.available), [slots])

  /**
   * The height of the grid, measured with it on screen and before the next day
   * empties it. Layout rather than effect: the number has to be the one the
   * browser just painted, not the one it paints after the section has already
   * collapsed.
   */
  useLayoutEffect(() => {
    if (schedule === undefined) return
    const node = timeRef.current
    if (node !== null) lastTimeHeight.current = node.offsetHeight
  }, [schedule, slots])

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(language), {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    [language],
  )
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { month: "long" }),
    [language],
  )

  const submit = useCallback(() => {
    if (startMinutes === undefined) return
    onSubmit({ date, startMinutes, durationMinutes, kind })
  }, [date, durationMinutes, kind, onSubmit, startMinutes])

  /**
   * A second booking starts where a coach expects it to, not where they left
   * the first one. The screen is mounted per client — the route keys it on the
   * one in the URL — so that reset is the mount itself rather than an effect
   * watching a sheet's `open` flag, which used to have to re-derive every field.
   */
  const scrollTo = (part: PartOfDay) => {
    groupRefs.current.get(part)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  /**
   * The footnote names the coach's zone as the *client* will read it — `UTC+3`,
   * computed on the session's own date. `Europe/Kyiv` is an identifier, not
   * something anybody can act on, and this line is the only place the app can
   * state whose clock this is before the time reaches a stranger.
   */
  const offset = useMemo(() => {
    const zone = schedule?.timezone
    if (zone === undefined) return ""
    const at = instantAt(selectedDay, startMinutes ?? 12 * 60)
    return sessionMoment(language, at, zone).offset
  }, [language, schedule, selectedDay, startMinutes])

  const label =
    startMinutes === undefined
      ? copy.pickTime
      : `${copy.scheduleSubmit} · ${dayFormat.format(selectedDay)}, ${clock(startMinutes)}`

  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-28">
      <TelegramBackButton label={backLabel} />

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.sheetTitle}</h1>

      <div className="mt-6">
        <Field label={copy.kindLabel}>
          <div className="bg-muted flex gap-1 rounded-xl p-1">
            {(["intake", "regular"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => chooseKind(option)}
                className={cn(
                  "flex-1 rounded-lg py-2 text-sm font-semibold transition-colors",
                  kind === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {option === "intake" ? copy.kindIntake : copy.kindRegular}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label={copy.dateLabel}
          // Keyed on the month so the label crossfades when the strip crosses
          // into the next one — a number changing under the thumb is easy to
          // miss, and July 31 to August 1 is exactly where it matters.
          trailing={
            <span
              key={monthFormat.format(visibleMonth)}
              className="animate-in fade-in slide-in-from-bottom-1 text-muted-foreground text-[10px] font-semibold tracking-widest uppercase duration-200"
            >
              {monthFormat.format(visibleMonth)}
            </span>
          }
        >
          <DayStrip
            days={days}
            selected={selectedDay}
            today={today}
            isBooked={(day) => booked.has(calendarDate(day))}
            language={language}
            monthLabel={copy.monthLabel}
            onPick={chooseDay}
            onExtend={() => setStripLength(extendStrip)}
            onOpenMonth={() => setMonthOpen(true)}
            onVisibleMonth={noteVisibleMonth}
            centreRequest={centreRequest}
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">
              {sameDay(selectedDay, today)
                ? `${copy.today}, ${dayFormat.format(selectedDay)}`
                : dayFormat.format(selectedDay)}
            </span>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={monthOpen}
              onClick={() => setMonthOpen((open) => !open)}
            >
              {copy.monthLabel}
            </Button>
          </div>

          {/*
            Rows rather than height: `0fr → 1fr` animates a box whose content is
            300px of month without anybody having to measure it, and the grid
            keeps that content laid out at its real width while it is closed.
          */}
          <div
            onTransitionEnd={revealTime}
            className={cn(
              "ease-out-strong grid transition-[grid-template-rows] duration-250 motion-reduce:transition-none",
              monthOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <div className="border-border overflow-hidden rounded-2xl border">
                <Calendar
                  mode="single"
                  required={false}
                  selected={selectedDay}
                  onSelect={chooseMonthDay}
                  disabled={{ before: today }}
                  startMonth={today}
                  // A day this client already has a session on, marked rather
                  // than blocked: two sessions on one day is a legitimate thing
                  // to book, and the dot is there so it is never an accident.
                  modifiers={{ booked: (day) => booked.has(calendarDate(day)) }}
                  modifiersClassNames={{
                    booked:
                      "after:bg-primary after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:content-['']",
                  }}
                  // Weekday and month names in the coach's language, like every
                  // other word on the screen — and the picker's own aria labels
                  // with them. A bare `{ code }` is not a locale and left all
                  // three in English (#56's defect, found walking #61).
                  locale={calendarLocale(language)}
                  className="w-full bg-transparent"
                />
                <div className="border-border flex items-center gap-3 border-t px-4 py-3">
                  <Button size="sm" variant="outline" onClick={() => chooseMonthDay(today)}>
                    {copy.today}
                  </Button>
                  <span className="text-muted-foreground text-xs">{dayFormat.format(today)}</span>
                </div>
              </div>
            </div>
          </div>
        </Field>

        <Field label={copy.durationLabel}>
          <div className="flex gap-2">
            {PlannedDurations.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={durationMinutes === minutes}
                onClick={() => chooseDuration(minutes)}
                className={cn(
                  "flex-1 rounded-full border py-2 text-sm font-semibold tabular-nums transition-colors",
                  durationMinutes === minutes
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "border-border text-muted-foreground",
                )}
              >
                {minutes}
                {copy.durationSuffix}
              </button>
            ))}
          </div>
        </Field>

        <Field label={copy.timeLabel}>
          <div
            ref={timeRef}
            className="flex scroll-mt-(--mini-app-safe-top,0px) flex-col gap-2"
            // Held at the height it had a moment ago while the next day loads.
            // Without it the section shrinks to a spinner and grows back, which
            // reads as the screen jumping under a thumb that only picked a day.
            style={
              schedule === undefined && lastTimeHeight.current !== undefined
                ? { minHeight: lastTimeHeight.current }
                : undefined
            }
          >
            {schedule === undefined ? (
              <SlotSkeleton />
            ) : !anyFree ? (
              <EmptyDay
                copy={copy}
                day={dayFormat.format(selectedDay)}
                onNextDay={() => {
                  const next = new Date(selectedDay)
                  next.setDate(next.getDate() + 1)
                  chooseDay(next)
                }}
              />
            ) : (
              <>
                <div className="flex gap-1">
                  {present.map((part) => (
                    <button
                      key={part}
                      type="button"
                      onClick={() => scrollTo(part)}
                      className="border-border text-muted-foreground flex-1 border-b-2 pb-1 text-xs font-semibold"
                    >
                      {partLabel(copy, part)}
                      <span className="text-muted-foreground/70 block text-[10px] font-normal tabular-nums">
                        {counts[part]}
                        {copy.freeSuffix}
                      </span>
                    </button>
                  ))}
                </div>

                {present.map((part) => (
                  <div
                    key={part}
                    className="scroll-mt-(--mini-app-safe-top,0px)"
                    ref={(node) => {
                      if (node !== null) groupRefs.current.set(part, node)
                    }}
                  >
                    {/*
                      The page scrolls now, not a drawer body, so the heading
                      sticks under the host's own controls rather than to the
                      top of a popup — hence the safe-area offset, and the page
                      background behind it instead of the drawer's card.
                    */}
                    <p className="bg-background text-muted-foreground sticky top-(--mini-app-safe-top,0px) z-10 py-2 text-[10px] font-semibold tracking-widest uppercase">
                      {partLabel(copy, part)}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {slots
                        .filter((slot) => partOfDay(slot.startMinutes) === part)
                        .map((slot) => (
                          <button
                            key={slot.startMinutes}
                            type="button"
                            disabled={!slot.available}
                            aria-pressed={startMinutes === slot.startMinutes}
                            onClick={() => setStartMinutes(slot.startMinutes)}
                            className={cn(
                              "rounded-xl border py-2 text-sm font-semibold tabular-nums transition-colors",
                              startMinutes === slot.startMinutes
                                ? "bg-primary text-primary-foreground border-transparent"
                                : "border-border",
                              // Taken, not gone: hiding it would reflow a
                              // three-column grid between days and cost the
                              // positional memory the layout trades on.
                              slot.available ? undefined : "text-muted-foreground/40 border-dashed",
                            )}
                          >
                            {clock(slot.startMinutes)}
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </Field>

        <p className="border-border text-muted-foreground mt-5 border-t pt-3 text-xs leading-5">
          {startMinutes === undefined ? (
            <>
              {clientName}
              {copy.footnotePendingTail}
              <span className="text-foreground font-semibold">{offset}</span>.
            </>
          ) : (
            <>
              {clientName}
              {copy.footnoteReadyTail}
              <span className="text-foreground font-semibold tabular-nums">
                {clock(startMinutes)}
              </span>
              {" ("}
              <span className="text-foreground font-semibold">{offset}</span>
              {")."}
            </>
          )}
        </p>

        {error === undefined ? null : (
          <p className="text-destructive mt-3 text-sm leading-5">{error}</p>
        )}
      </div>

      <TelegramMainButton
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

function Field({
  label,
  trailing,
  children,
}: {
  readonly label: string
  /** Something the field says about itself, on the label's own line. */
  readonly trailing?: React.ReactNode
  readonly children: React.ReactNode
}) {
  return (
    <div className="mt-5 flex flex-col gap-2 first:mt-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
          {label}
        </p>
        {trailing}
      </div>
      {children}
    </div>
  )
}

/**
 * The time field while a day is being read.
 *
 * Shaped like the grid it precedes rather than centred on a spinner: the coach
 * is looking at where the times will be, and something the size and rhythm of
 * them keeps that place. The section is held at its previous height around
 * this, so between two days nothing below it moves.
 */
function SlotSkeleton() {
  return (
    <>
      <div className="flex gap-1">
        {[0, 1, 2].map((column) => (
          <div key={column} className="border-border flex-1 border-b-2 pb-1">
            <Skeleton className="h-3 w-14 rounded-md" />
            <Skeleton className="mt-1 h-2 w-8 rounded-md" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-1 h-2.5 w-16 rounded-md" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="h-9 rounded-xl" />
        ))}
      </div>
    </>
  )
}

/**
 * A day with nothing left on it — every start taken, or too far gone for the
 * chosen length. It names the reason and offers the next day, because that is
 * what the coach was about to do anyway.
 */
function EmptyDay({
  copy,
  day,
  onNextDay,
}: {
  readonly copy: ClientsCopy
  readonly day: string
  readonly onNextDay: () => void
}) {
  return (
    <div className="border-border flex flex-col items-start gap-3 rounded-xl border border-dashed px-4 py-5">
      <p className="text-muted-foreground text-sm leading-5">
        {copy.emptyDayLead}
        <span className="text-foreground font-semibold">{day}</span>
        {copy.emptyDayTail}
      </p>
      <Button size="sm" variant="outline" onClick={onNextDay}>
        {copy.nextDay}
      </Button>
    </div>
  )
}
