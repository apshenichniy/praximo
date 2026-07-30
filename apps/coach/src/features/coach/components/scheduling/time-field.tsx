import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"
import { Skeleton } from "@praximo/ui/components/skeleton"
import type { DayView } from "@/features/coach/day-view.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { Field } from "./field.tsx"
import { RevealGroup, SlotGroup } from "./slot-groups.tsx"

function SlotSkeleton() {
  return (
    <>
      <Skeleton className="mt-1 h-2.5 w-16 rounded-md" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="h-9 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-3 h-2.5 w-20 rounded-md" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-9 rounded-xl" />
        ))}
      </div>
    </>
  )
}

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
      <p className="text-muted-foreground text-base leading-relaxed leading-5">
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

export function TimeField({
  copy,
  view,
  loaded,
  selected,
  day,
  revealed,
  minimumHeight,
  timeRef,
  onPick,
  onRevealEarlier,
  onRevealLater,
  onNextDay,
}: {
  readonly copy: ClientsCopy
  readonly view: DayView
  readonly loaded: boolean
  readonly selected: number | undefined
  readonly day: string
  readonly revealed: { readonly earlier: boolean; readonly later: boolean }
  readonly minimumHeight: number | undefined
  readonly timeRef: React.RefObject<HTMLDivElement | null>
  readonly onPick: (minutes: number) => void
  readonly onRevealEarlier: (open: boolean) => void
  readonly onRevealLater: (open: boolean) => void
  readonly onNextDay: () => void
}) {
  return (
    <Field label={copy.timeLabel}>
      {/*
        The loading, empty, and grid states crossfade. Loading keeps the last
        measured height so a date tap cannot collapse and regrow the page.
      */}
      <div
        key={!loaded ? "loading" : view.anyFree ? "grid" : "empty"}
        ref={timeRef}
        className="animate-in fade-in flex scroll-mt-(--mini-app-safe-top,0px) flex-col gap-2 duration-150"
        style={!loaded && minimumHeight !== undefined ? { minHeight: minimumHeight } : undefined}
      >
        {!loaded ? (
          <SlotSkeleton />
        ) : !view.anyFree ? (
          <EmptyDay copy={copy} day={day} onNextDay={onNextDay} />
        ) : (
          <>
            {view.earlier === undefined ? null : (
              <RevealGroup
                group={view.earlier}
                open={revealed.earlier}
                onOpenChange={onRevealEarlier}
                copy={copy}
                selected={selected}
                onPick={onPick}
              />
            )}

            {view.groups.map((group) => (
              <SlotGroup
                key={group.part}
                group={group}
                copy={copy}
                selected={selected}
                onPick={onPick}
              />
            ))}

            {view.later === undefined ? null : (
              <RevealGroup
                group={view.later}
                open={revealed.later}
                onOpenChange={onRevealLater}
                copy={copy}
                selected={selected}
                onPick={onPick}
              />
            )}
          </>
        )}
      </div>
    </Field>
  )
}
