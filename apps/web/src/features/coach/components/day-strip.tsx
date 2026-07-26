import { Calendar03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useCallback, useEffect, useMemo, useRef } from "react"

import { sameDay } from "@/features/coach/day-strip.ts"
import { cn } from "@/lib/utils.ts"

/** How close to the end a thumb has to get before the next fortnight arrives. */
const ExtendMargin = 160

/**
 * The date field of the scheduling screen (#186): days the thumb runs along, at
 * a height that never changes.
 *
 * The dot is the same mark the month carries — a day this client already has a
 * session on. It is what makes a rhythm visible while it is being placed, and
 * what stops the classic double booking of one Tuesday, so it survives the move
 * off the month.
 *
 * Scrolling forward asks for more days rather than stopping, because a
 * horizontal scroller promises exactly that. The last thing on the strip is the
 * month itself: past a few weeks out, tapping a square beats swiping a fortnight,
 * and an edge that offers that is better than an edge that just ends.
 */
export function DayStrip({
  days,
  selected,
  today,
  isBooked,
  language,
  monthLabel,
  onPick,
  onExtend,
  onOpenMonth,
  onVisibleMonth,
}: {
  readonly days: ReadonlyArray<Date>
  readonly selected: Date
  readonly today: Date
  readonly isBooked: (day: Date) => boolean
  readonly language: CoachLanguage
  /** The word on the tail control that opens the month. */
  readonly monthLabel: string
  readonly onPick: (day: Date) => void
  /** More days, please — the strip is nearly scrolled through. */
  readonly onExtend: () => void
  readonly onOpenMonth: () => void
  /**
   * The month the strip is looking at, reported as it changes. Numbers alone
   * stop meaning anything a fortnight out, and the field's own label is where
   * there is room to say which month they belong to.
   */
  readonly onVisibleMonth: (day: Date) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const frame = useRef<number>(undefined)

  const weekdayFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { weekday: "short" }),
    [language],
  )
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(localeTag(language), { day: "numeric" }),
    [language],
  )

  /**
   * One read per frame, from the scroll position rather than from an observer
   * per day: the strip is a row of equal boxes, so which one is at the left
   * edge is arithmetic, and arithmetic does not allocate ninety observers.
   */
  const onScroll = useCallback(() => {
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      const container = scrollRef.current
      if (container === null) return

      const first = container.children[0] as HTMLElement | undefined
      const second = container.children[1] as HTMLElement | undefined
      const step =
        first !== undefined && second !== undefined ? second.offsetLeft - first.offsetLeft : 0
      if (step > 0) {
        const index = Math.min(
          days.length - 1,
          Math.max(0, Math.round(container.scrollLeft / step)),
        )
        const day = days[index]
        // Reported every frame; the screen keeps the month it already has when
        // this one is the same, which is most frames.
        if (day !== undefined) onVisibleMonth(day)
      }

      if (container.scrollLeft + container.clientWidth >= container.scrollWidth - ExtendMargin) {
        onExtend()
      }
    })
  }, [days, onExtend, onVisibleMonth])

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    },
    [],
  )

  /**
   * A day chosen from the month can sit anywhere on the strip, so the strip
   * brings it into view itself. Scrolled by hand rather than with
   * `scrollIntoView`, which would also scroll the *page* to reach it — the one
   * thing this field exists to stop doing.
   *
   * Only when the day is not already fully on screen: a tap should never make
   * the row move under the thumb that just tapped it.
   */
  useEffect(() => {
    const container = scrollRef.current
    const chosen = selectedRef.current
    if (container === null || chosen === null) return
    const left = chosen.offsetLeft - container.scrollLeft
    if (left >= 0 && left + chosen.clientWidth <= container.clientWidth) return
    container.scrollTo({
      left: chosen.offsetLeft - (container.clientWidth - chosen.clientWidth) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    })
  }, [selected])

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="-mx-5 flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map((day) => {
        const chosen = sameDay(day, selected)
        return (
          <button
            key={day.toDateString()}
            ref={chosen ? selectedRef : undefined}
            data-strip-day
            type="button"
            aria-pressed={chosen}
            onClick={() => onPick(day)}
            className={cn(
              "flex w-14 flex-none snap-start flex-col items-center gap-0.5 rounded-2xl border py-2",
              "ease-out-strong transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97]",
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
                !isBooked(day) ? "bg-transparent" : chosen ? "bg-primary-foreground" : "bg-primary",
              )}
            />
          </button>
        )
      })}

      <button
        type="button"
        onClick={onOpenMonth}
        className="border-border text-muted-foreground ease-out-strong flex w-14 flex-none snap-start flex-col items-center justify-center gap-1 rounded-2xl border border-dashed py-2 transition-transform duration-150 active:scale-[0.97]"
      >
        <HugeiconsIcon icon={Calendar03Icon} size={16} strokeWidth={2} />
        <span className="text-[10px] font-semibold tracking-wide uppercase">{monthLabel}</span>
      </button>
    </div>
  )
}
