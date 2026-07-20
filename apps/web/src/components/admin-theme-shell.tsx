import type { ReactNode } from "react"

/**
 * Confines the admin design tokens to its subtree. `admin.css` scopes every
 * token under the `[data-theme="admin"]` selector this wrapper sets, so admin
 * colours, radii, and fonts apply only inside — a second line of defence on top
 * of the route-level stylesheet split, guaranteeing no admin token restyles
 * coach UI even if the stylesheet were ever present on a coach route.
 */
export function AdminThemeShell({ children }: { children: ReactNode }) {
  return (
    <div data-theme="admin" className="bg-background text-foreground font-sans min-h-svh">
      {children}
    </div>
  )
}
