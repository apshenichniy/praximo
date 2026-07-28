import { Calendar03Icon, ArrowRight01Icon, Clock01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage, WorkingHours } from "@praximo/domain"
import { Heading } from "@praximo/ui"
import { Card } from "@praximo/ui/components/card"

import { workingHoursLine } from "@/features/coach/working-hours-line.ts"
import type { AvailabilityCopy } from "@/features/i18n/coach-copy/availability.ts"
import type { CommonCopy } from "@/features/i18n/coach-copy/common.ts"
import { HostBackButton } from "@/presentation-host"

/**
 * Availability (#210): where a coach says when they are reachable.
 *
 * Two things live here and they are grouped by what they are about rather than
 * by when they ship. **Working hours** are the policy half — the half no
 * calendar can supply, because an empty Friday and a free Friday are the same
 * bytes in Google while "I don't work Fridays" exists nowhere but in the
 * coach's head. The **calendar connection** is the other half, and it arrives
 * with its own slice.
 *
 * Hours sit first: every coach has them and they are already in force, while
 * the connection is optional and may never be made.
 *
 * Deliberately not «Settings», and there is no language control here — the
 * onboarding chips remain the only one in MVP (mini-app.md §First login). A
 * screen named for what it holds does not invite the question.
 */
export function AvailabilityScreen({
  copy,
  common,
  language,
  hours,
  onWorkingHours,
}: {
  readonly copy: AvailabilityCopy
  readonly common: CommonCopy
  readonly language: CoachLanguage
  readonly hours: WorkingHours
  readonly onWorkingHours: () => void
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 pt-14 pb-16">
      <HostBackButton label={common.back} />

      <Heading as="h1" role="page-title" className="mt-2">
        {copy.title}
      </Heading>

      <p className="text-muted-foreground mt-8 text-xs leading-normal font-semibold tracking-wide uppercase">
        {copy.yourTime}
      </p>

      <Card className="mt-3 gap-0 overflow-hidden py-0">
        <button
          type="button"
          onClick={onWorkingHours}
          className="active:bg-muted flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-100"
        >
          <HugeiconsIcon
            icon={Clock01Icon}
            size={18}
            strokeWidth={2}
            className="text-muted-foreground shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-relaxed font-medium">
              {copy.workingHoursRow}
            </span>
            {/*
              The row states the hours rather than merely leading to them: a
              coach wondering why Saturday stopped being offered gets the answer
              without opening anything.
            */}
            <span className="text-muted-foreground mt-0.5 block truncate text-xs leading-normal">
              {workingHoursLine(hours, copy, language)}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={18}
            strokeWidth={2}
            className="text-muted-foreground shrink-0"
          />
        </button>
      </Card>

      {/*
        The calendar connection, in the place it will occupy. Inert for this
        slice by decision: the card is drawn as it will be, and Connect does
        nothing until the calendar slice wires it up. It sits second because
        hours exist for every coach while a connection is optional.
      */}
      <Card className="mt-3 gap-0 px-5 py-4">
        <div className="flex items-center gap-3">
          <HugeiconsIcon
            icon={Calendar03Icon}
            size={18}
            strokeWidth={2}
            className="text-muted-foreground shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-relaxed font-medium">
              {copy.calendarTitle}
            </span>
            <span className="text-muted-foreground mt-0.5 block text-xs leading-normal">
              {copy.calendarNotConnected}
            </span>
          </span>
        </div>
        <p className="text-muted-foreground mt-3 text-xs leading-normal leading-5">
          {copy.calendarWhy}
        </p>
        <button
          type="button"
          className="bg-secondary border-border text-foreground ease-[var(--ease-out)] mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border text-base leading-relaxed font-medium transition-transform duration-100 active:scale-[0.98]"
        >
          {copy.calendarConnect}
        </button>
      </Card>
    </main>
  )
}
