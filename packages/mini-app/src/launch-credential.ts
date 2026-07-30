import { createIsomorphicFn, createMiddleware } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"

import {
  type LaunchCredential,
  launchCredentialFromHeaders,
  launchCredentialHeaders,
} from "./launch-credential-core.ts"

export * from "./launch-credential-core.ts"

/**
 * Attach the launch credential on the way out and read it on the way in.
 *
 * This TanStack Start module is a separate package subpath so importing the
 * browser host adapter never pulls server middleware into a client bundle.
 * A Better Auth cookie later replaces this one transport seam (ADR 0006).
 */
export const createLaunchCredentialMiddleware = (
  resolveLaunchCredential: () => Promise<LaunchCredential>,
) => {
  const readLaunchCredential = createIsomorphicFn()
    .server((): LaunchCredential => launchCredentialFromHeaders(getRequestHeader))
    .client((): LaunchCredential => ({ initData: "", botId: "" }))

  return createMiddleware({ type: "function" })
    .client(async ({ next }) =>
      next({ headers: launchCredentialHeaders(await resolveLaunchCredential()) }),
    )
    .server(({ next }) => next({ context: { credential: readLaunchCredential() } }))
}
