import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Calendar } from "@praximo/ui/components/calendar"
import { DayStrip } from "@/features/coach/components/day-strip.tsx"
import { pad } from "@/features/coach/clock.ts"
import { extendStrip, sameDay, StripDays, stripWindow } from "@/features/coach/day-strip.ts"
import { calendarLocale } from "@/features/i18n/calendar-locale.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { impactHaptic, selectionHaptic } from "@/presentation-host"
import { Field } from "./field.tsx"

/** `YYYY-MM-DD` for a day the calendar hands back as a local `Date`. */
export const calendarDate = (day: Date): string =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`

export function DateField({
  copy,
  language,
  today,
  selectedDay,
  bookedDates,
  shortDayFormat,
  scrollTargetRef,
  onSelectDay,
  onDaysVisible,
}: {
  readonly copy: ClientsCopy
  readonly language: CoachLanguage
  readonly today: Date
  readonly selectedDay: Date
  readonly bookedDates: ReadonlyArray<string>
  readonly shortDayFormat: Intl.DateTimeFormat
  readonly scrollTargetRef: React.RefObject<HTMLDivElement | null>
  readonly onSelectDay: (day: Date | undefined) => void
  readonly onDaysVisible: (from: string, days: number) => void
}) {
  const [stripLength, setStripLength] = useState(StripDays)
  const [centreRequest, setCentreRequest] = useState(0)
  const [visibleMonth, setVisibleMonth] = useState<Date>(today)
  const [monthOpen, setMonthOpen] = useState(false)
  const [month, setMonth] = useState<Date>(today)
  const [monthHeight, setMonthHeight] = useState(0)
  const monthRef = useRef<HTMLDivElement>(null)
  const scrollAfterMonth = useRef(false)
  const booked = useMemo(() => new Set(bookedDates), [bookedDates])
  const days = useMemo(
    () => stripWindow(today, selectedDay, stripLength),
    [today, selectedDay, stripLength],
  )
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { month: "long" }),
    [language],
  )
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { day: "numeric", month: "long" }),
    [language],
  )

  useEffect(() => {
    const first = days[0]
    if (first !== undefined) onDaysVisible(calendarDate(first), days.length)
  }, [days, onDaysVisible])

  useEffect(() => {
    const node = monthRef.current
    if (node === null) return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height
      if (measured !== undefined && measured > 0) setMonthHeight(measured)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const toggleMonth = useCallback(() => {
    impactHaptic()
    setMonthOpen((open) => {
      if (!open) setMonth(selectedDay)
      return !open
    })
  }, [selectedDay])

  const chooseMonthDay = useCallback(
    (day: Date | undefined) => {
      if (day === undefined) return
      if (!sameDay(day, selectedDay)) selectionHaptic()
      onSelectDay(day)
      // Keep a carried day in the current strip so the row never jumps before
      // it glides; only a day outside the window re-anchors the fortnight.
      if (!days.some((carried) => sameDay(carried, day))) setStripLength(StripDays)
      setVisibleMonth(day)
      setCentreRequest((count) => count + 1)
      setMonthOpen(false)
      scrollAfterMonth.current = true
    },
    [days, onSelectDay, selectedDay],
  )

  const noteVisibleMonth = useCallback((day: Date) => {
    setVisibleMonth((current) =>
      current.getFullYear() === day.getFullYear() && current.getMonth() === day.getMonth()
        ? current
        : day,
    )
  }, [])

  const revealTime = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "height" || !scrollAfterMonth.current) return
      scrollAfterMonth.current = false
      scrollTargetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    },
    [scrollTargetRef],
  )

  return (
    <Field
      label={copy.dateLabel}
      trailing={
        <span
          key={monthFormat.format(visibleMonth)}
          className="animate-in fade-in slide-in-from-bottom-1 text-muted-foreground text-xs leading-normal font-semibold tracking-wide uppercase duration-150"
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
        onPick={onSelectDay}
        onExtend={() => setStripLength(extendStrip)}
        onOpenMonth={toggleMonth}
        onVisibleMonth={noteVisibleMonth}
        centreRequest={centreRequest}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-base leading-relaxed font-semibold">
          {sameDay(selectedDay, today)
            ? `${copy.today}, ${dateFormat.format(selectedDay)}`
            : dateFormat.format(selectedDay)}
        </span>
        <Button size="sm" variant="outline" aria-expanded={monthOpen} onClick={toggleMonth}>
          {copy.monthLabel}
        </Button>
      </div>

      {/*
        Measured height rather than `0fr → 1fr`: Telegram's iOS WebView did not
        animate the latter, and the disappearing month clamped the page scroll.
      */}
      <div
        style={{ height: monthOpen ? monthHeight : 0 }}
        onTransitionEnd={revealTime}
        className="ease-out overflow-hidden transition-[height] duration-200 motion-reduce:transition-none"
        aria-hidden={!monthOpen}
        inert={!monthOpen}
      >
        <div ref={monthRef}>
          <div className="border-border bg-card overflow-hidden rounded-2xl border">
            <Calendar
              mode="single"
              required={false}
              selected={selectedDay}
              onSelect={chooseMonthDay}
              disabled={{ before: today }}
              startMonth={today}
              month={month}
              onMonthChange={setMonth}
              modifiers={{ booked: (day) => booked.has(calendarDate(day)) }}
              modifiersClassNames={{
                booked:
                  "after:bg-primary after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:content-['']",
              }}
              locale={calendarLocale(language)}
              className="w-full bg-transparent"
            />
            <div className="border-border flex items-center gap-3 border-t px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => chooseMonthDay(today)}>
                {copy.today}
              </Button>
              <span className="text-muted-foreground text-xs leading-normal">
                {shortDayFormat.format(today)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Field>
  )
}
