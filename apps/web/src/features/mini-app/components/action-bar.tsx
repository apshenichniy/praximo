import type { ReactNode } from "react"

/**
 * Fixed bottom bar for the primary form action. Children render inside the
 * page-width column; the bar itself pads for the device safe area.
 */
export function ActionBar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="border-border bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  )
}
