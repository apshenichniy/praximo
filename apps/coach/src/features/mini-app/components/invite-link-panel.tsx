import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@praximo/ui/components/input-group"
import type { CopyLinkController } from "@/features/mini-app/hooks/use-copy-link.ts"

/**
 * Read-only onboarding-link field with an inline copy button. The input also
 * serves as the select-fallback target when the clipboard API is unavailable.
 * Pass the same `CopyLinkController` to any larger "Copy link" button nearby
 * so both share one "Copied" state.
 */
export function InviteLinkPanel({
  link,
  ariaLabel,
  controller,
  copyLabel = "Copy link",
  copiedLabel = "Copied",
}: {
  readonly link: string
  readonly ariaLabel: string
  readonly controller: CopyLinkController
  readonly copyLabel?: string
  readonly copiedLabel?: string
}) {
  return (
    <InputGroup className="h-12 rounded-2xl">
      <InputGroupInput
        ref={controller.fallbackRef}
        readOnly
        value={link}
        aria-label={ariaLabel}
        className="truncate px-4 text-base leading-relaxed"
        onFocus={(event) => event.target.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-sm"
          aria-label={controller.copied ? copiedLabel : copyLabel}
          onClick={() => void controller.copy()}
        >
          <HugeiconsIcon
            icon={controller.copied ? Tick02Icon : Copy01Icon}
            size={16}
            strokeWidth={2}
            className={controller.copied ? "text-success" : undefined}
          />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
