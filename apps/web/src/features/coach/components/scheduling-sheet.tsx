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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import { Calendar } from "@/components/ui/calendar.tsx"
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer.tsx"
import { Spinner } from "@/components/ui/spinner.tsx"
import { TelegramMainButton } from "@/components/telegram-main-button.tsx"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { ActionBar } from "@/features/mini-app/components/action-bar.tsx"
import { cn } from "@/lib/utils.ts"

/**
 * The scheduling sheet (#56 §Scheduling), in the order the ticket fixes:
 * **kind, date, duration, time**.
 *
 * Duration sits above time deliberately. Overlaps are forbidden, so a start is
 * only legal in combination with a length — 10:45 is free for 30 minutes and
 * taken for 60 when 11:00 is booked. Asking for the time first produces a choice
 * a later tap invalidates; asked in this order, the grid never offers what will
 * not fit.
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

export function SchedulingSheet({
  open,
  onOpenChange,
  copy,
  language,
  clientName,
  firstSession,
  schedule,
  onDateChange,
  onSubmit,
  pending,
  error,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly copy: ClientsCopy
  readonly language: CoachLanguage
  readonly clientName: string
  /** Pre-selects `intake`: a client's first session usually is one, but never must be. */
  readonly firstSession: boolean
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
  const [calendarOpen, setCalendarOpen] = useState(true)
  const [startMinutes, setStartMinutes] = useState<number>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef(new Map<PartOfDay, HTMLDivElement>())

  const date = calendarDate(selectedDay)

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
      setCalendarOpen(false)
      setStartMinutes(undefined)
      onDateChange(calendarDate(day))
    },
    [onDateChange],
  )

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

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(localeTag(language), {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    [language],
  )

  const submit = useCallback(() => {
    if (startMinutes === undefined) return
    onSubmit({ date, startMinutes, durationMinutes, kind })
  }, [date, durationMinutes, kind, onSubmit, startMinutes])

  /**
   * A reopened sheet starts where a coach expects it to, not where they left it.
   *
   * Everything here is state the *sheet* owns, so without this a second booking
   * opens showing Monday while the screen has already fetched Tuesday — and
   * commits the day on screen rather than the day fetched.
   */
  useEffect(() => {
    if (!open) return
    setStartMinutes(undefined)
    setSelectedDay(today)
    setCalendarOpen(true)
    setKind(firstSession ? "intake" : "regular")
    setDurationTouched(false)
    setDurationMinutes(defaultDurationForKind(firstSession ? "intake" : "regular"))
  }, [firstSession, open, today])

  const scrollTo = (part: PartOfDay) => {
    const group = groupRefs.current.get(part)
    const body = bodyRef.current
    if (group === undefined || body === null) return
    body.scrollTo({ top: group.offsetTop - body.offsetTop - 8, behavior: "smooth" })
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
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle>{copy.sheetTitle}</DrawerTitle>
        </DrawerHeader>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 pb-4">
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

          <Field label={copy.dateLabel}>
            {calendarOpen ? (
              <div className="border-border overflow-hidden rounded-2xl border">
                <Calendar
                  mode="single"
                  required={false}
                  selected={selectedDay}
                  onSelect={chooseDay}
                  disabled={{ before: today }}
                  startMonth={today}
                  // Weekday and month names in the coach's language, like every
                  // other word on the screen.
                  locale={{ code: localeTag(language) }}
                  className="w-full bg-transparent"
                />
                <div className="border-border flex items-center gap-3 border-t px-4 py-3">
                  <Button size="sm" variant="outline" onClick={() => chooseDay(today)}>
                    {copy.today}
                  </Button>
                  <span className="text-muted-foreground text-xs">{dayFormat.format(today)}</span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                className="border-border flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold">{dayFormat.format(selectedDay)}</span>
                <span className="text-muted-foreground text-xs">{copy.changeDate}</span>
              </button>
            )}
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
            {schedule === undefined ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
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
                    ref={(node) => {
                      if (node !== null) groupRefs.current.set(part, node)
                    }}
                  >
                    <p className="bg-card text-muted-foreground sticky top-0 z-10 py-2 text-[10px] font-semibold tracking-widest uppercase">
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
      </DrawerContent>
    </Drawer>
  )
}

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="mt-5 flex flex-col gap-2 first:mt-0">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
        {label}
      </p>
      {children}
    </div>
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
