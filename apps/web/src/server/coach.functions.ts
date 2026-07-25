import { createServerFn } from "@tanstack/react-start"
import type { CoachSurface } from "./coach-surface.ts"
import { launchCredential } from "./launch-credential.ts"
import { acceptCoachTerms as acceptCoachTermsRuntime, openCoachApp } from "./runtime.server.ts"

/**
 * Why the coach entry could not open. Like the manager entry beside it, and
 * unlike every admin transport, none of these is a missing page: a coach who
 * opened the app from the wrong place still deserves a screen that says so.
 *
 * `unauthenticated` is undifferentiated by design — an unknown bot, a bad
 * signature, a stale credential and a workspace mid-deletion all arrive as this
 * one word, so the response cannot be used to tell them apart.
 */
export type CoachEntryTransportError = "unauthenticated" | "server"

export type CoachEntryTransportResult =
  | { readonly ok: true; readonly entry: CoachSurface.CoachEntry }
  | { readonly ok: false; readonly error: CoachEntryTransportError }

const transportError = (error: unknown): CoachEntryTransportError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "CoachSession.Unauthenticated"
    ? "unauthenticated"
    : "server"

export const loadCoachEntry = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(async ({ context }): Promise<CoachEntryTransportResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, entry: await openCoachApp(context.credential) }
    } catch (error) {
      return { ok: false, error: transportError(error) }
    }
  })

export type AcceptTermsTransportResult =
  | { readonly ok: true; readonly entry: CoachSurface.CoachEntry }
  | { readonly ok: false; readonly error: CoachEntryTransportError | "stale" }

/**
 * The version travels with the tap so the server can refuse an acceptance made
 * against a document the screen no longer shows. It is a freshness check, never
 * the source of the record — the server writes its own constant.
 */
export const acceptCoachTerms = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator((input: unknown): { readonly version: string } => ({
    version:
      typeof input === "object" &&
      input !== null &&
      "version" in input &&
      typeof input.version === "string"
        ? input.version
        : "",
  }))
  .handler(async ({ context, data }): Promise<AcceptTermsTransportResult> => {
    if (context.credential.initData.length === 0) return { ok: false, error: "unauthenticated" }
    try {
      return { ok: true, entry: await acceptCoachTermsRuntime(context.credential, data.version) }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "_tag" in error &&
        error._tag === "CoachSurface.StaleTermsVersion"
      ) {
        return { ok: false, error: "stale" }
      }
      return { ok: false, error: transportError(error) }
    }
  })
