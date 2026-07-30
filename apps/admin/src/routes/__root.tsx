import type { QueryClient } from "@tanstack/react-query"
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router"
import { FeedbackProvider, Heading, Text } from "@praximo/ui"

import faviconDark from "../../../../assets/branding/coach-bot/dark/favicon.ico?url"
import faviconLight from "../../../../assets/branding/coach-bot/light/favicon.ico?url"
import {
  APP_BACKGROUND_COLOR,
  APP_FOREGROUND_COLOR,
  APP_SURFACE_COLOR,
  COLOR_SCHEME_BOOTSTRAP,
  DARK_SCHEME_CLASS,
  HostTheme,
  MiniAppProvider,
  presentationFeedback,
  TELEGRAM_WEBAPP_SRC,
} from "@/mini-app.tsx"
import appCss from "@/styles/app.css?url"

const darkBackground = "oklch(0.141 0.005 285.823)"
const darkForeground = "oklch(0.985 0 0)"
const lightBackground = "oklch(1 0 0)"
const lightForeground = "oklch(0.141 0.005 285.823)"

/**
 * The first paint, before the stylesheet arrives — both schemes, because which
 * one it will be is not known until `COLOR_SCHEME_BOOTSTRAP` runs a few bytes
 * further down the head. The hex declaration in each pair is the fallback for
 * browsers without oklch; the oklch one immediately overrides it.
 */
const criticalCss =
  `html,body{background:${APP_BACKGROUND_COLOR.light};background:${lightBackground};` +
  `color:${APP_FOREGROUND_COLOR.light};color:${lightForeground};color-scheme:light;` +
  `font-family:system-ui,sans-serif}` +
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
      { name: "robots", content: "noindex,nofollow" },
      { title: "Praximo Admin" },
    ],
    links: [
      { rel: "icon", href: faviconDark, sizes: "any" },
      {
        rel: "icon",
        href: faviconLight,
        sizes: "any",
        media: "(prefers-color-scheme: light)",
      },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [{ src: TELEGRAM_WEBAPP_SRC }],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <Heading as="h1" role="page-title">
        404
      </Heading>
      <Text className="text-muted-foreground mt-2">The requested page could not be found.</Text>
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
        <FeedbackProvider adapter={presentationFeedback}>
          <MiniAppProvider>
            <HostTheme />
            {children}
          </MiniAppProvider>
        </FeedbackProvider>
        <Scripts />
      </body>
    </html>
  )
}
