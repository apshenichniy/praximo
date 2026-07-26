import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useEffect, useMemo, useRef } from "react"

import { sameDay } from "@/features/coach/day-strip.ts"
import { cn } from "@/lib/utils.ts"

/**
 * The date field of the scheduling screen (#186): a fortnight of days the thumb
 * can run along, at a height that never changes.
 *
 * The dot is the same mark the month carries — a day this client already has a
 * session on. It is the thing that makes a rhythm visible while it is being
 * placed, and it is what stops the classic double booking of one Tuesday, so it
 * survives the move off the month.
 */
export function DayStrip({
  days,
  selected,
  today,
  isBooked,
  language,
  onPick,
}: {
  readonly days: ReadonlyArray<Date>
  readonly selected: Date
  readonly today: Date
  readonly isBooked: (day: Date) => boolean
  readonly language: CoachLanguage
  readonly onPick: (day: Date) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const weekdayFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { weekday: "short" }),
    [language],
  )
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { day: "numeric" }),
    [language],
  )

  /**
   * A day chosen from the month can sit anywhere on the strip, so the strip
   * brings it into view itself. Scrolled by hand rather than with
   * `scrollIntoView`, which would also scroll the *page* to reach it — the one
   * thing this field exists to stop doing.
   */
  useEffect(() => {
    const container = scrollRef.current
    const chosen = selectedRef.current
    if (container === null || chosen === null) return
    container.scrollTo({
      left: chosen.offsetLeft - (container.clientWidth - chosen.clientWidth) / 2,
      behavior: "smooth",
    })
  }, [selected])

  return (
    <div
      ref={scrollRef}
      className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map((day) => {
        const chosen = sameDay(day, selected)
        const booked = isBooked(day)
        return (
          <button
            key={day.toDateString()}
            ref={chosen ? selectedRef : undefined}
            type="button"
            aria-pressed={chosen}
            onClick={() => onPick(day)}
            className={cn(
              "flex w-14 flex-none snap-start flex-col items-center gap-0.5 rounded-2xl border py-2 transition-colors",
              chosen
                ? "bg-primary text-primary-foreground border-transparent"
                : sameDay(day, today)
                  ? "border-primary/50 text-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            <span className="text-[10px] font-semibold tracking-wide uppercase opacity-70">
              {weekdayFormat.format(day)}
            </span>
            <span className="text-base font-semibold tabular-nums">{dayFormat.format(day)}</span>
            <span
              aria-hidden="true"
              className={cn(
                "size-1 rounded-full",
                !booked ? "bg-transparent" : chosen ? "bg-primary-foreground" : "bg-primary",
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
