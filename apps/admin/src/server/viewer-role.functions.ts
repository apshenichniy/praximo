import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { transportWord } from "./admin-transport.ts"
import { launchCredential } from "@/launch-credential.ts"
import { runAdmin } from "./runtime.server.ts"
import { ViewerRole } from "./viewer-role.ts"

/**
 * Why the entry could not name a role. Neither answer is a missing page: a
 * rejected credential is a broken entry and an unknown-but-valid viewer is a
 * real person, so both keep rendering a screen rather than a 404 (#106).
 */
export type ViewerRoleTransportError = "unauthenticated" | "server"

export type ViewerRoleTransportResult =
  | { readonly ok: true; readonly role: ViewerRole.Role }
  | { readonly ok: false; readonly error: ViewerRoleTransportError }

/**
 * The entry gate. Unlike every admin transport beside it, this one never throws
 * `notFound()`: it is the call a non-admin is *expected* to make, and its whole
 * job is to say which screen that person gets.
 *
 * A missing credential is answered without reaching the verifier — an empty
 * `initData` cannot be verified, and the client already renders the same landing
 * for it.
 */
export const loadViewerRole = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<ViewerRoleTransportResult> => {
    const initData = context.credential.initData
    if (initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      const role = await runAdmin(
        Effect.flatMap(ViewerRole.Service, (s) => s.resolveRole(initData)),
      )
      return { ok: true, role }
    } catch (error) {
      // `transportWord` rather than `adminRefusal`: this is the one admin endpoint
      // that must never answer with a missing page, so it takes the mapping and
      // leaves the tree's `AccessDenied` rule alone — which it could not hit
      // anyway, since `resolveRole` cannot fail that way.
      return {
        ok: false,
        error: transportWord(error, { "ViewerRole.Unauthenticated": "unauthenticated" }),
      }
    }
  })
