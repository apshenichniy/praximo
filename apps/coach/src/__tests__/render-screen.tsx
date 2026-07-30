import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { MiniAppProvider } from "@/mini-app.tsx"

/**
 * One coach screen, rendered to static markup inside a real router.
 *
 * A real router rather than a stub because every screen here carries `Link`s,
 * and a `Link` to a path the tree does not know throws at render — which is a
 * cheap check that the routes a screen points at exist, and the reason a new
 * route belongs in the list below the moment a screen links to it.
 *
 * Shared rather than copied per suite: the second copy is where the route list
 * starts disagreeing with the app's own.
 */
export const renderScreen = async (node: ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({
    component: () => <MiniAppProvider>{node}</MiniAppProvider>,
  })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/clients" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/clients/new" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/clients/$clientId" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/sessions" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/sessions/$sessionId" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/sessions/$sessionId/reschedule" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/main-mini-app" }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return renderToStaticMarkup(<RouterProvider router={router as never} />)
}

/** The same, for screens that print a relative timestamp. */
export const renderWithFormat = (node: ReactNode, locale: "en" | "uk" | "ru" = "en") =>
  renderScreen(
    <TimestampFormatProvider value={coachTimestampFormat(locale)}>{node}</TimestampFormatProvider>,
  )
