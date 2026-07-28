import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen.ts"

/**
 * The client app's router.
 *
 * Deliberately thinner than the Mini App's: there is no QueryClient in the
 * context and no SSR-query integration, because nothing on these pages is a
 * query. The legal texts are compiled into the bundle. When the first real
 * query arrives in a future issue, so does the integration — not before.
 */
export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
