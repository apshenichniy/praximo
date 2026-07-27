import { Calendar03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage } from "@praximo/domain"
import { localeTag } from "@praximo/i18n"
import { useCallback, useEffect, useMemo, useRef } from "react"

import { sameDay } from "@/features/coach/day-strip.ts"
import { selectionHaptic } from "@/features/mini-app/haptics.ts"
import { prefersReducedMotion } from "@/lib/motion.ts"
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
  centreRequest,
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
  /**
   * Bumped by the screen when the strip must go to the chosen day whether or not
   * that day changed — «Today» pressed on a strip already scrolled weeks out.
   */
  readonly centreRequest: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const frame = useRef<number>(undefined)
  const glideFrame = useRef<number>(undefined)

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

      // Not while gliding: an animation travelling to the end would keep asking
      // for more days and chase a row that grows ahead of it.
      if (
        glideFrame.current === undefined &&
        container.scrollLeft + container.clientWidth >= container.scrollWidth - ExtendMargin
      ) {
        onExtend()
      }
    })
  }, [days, onExtend, onVisibleMonth])

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      if (glideFrame.current !== undefined) cancelAnimationFrame(glideFrame.current)
    },
    [],
  )

  /**
   * The chosen day, brought to the middle.
   *
   * Animated by hand rather than with `scrollTo({ behavior: "smooth" })`: the
   * browser's own smooth scroll has a duration nobody can set, and across a
   * fortnight it crawls. This is the `--ease-out-strong` shape — off fast,
   * settling long — over a distance-aware duration, and it gives up the moment
   * a thumb lands on the strip, because a finger always outranks an animation.
   */
  const glide = useCallback((left: number) => {
    const container = scrollRef.current
    if (container === null) return
    if (glideFrame.current !== undefined) cancelAnimationFrame(glideFrame.current)

    const from = container.scrollLeft
    const distance = left - from
    if (Math.abs(distance) < 2 || prefersReducedMotion()) {
      container.scrollLeft = left
      return
    }

    const duration = Math.min(520, Math.max(240, Math.abs(distance) * 0.5))
    const started = performance.now()
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - started) / duration)
      const eased = 1 - (1 - elapsed) ** 3
      container.scrollLeft = from + distance * eased
      glideFrame.current = elapsed < 1 ? requestAnimationFrame(step) : undefined
    }
    glideFrame.current = requestAnimationFrame(step)
  }, [])

  const centre = useCallback(
    (force: boolean) => {
      const container = scrollRef.current
      const chosen = selectedRef.current
      if (container === null || chosen === null) return
      const left = chosen.offsetLeft - container.scrollLeft
      // A tap must never move the row under the thumb that made it — so an
      // already-visible day is left where it is unless the screen insists.
      if (!force && left >= 0 && left + chosen.clientWidth <= container.clientWidth) return
      glide(chosen.offsetLeft - (container.clientWidth - chosen.clientWidth) / 2)
    },
    [glide],
  )

  /** A day chosen from the month can sit anywhere, so the strip goes to it. */
  useEffect(() => {
    centre(false)
  }, [centre, selected])

  /**
   * What the strip cannot see from `selected` alone: «Today» pressed while today
   * is already the chosen day changes no state at all, and the strip — scrolled
   * three weeks out by hand — would keep showing August while the screen says
   * the 26th of July. The screen asks, in so many words, to be taken there.
   */
  useEffect(() => {
    if (centreRequest === 0) return
    centre(true)
  }, [centre, centreRequest])

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // A thumb outranks the glide: landing on the strip stops it dead rather
      // than fighting it for the scroll position.
      onPointerDown={() => {
        if (glideFrame.current !== undefined) cancelAnimationFrame(glideFrame.current)
        glideFrame.current = undefined
      }}
      // No scroll snapping, deliberately. `mandatory` snapping puts the momentum
      // of a flick against the snap and the snap wins: the strip crept forward a
      // day or two per swipe and felt stuck. Free scrolling keeps the whole
      // fortnight one flick away, and nothing here needs to land exactly.
      className="-mx-5 flex gap-2 overflow-x-auto overscroll-x-contain px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            onClick={() => {
              if (!chosen) selectionHaptic()
              onPick(day)
            }}
            className={cn(
              "flex w-14 flex-none flex-col items-center gap-0.5 rounded-2xl border py-2",
              "ease-out-strong transition-[color,background-color,border-color,scale] duration-(--duration-press) active:scale-[0.97]",
              chosen
                ? "bg-primary text-primary-foreground border-transparent"
                : sameDay(day, today)
                  ? // Today, unchosen: the brand marks it rather than a tint of
                    // the primary, so it still reads when the brand is not the
                    // primary (#198).
                    "bg-secondary border-brand text-foreground"
                  : "bg-secondary border-control-border text-muted-foreground",
            )}
          >
            <span className="text-caption font-semibold tracking-wide uppercase">
              {weekdayFormat.format(day)}
            </span>
            <span className="text-emphasis font-semibold tabular-nums">
              {dayFormat.format(day)}
            </span>
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
        className="border-control-border text-muted-foreground ease-out-strong flex w-16 flex-none flex-col items-center justify-center gap-1 rounded-2xl border border-dashed py-2 transition-[color,background-color,border-color,scale] duration-(--duration-press) active:scale-[0.97]"
      >
        <HugeiconsIcon icon={Calendar03Icon} size={16} strokeWidth={2} />
        <span className="text-caption font-semibold uppercase">{monthLabel}</span>
      </button>
    </div>
  )
}
