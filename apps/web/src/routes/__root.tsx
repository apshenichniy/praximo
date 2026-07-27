import type { QueryClient } from "@tanstack/react-query"
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router"

import { TelegramTheme } from "@/components/telegram-theme.tsx"
import { TELEGRAM_WEBAPP_SRC } from "@/lib/telegram.ts"
import {
  APP_BACKGROUND_COLOR,
  APP_FOREGROUND_COLOR,
  APP_SURFACE_COLOR,
  COLOR_SCHEME_BOOTSTRAP,
  DARK_SCHEME_CLASS,
} from "@/lib/theme.ts"
import appCss from "@/styles/app.css?url"

const darkBackground = "oklch(0.148 0.004 228.8)"
const darkForeground = "oklch(0.987 0.002 197.1)"
const lightBackground = "oklch(0.965 0.002 197.1)"
const lightForeground = "oklch(0.148 0.004 228.8)"

/**
 * The first paint, before the stylesheet arrives — both schemes, because which
 * one it will be is not known until `COLOR_SCHEME_BOOTSTRAP` runs a few bytes
 * further down the head. The hex declaration in each pair is the fallback for
 * browsers without oklch; the oklch one immediately overrides it.
 */
const criticalCss =
  `html,body{background:${APP_BACKGROUND_COLOR.light};background:${lightBackground};` +
  `color:${APP_FOREGROUND_COLOR.light};color:${lightForeground};color-scheme:light;` +
  `font-family:"Inter Variable",ui-sans-serif,system-ui,sans-serif}` +
  `html.${DARK_SCHEME_CLASS},html.${DARK_SCHEME_CLASS} body{background:${APP_BACKGROUND_COLOR.dark};` +
  `background:${darkBackground};color:${APP_FOREGROUND_COLOR.dark};color:${darkForeground};` +
  `color-scheme:dark}`

export interface RouterContext {
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // The launch value only; `applyColorScheme` rewrites it once the host's
      // scheme is known, and again whenever it moves.
      { name: "theme-color", content: APP_SURFACE_COLOR.dark },
      { title: "Praximo" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [{ src: TELEGRAM_WEBAPP_SRC }],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

/**
 * The document is rendered **scheme-less**: the server cannot know which one it
 * is (Telegram publishes the client's theme in the URL hash, which no request
 * carries), so the class is put on by the blocking script below — synchronously,
 * ahead of the body, which is what keeps the wrong ground off the screen.
 * `suppressHydrationWarning` is there for exactly that: React finds a class it
 * did not render and leaves it alone.
 */
function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style>{criticalCss}</style>
        {/* oxlint-disable-next-line no-danger -- an inline blocking script is the only thing that runs before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_BOOTSTRAP }} />
        <HeadContent />
      </head>
      <body>
        <TelegramTheme />
        {children}
        <Scripts />
      </body>
    </html>
  )
}
