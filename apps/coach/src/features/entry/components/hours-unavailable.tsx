import { WifiDisconnected01Icon } from "@hugeicons/core-free-icons"

import { EntryFrame } from "@/features/entry/components/entry-frame.tsx"
import type { CoachCopy } from "@/features/i18n/coach-copy.ts"
import { FeedbackButton as Button } from "@praximo/ui/custom/feedback-button"

/**
 * What the hours screens show when the week could not be read (#210).
 *
 * A screen rather than the default week, and the distinction is not cosmetic.
 * These screens **commit on change**, so seeding them with
 * `DefaultWorkingHours` after a failed read would arm every control on them:
 * one chip tap would write 08:00–22:00 across all seven days over hours the
 * coach actually has. That is the failure the write path refuses by parsing
 * strictly — reintroduced on the read path, where it is worse, because nothing
 * about the screen would look wrong.
 *
 * Availability itself uses it for the same reason in a quieter key: a row that
 * states hours the coach does not have is a screen lying about the one fact it
 * exists to report.
 */
export function HoursUnavailable({
  copy,
  onRetry,
}: {
  readonly copy: CoachCopy
  readonly onRetry: () => void
}) {
  return (
    <EntryFrame
      icon={WifiDisconnected01Icon}
      tone="muted"
      title={copy.entry.unavailableTitle}
      body={copy.entry.unavailableBody}
    >
      <div className="mt-8">
        <Button className="w-full" onClick={onRetry}>
          {copy.common.tryAgain}
        </Button>
      </div>
    </EntryFrame>
  )
}
