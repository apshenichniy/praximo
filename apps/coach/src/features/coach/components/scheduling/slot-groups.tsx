import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { DaySlot } from "@praximo/domain"
import { cn } from "@praximo/ui"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@praximo/ui/components/collapsible"
import { clock } from "@/features/coach/clock.ts"
import type { DayGroupView, RevealGroupView } from "@/features/coach/day-view.ts"
import type { ClientsCopy } from "@/features/i18n/coach-copy/clients.ts"
import { impactHaptic, selectionHaptic } from "@/presentation-host"

function SlotButton({
  slot,
  selected,
  outside,
  onPick,
}: {
  readonly slot: DaySlot
  readonly selected: boolean
  readonly outside: boolean
  readonly onPick: (minutes: number) => void
}) {
  return (
    <button
      type="button"
      disabled={!slot.available}
      aria-pressed={selected}
      onClick={() => {
        if (!selected) selectionHaptic()
        onPick(slot.startMinutes)
      }}
      className={cn(
        "flex min-h-11 items-center justify-center rounded-xl border py-2 text-base leading-relaxed font-semibold tabular-nums",
        "ease-[var(--ease-out)] transition-[color,background-color,border-color,scale] duration-100",
        "enabled:active:scale-[0.97]",
        selected
          ? "bg-primary text-primary-foreground border-transparent"
          : "bg-secondary border-border",
        slot.available ? (outside ? "opacity-60" : undefined) : "opacity-45",
      )}
    >
      {clock(slot.startMinutes)}
    </button>
  )
}

function GroupHeading({
  children,
  trailing,
}: {
  readonly children: React.ReactNode
  readonly trailing?: React.ReactNode
}) {
  return (
    <div className="bg-background sticky top-(--mini-app-safe-top,0px) z-10 flex items-baseline justify-between gap-3 py-2">
      <span className="text-muted-foreground text-xs leading-normal font-semibold tracking-wide uppercase">
        {children}
      </span>
      {trailing}
    </div>
  )
}

function FreeCount({ count, copy }: { readonly count: number; readonly copy: ClientsCopy }) {
  return (
    <span className="text-muted-foreground text-xs leading-normal tabular-nums">
      {count}
      {copy.freeSuffix}
    </span>
  )
}

function SlotGrid({
  slots,
  outside,
  selected,
  onPick,
}: {
  readonly slots: ReadonlyArray<DaySlot>
  readonly outside: boolean
  readonly selected: number | undefined
  readonly onPick: (minutes: number) => void
}) {
  return (
    <div className={outside ? "grid grid-cols-3 gap-2 pt-1 pb-2" : "grid grid-cols-3 gap-2"}>
      {slots.map((slot) => (
        <SlotButton
          key={slot.startMinutes}
          slot={slot}
          outside={outside}
          selected={selected === slot.startMinutes}
          onPick={onPick}
        />
      ))}
    </div>
  )
}

/** One part of the coach's own day: its heading, count, and starts. */
export function SlotGroup({
  group,
  selected,
  copy,
  onPick,
}: {
  readonly group: DayGroupView
  readonly selected: number | undefined
  readonly copy: ClientsCopy
  readonly onPick: (minutes: number) => void
}) {
  return (
    <div>
      <GroupHeading trailing={<FreeCount count={group.freeCount} copy={copy} />}>
        {group.heading}
      </GroupHeading>
      <SlotGrid slots={group.slots} outside={false} selected={selected} onPick={onPick} />
    </div>
  )
}

/** Hours outside the coach's own, held behind the existing reveal control. */
export function RevealGroup({
  group,
  open,
  onOpenChange,
  selected,
  copy,
  onPick,
}: {
  readonly group: RevealGroupView
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly selected: number | undefined
  readonly copy: ClientsCopy
  readonly onPick: (minutes: number) => void
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        impactHaptic()
        onOpenChange(next)
      }}
    >
      <CollapsibleTrigger
        render={
          <button type="button" className="w-full text-left">
            <GroupHeading trailing={<FreeCount count={group.freeCount} copy={copy} />}>
              <span className="flex items-center gap-1.5">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  strokeWidth={2}
                  className={cn(
                    "ease-[var(--ease-out)] transition-transform duration-150",
                    open && "rotate-90",
                  )}
                />
                {group.heading}
              </span>
            </GroupHeading>
          </button>
        }
      />
      <CollapsibleContent className="overflow-hidden">
        <SlotGrid slots={group.slots} outside selected={selected} onPick={onPick} />
      </CollapsibleContent>
    </Collapsible>
  )
}
