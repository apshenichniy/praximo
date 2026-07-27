import { narrowCoachLanguage } from "@praximo/domain"
import { HeadContent, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router"

import { ClientTheme } from "@/components/client-theme.tsx"
import {
  APP_BACKGROUND_COLOR,
  APP_FOREGROUND_COLOR,
  APP_SURFACE_COLOR,
  DARK_SCHEME_CLASS,
  THEME_BOOTSTRAP,
} from "@/lib/theme.ts"
import appCss from "@/styles/app.css?url"

const darkBackground = "oklch(0.148 0.0132 285)"
const darkForeground = "oklch(0.9608 0.005 285)"
const lightBackground = "oklch(0.964 0.005 285)"
const lightForeground = "oklch(0.1785 0.0168 285)"

/**
 * The first paint, before the stylesheet arrives — both schemes, because which
 * one it will be is not known until `THEME_BOOTSTRAP` runs a few bytes further
 * down the head. The hex declaration in each pair is the fallback for browsers
 * without oklch; the oklch one immediately overrides it.
 */
const criticalCss =
  `html,body{background:${APP_BACKGROUND_COLOR.light};background:${lightBackground};` +
  `color:${APP_FOREGROUND_COLOR.light};color:${lightForeground};color-scheme:light;` +
  `font-family:"Inter Variable",ui-sans-serif,system-ui,sans-serif}` +
  `html.${DARK_SCHEME_CLASS},html.${DARK_SCHEME_CLASS} body{background:${APP_BACKGROUND_COLOR.dark};` +
  `background:${darkBackground};color:${APP_FOREGROUND_COLOR.dark};color:${darkForeground};` +
  `color-scheme:dark}`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // The light value only; `applyColorScheme` rewrites it once the reader's
      // scheme is known, and again whenever it moves. Light rather than dark
      // because light is what `:root` carries with no class on the document.
      { name: "theme-color", content: APP_SURFACE_COLOR.light },
      { title: "Praximo" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    // No `scripts` entry, and that absence is the point (#191): `apps/web` loads
    // Telegram's `telegram-web-app.js` on every route, this app on none. A person
    // who is not on Telegram — and whose whole point is that they are not —
    // should not be served Telegram's runtime to read a privacy policy.
  }),
  notFoundComponent: () => (
    <main className="mx-auto w-full max-w-2xl px-5 pt-16">
      <h1 className="text-title font-semibold tracking-tight">404</h1>
      <p className="text-muted-foreground mt-2 text-body">The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

/**
 * The language the document declares.
 *
 * It has to be the language the document is *in*: these pages are a contract in
 * three languages, and a Ukrainian text served as `lang="en"` is one a screen
 * reader pronounces in the wrong voice and a translation tool offers to
 * translate into the language it already is.
 *
 * Read from the URL rather than from a header, for the same reason the pages
 * take it that way: the link a client is sent already names the language, and
 * these routes have no member to read one from. Narrowed here so an unknown
 * `?lang` cannot land in the attribute.
 */
function useDocumentLanguage(): string {
  const lang = useRouterState({
    select: (state) => (state.location.search as { lang?: unknown }).lang,
  })
  return narrowCoachLanguage(typeof lang === "string" ? lang : undefined)
}

/**
 * The document is rendered **scheme-less**: the server cannot know which one it
 * is — the reader's preference lives in their browser's storage, which no
 * request carries — so the class is put on by the blocking script below,
 * synchronously, ahead of the body. That is what keeps the wrong ground off the
 * screen. `suppressHydrationWarning` is there for exactly that: React finds a
 * class it did not render and leaves it alone.
 */
function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={useDocumentLanguage()} suppressHydrationWarning>
      <head>
        <style>{criticalCss}</style>
        {/* oxlint-disable-next-line no-danger -- an inline blocking script is the only thing that runs before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <HeadContent />
      </head>
      <body>
        <ClientTheme />
        {children}
        <Scripts />
      </body>
    </html>
  )
}
