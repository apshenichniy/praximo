import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group.tsx"

export function WorkspaceSearch({
  value,
  onChange,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <InputGroup className="bg-card ring-border h-14 rounded-2xl ring-1">
      <InputGroupAddon>
        <HugeiconsIcon
          icon={Search01Icon}
          size={22}
          strokeWidth={1.8}
          className="text-muted-foreground size-5.5"
        />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search"
        aria-label="Search workspaces"
        className="text-base [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value.length === 0 ? null : (
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" aria-label="Clear search" onClick={() => onChange("")}>
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
