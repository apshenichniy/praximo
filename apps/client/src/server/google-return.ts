import "@tanstack/react-start/server-only"

import type { CoachLanguage } from "@praximo/domain"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { ImportedFlag, ImportSignal } from "@/features/invite/google-signal.ts"
import {
  clearCookieHeader,
  cookieHeader,
  ImportCookie,
  ImportLifetimeMillis,
  type ImportMode,
  StateCookie,
  StateLifetimeMillis,
} from "./google-import.ts"

/**
 * How a Google import gets the client back to the page they left (#59), whichever
 * way they left it.
 *
 * **Two ways out, one shape.** The popup posts a bare signal to the page that
 * opened it and closes; the full-page fallback redirects back to the invitation.
 * Neither carries anything about the person: the signal is `{ ok }` and the
 * redirect is the same URL the client was already on plus a one-character flag.
 * Everything the import learned is in a sealed cookie, read server-side, so a
 * `postMessage` that somehow reached the wrong window would leak nothing and a
 * URL in somebody's history names nobody.
 *
 * That is also why the fallback exists at all. `window.open` returns nothing when
 * a browser blocks popups, and Google refuses OAuth outright inside embedded
 * webviews — a client who meets either must land back on their form with what
 * they typed, not on an error.
 */

/** `mode` off a query string, defaulting to the popup the page tries first. */
export const readMode = (value: string | null): ImportMode =>
  value === "redirect" ? "redirect" : "popup"

/**
 * Whether the cookies may be marked `Secure`.
 *
 * Safari refuses a `Secure` cookie over plain http, and local development is
 * plain http on `localhost` — so the flag follows the request rather than being
 * hard-coded on, which would make the import undevelopable on one browser and
 * mysteriously so.
 */
export const isSecure = (url: URL): boolean => url.protocol === "https:"

/** A refusal with nothing in it, for a request that was never one of ours. */
export const refuse = (status: number): Response => new Response(null, { status })

/**
 * The document the popup ends on.
 *
 * **No interpolation of anything but a boolean literal**, so there is no escaping
 * question here at all — the profile never comes near this HTML. The message is
 * addressed to this exact origin, and the opener checks the same thing from its
 * side.
 *
 * The visible sentence is for the rare browser that will not let a script close
 * a window it opened. A blank white popup that stays open is a bug report; one
 * sentence in the client's own language is not.
 */
const popupDocument = (ok: boolean, language: CoachLanguage): string => {
  const copy = inviteCopy(language)
  return `<!doctype html>
<html lang="${language}">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Google</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;color:#3f3f46">
<p>${copy.form.googleClose}</p>
<script>
(function () {
  try {
    if (window.opener) {
      window.opener.postMessage(
        { source: ${JSON.stringify(ImportSignal)}, ok: ${ok ? "true" : "false"} },
        window.location.origin,
      )
    }
  } catch (error) {}
  window.close()
})()
</script>
</body>
</html>`
}

/**
 * Off to Google, carrying the state that has to come back.
 *
 * The one response in this flow that is not a return: everything else here puts
 * the client back on their own page.
 */
export const toGoogle = (input: {
  readonly authorize: string
  readonly state: string
  readonly secure: boolean
}): Response =>
  new Response(null, {
    status: 302,
    headers: {
      location: input.authorize,
      "set-cookie": cookieHeader(StateCookie, input.state, {
        secure: input.secure,
        maxAgeMillis: StateLifetimeMillis,
      }),
    },
  })

export interface ReturnInput {
  readonly token: string
  readonly language: CoachLanguage
  readonly mode: ImportMode
  readonly secure: boolean
  /** Whether there is an import waiting to be read, or the client is empty-handed. */
  readonly ok: boolean
  /** The sealed profile, when there is one to hand over. */
  readonly sealed?: string
}

/**
 * Back to the invitation, with the state cookie cleared either way.
 *
 * Clearing is unconditional and deliberate: a `state` is spent the moment its
 * callback runs, and one left behind is a nonce that could be presented again.
 * The import cookie is only ever set on the way out of a successful exchange.
 */
export const returnToPage = (input: ReturnInput): Response => {
  const headers = new Headers()
  headers.append("set-cookie", clearCookieHeader(StateCookie, { secure: input.secure }))
  if (input.sealed !== undefined) {
    headers.append(
      "set-cookie",
      cookieHeader(ImportCookie, input.sealed, {
        secure: input.secure,
        maxAgeMillis: ImportLifetimeMillis,
      }),
    )
  }

  if (input.mode === "popup") {
    headers.set("content-type", "text/html; charset=utf-8")
    return new Response(popupDocument(input.ok, input.language), { status: 200, headers })
  }

  // Both outcomes, because the fallback has nothing but this URL to say either
  // with. `0` costs no request — it says there is nothing to fetch, and the page
  // shows the one line acknowledging that the client pressed and got nothing.
  const search = new URLSearchParams({ lang: input.language, [ImportedFlag]: input.ok ? "1" : "0" })
  headers.set("location", `/i/${encodeURIComponent(input.token)}?${search.toString()}`)
  return new Response(null, { status: 302, headers })
}
