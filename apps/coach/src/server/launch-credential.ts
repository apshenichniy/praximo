import { createIsomorphicFn, createMiddleware } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import {
  type LaunchCredential,
  resolveLaunchCredential,
} from "@/features/entry/launch-credential.ts"

export type { LaunchCredential }

/**
 * The launch credential travels on the request, not in argument lists.
 *
 * This is the property that keeps deferring Better Auth cheap to reverse (ADR
 * 0006): a cookie later replaces this one module and nothing else — no server
 * function signature, no loader, no query key. It is also why a credential never
 * appears in a React Query key, where it would be both a cache-partitioning
 * accident and a value sitting in devtools.
 *
 * Both trees use it. The admin surface shipped with the credential threaded
 * through eight server functions and their query keys; converting it in the same
 * slice leaves the codebase with one pattern instead of two.
 */
export const INIT_DATA_HEADER = "x-praximo-init-data"
export const BOT_ID_HEADER = "x-praximo-bot-id"

/**
 * Split by the Start compiler, so the server-only header reader never reaches
 * the client bundle. The client half is unreachable — a server function's
 * `.server()` chain only ever runs on the server — and exists to keep the two
 * branches type-identical.
 */
const readLaunchCredential = createIsomorphicFn()
  .server(
    (): LaunchCredential => ({
      initData: getRequestHeader(INIT_DATA_HEADER) ?? "",
      botId: getRequestHeader(BOT_ID_HEADER) ?? "",
    }),
  )
  .client((): LaunchCredential => ({ initData: "", botId: "" }))

/**
 * Attach the credential on the way out, read it on the way in.
 *
 * Applied per server function rather than globally on purpose: the development
 * credential minter is itself a server function, and a global middleware would
 * have it wait on the very promise it is being awaited by.
 */
export const launchCredential = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const credential = await resolveLaunchCredential()
    return next({
      headers: { [INIT_DATA_HEADER]: credential.initData, [BOT_ID_HEADER]: credential.botId },
    })
  })
  .server(({ next }) => next({ context: { credential: readLaunchCredential() } }))
