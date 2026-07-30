import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { coachInput, TransportString } from "./coach-operation.ts"
import { CoachSurface } from "./coach-surface.ts"
import type { CoachResult } from "./coach-transport.ts"
import { launchCredential } from "@/launch-credential.ts"
import { coachOperation } from "./runtime.server.ts"

/**
 * The coach entry's transport. `unauthenticated` is undifferentiated by design —
 * an unknown bot, a bad signature, a stale credential and a workspace
 * mid-deletion all arrive as this one word, so the response cannot be used to
 * tell them apart. It is the shared rule and no longer a second hand-written copy
 * of it (#234): this file is where that copy had drifted to.
 */
export type CoachEntryTransportResult = CoachResult<{ readonly entry: CoachSurface.CoachEntry }>

export const loadCoachEntry = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .handler(
    coachOperation({
      run: (credential) => Effect.flatMap(CoachSurface.Service, (s) => s.openApp(credential)),
      answer: (entry): CoachEntryTransportResult => ({ ok: true, entry }),
    }),
  )

export type AcceptTermsTransportResult = CoachResult<
  { readonly entry: CoachSurface.CoachEntry },
  "stale"
>

/**
 * The version travels with the tap so the server can refuse an acceptance made
 * against a document the screen no longer shows. It is a freshness check, never
 * the source of the record — the server writes its own constant.
 */
const acceptTermsInput = Schema.Struct({ version: TransportString })

export const acceptCoachTerms = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(acceptTermsInput))
  .handler(
    coachOperation({
      failures: { "CoachSurface.StaleTermsVersion": "stale" },
      run: (credential, data: typeof acceptTermsInput.Type) =>
        Effect.flatMap(CoachSurface.Service, (s) => s.acceptTerms(credential, data.version)),
      answer: (entry): AcceptTermsTransportResult => ({ ok: true, entry }),
    }),
  )

/**
 * The coach's language, chosen on onboarding's first step (#130).
 *
 * It travels as a bare string and is validated against the domain schema on the
 * server: the Mini App offers exactly three chips, so anything else is a broken
 * client, and the column behind this is an enum that will not take it anyway —
 * which is why `UnsupportedLanguage` stays a `server` failure rather than earning
 * a word of its own.
 */
const chooseLanguageInput = Schema.Struct({ language: TransportString })

export const chooseCoachLanguage = createServerFn({ method: "POST" })
  .middleware([launchCredential])
  .validator(coachInput(chooseLanguageInput))
  .handler(
    coachOperation({
      run: (credential, data: typeof chooseLanguageInput.Type) =>
        Effect.flatMap(CoachSurface.Service, (s) => s.chooseLanguage(credential, data.language)),
      answer: (entry): CoachEntryTransportResult => ({ ok: true, entry }),
    }),
  )
