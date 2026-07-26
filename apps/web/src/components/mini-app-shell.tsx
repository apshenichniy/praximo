import type { CSSProperties, ReactNode } from "react"

/**
 * The frame both Mini Apps sit in — the manager one and the coach one — carrying
 * the safe-area insets the fullscreen requirement asks for (mini-app.md). Telegram publishes the device safe area
 * and its own overlay (the fullscreen close/minimize controls) as CSS variables;
 * padding by their sum keeps content clear of both. Every variable falls back to
 * `0px`, so outside fullscreen — and outside Telegram entirely — the frame is
 * flush. The paint (`bg-background`) still fills the inset band behind the host
 * controls; only the content is pushed in.
 */
const safeAreaInsets: CSSProperties & Record<"--mini-app-safe-top", string> = {
  // Published to the page as well as applied here: a `sticky` heading anchors
  // to the viewport, not to this frame's padding box, so a screen that has one
  // needs the same number the padding is made of (#186).
  "--mini-app-safe-top":
    "calc(var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px))",
  paddingTop:
    "calc(var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px))",
  paddingRight:
    "calc(var(--tg-safe-area-inset-right, 0px) + var(--tg-content-safe-area-inset-right, 0px))",
  paddingBottom:
    "calc(var(--tg-safe-area-inset-bottom, 0px) + var(--tg-content-safe-area-inset-bottom, 0px))",
  paddingLeft:
    "calc(var(--tg-safe-area-inset-left, 0px) + var(--tg-content-safe-area-inset-left, 0px))",
}

export function MiniAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground font-sans min-h-svh" style={safeAreaInsets}>
      {children}
    </div>
  )
}
