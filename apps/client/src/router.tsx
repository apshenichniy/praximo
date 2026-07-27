import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen.ts"

/**
 * The client app's router.
 *
 * Deliberately thinner than the Mini App's: there is no QueryClient in the
 * context and no SSR-query integration, because nothing on these pages is a
 * query. The legal texts are compiled into the bundle and the acceptance page
 * (#57) will load its invitation through a route loader. When the first real
 * query arrives, so does the integration — not before.
 */
export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // One page replacing another, handled by the browser. Where view
    // transitions are unsupported the navigation is simply instant.
    defaultViewTransition: true,
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
