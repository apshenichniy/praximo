import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { selectionHaptic } from "@/features/mini-app/haptics.ts"
import { cn } from "@/lib/utils.ts"

/**
 * A switch, sized for a thumb rather than for a pointer.
 *
 * shadcn's own is 32×18, which is a control for a mouse; iOS draws 51×31 and
 * Telegram's settings are near it. 40×24 is where this app lands — large enough
 * to hit without the row it sits in, small enough not to outweigh its label.
 *
 * The track is the whole target only in theory: on a phone the *row* is what
 * gets tapped, so every use of this wraps it in a label rather than leaving the
 * switch alone on the line.
 */
function Switch({ className, onCheckedChange, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent outline-none",
        "ease-out-strong transition-colors duration-(--duration-swap) motion-reduce:transition-none",
        "focus-visible:ring-ring/30 focus-visible:ring-[3px]",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-checked:bg-primary data-unchecked:bg-input",
        className,
      )}
      // One state replacing another (§Motion), carried by the component rather
      // than by each call site — the same reason `Toggle` carries its own. A
      // switch has no "chose what was already chosen" case: every press of it
      // is a change.
      onCheckedChange={(checked, eventDetails) => {
        selectionHaptic()
        onCheckedChange?.(checked, eventDetails)
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full",
          "ease-out-strong transition-transform duration-(--duration-swap) motion-reduce:transition-none",
          // The track is twice the thumb, so the thumb's own width less the two
          // border pixels is exactly the travel — no measuring, at any size.
          "data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0",
          "data-checked:bg-primary-foreground data-unchecked:bg-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
