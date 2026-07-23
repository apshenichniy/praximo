import type { QueryClient } from "@tanstack/react-query"
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router"

import appCss from "@/styles/app.css?url"

const darkThemeColor = "#191c1d"
const darkBackground = "oklch(0.148 0.004 228.8)"
const darkForeground = "oklch(0.987 0.002 197.1)"
const criticalDarkCss = `html,body{background:${darkThemeColor};background:${darkBackground};color:${darkForeground};color-scheme:dark;font-family:"Nunito Sans Variable",ui-sans-serif,system-ui,sans-serif}`

export interface RouterContext {
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: darkThemeColor },
      { title: "Praximo" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <style>{criticalDarkCss}</style>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
