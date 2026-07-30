import { type CoachLanguage, narrowCoachLanguage } from "@praximo/domain"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import {
  AcceptancePage,
  type AcceptanceFormState,
  type GoogleImported,
} from "@/features/invite/acceptance-page.tsx"
import { InviteShell } from "@/features/invite/invite-shell.tsx"
import {
  clearDraft,
  readDraft,
  sessionDraftStorage,
  writeDraft,
} from "@/features/invite/invite-draft.ts"
import { ConfirmationScreen, RefusalScreen } from "@/features/invite/notice-screen.tsx"
import { ImportedFlag, ImportSignal } from "@/features/invite/google-signal.ts"
import { acceptInvite, googleImport, openInvite } from "@/server/invite.functions.ts"
import type { WebAcceptance } from "@/server/web-acceptance.ts"

/**
 * The Acceptance Page (#57) — the first product route in this Worker.
 *
 * `/i/` rather than `/invite/` because the coach pastes this link by hand into
 * other messengers, where every character is one the client may have to read
 * back to them.
 *
 * Server-rendered, like the legal texts beside it: the invitation is read on the
 * server anyway, and the client this is handed to should meet a finished page
 * rather than a blank one and a bundle.
 *
 * **Language rides `?lang`**, which is the same search parameter the root
 * document already reads to set `<html lang>`. That matters more here than on
 * the legal pages: this text is a contract, and a Ukrainian consent served as
 * `lang="en"` is one a screen reader pronounces in the wrong voice. A first load
 * without the parameter redirects to the invitation's own language, so the URL
 * describes what is on screen from the first paint — and changing the control
 * re-renders in place, losing nothing, because nothing is stored yet.
 */
export const Route = createFileRoute("/i/$token")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { readonly lang?: CoachLanguage; readonly g?: "1" | "0" } => ({
    ...(typeof search.lang === "string" ? { lang: narrowCoachLanguage(search.lang) } : {}),
    // The redirect fallback's one-character flag (#59): `1` there is an import
    // to read, `0` the client came back empty-handed. It says nothing about who
    // — the profile is in a cookie the page cannot read, and a URL in somebody's
    // history names nobody.
    ...(search[ImportedFlag] === "1" || search[ImportedFlag] === "0"
      ? { g: search[ImportedFlag] as "1" | "0" }
      : {}),
  }),
  /**
   * **No `loaderDeps`, and the absence is the feature.**
   *
   * Keying the loader on `lang` would re-run it on every switch of the header
   * control — a database read each time, counted against the lookup limit — and
   * a throttled switch answers `unknown`, which would replace a form the client
   * has been filling in with the page that names nobody. Changing the language
   * has to lose nothing; re-fetching what it is rendering is how it would.
   *
   * The redirect below still sees the current URL through `location`, and the
   * cache keyed on the token alone is what stops it looping: after the redirect
   * lands, the loader is not re-run at all.
   */
  loader: async ({ params, location }) => {
    const outcome = await openInvite({ data: { token: params.token } })
    const lang = (location.search as { readonly lang?: string }).lang

    // Every outcome, refusals included, and not as a nicety: `__root.tsx` sets
    // `<html lang>` from this search parameter, so a page served without it
    // declares English over whatever it actually says. A Ukrainian refusal
    // marked `lang="en"` is one a screen reader pronounces in the wrong voice
    // and a translation tool offers to translate into the language it already
    // is. One extra hop on first open is the whole cost.
    if (lang === undefined) {
      throw redirect({
        to: "/i/$token",
        params: { token: params.token },
        search: { lang: outcome.language },
        replace: true,
      })
    }

    return outcome
  },
  component: AcceptanceRoute,
})

function AcceptanceRoute() {
  const outcome = Route.useLoaderData()
  const { lang, g } = Route.useSearch()
  const params = Route.useParams()
  const router = useRouter()

  // The page speaks whatever the header control last said. A refusal speaks the
  // invitation's own language — its reader never reached the page and so never
  // named one — and an unknown token, having no invitation, speaks whatever the
  // browser asked for. All three arrive on the outcome; none of them is "en
  // because nothing else was to hand".
  const locale: CoachLanguage = lang ?? outcome.language

  /**
   * Where the coach's photo lives, when there is one (#231).
   *
   * The invitation's own address — no object key in it, and nothing here has to
   * know one: the route behind it resolves the key from this same token. Built once
   * because all three screens below show the coach.
   */
  const coachPhotoSrc = `/i/${encodeURIComponent(params.token)}/coach-avatar`

  const [accepted, setAccepted] = useState<WebAcceptance.ConfirmationView>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  const [imported, setImported] = useState<GoogleImported>()
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleFailed, setGoogleFailed] = useState(false)

  /**
   * What the import filled in, asked for rather than delivered (#59).
   *
   * **One reader, whichever way the client came back.** The popup posts a bare
   * `{ ok }` and the fallback carries a one-character flag; neither carries a
   * name, an address or the attestation. So a `postMessage` that somehow reached
   * the wrong window leaks nothing, and there is one place — not two — that
   * decides what an import filled in.
   */
  const collectImport = useCallback(() => {
    setGoogleBusy(true)
    void googleImport()
      .then((profile) => {
        if (profile === null) return setGoogleFailed(true)
        setGoogleFailed(false)
        setImported(profile)
      })
      .catch(() => setGoogleFailed(true))
      .finally(() => setGoogleBusy(false))
  }, [])

  /**
   * The full-page fallback landed back here, and its flag says which it was.
   *
   * `0` is a client who pressed the button, looked at Google's screen and came
   * back with nothing — declined, or a webview Google refuses to run OAuth in.
   * They are told so in one quiet line rather than left wondering whether the
   * press registered; nothing is fetched, because there is nothing to fetch.
   */
  useEffect(() => {
    if (g === "1") collectImport()
    else if (g === "0") setGoogleFailed(true)
  }, [g, collectImport])

  /**
   * The popup's way back.
   *
   * The origin is checked because `message` is a public event — anything with a
   * handle on this window can post one — and the shape is checked because being
   * same-origin is not the same as being ours.
   */
  useEffect(() => {
    if (typeof window === "undefined") return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { readonly source?: unknown; readonly ok?: unknown } | null
      if (data === null || typeof data !== "object" || data.source !== ImportSignal) return
      if (data.ok === true) collectImport()
      else {
        setGoogleBusy(false)
        setGoogleFailed(true)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [collectImport])

  /**
   * Press the button: a popup first, a full-page redirect when there is no popup
   * to be had.
   *
   * `window.open` has to run **synchronously inside the click** or the browser
   * blocks it, which is why it opens a same-origin route that builds the
   * authorization URL rather than waiting for one. A blocked popup returns
   * `null`, and that is the whole of the detection — after which the draft is
   * already saved and the page navigates away in its place.
   *
   * Embedded webviews are the case neither arm can rescue: Google refuses OAuth
   * inside them outright. They land on the redirect arm, come back empty-handed,
   * and meet the fields that were always the way through.
   */
  const startGoogleImport = () => {
    setGoogleFailed(false)
    setGoogleBusy(true)
    // The draft is already saved: the page writes it on the press, because the
    // page is the only thing holding the two fields.

    const start = (mode: "popup" | "redirect") =>
      `/auth/google/start?token=${encodeURIComponent(params.token)}&lang=${locale}&mode=${mode}`

    const popup = window.open(start("popup"), "praximo-google", "popup,width=520,height=640")
    if (popup === null) {
      window.location.assign(start("redirect"))
      return
    }

    // A client who closes the popup without deciding anything sends no message,
    // so the only way to stop the button spinning is to watch for the window
    // going away. Closing it is not a failure and says so: nothing is marked,
    // the fields are as they were left.
    const watch = window.setInterval(() => {
      if (!popup.closed) return
      window.clearInterval(watch)
      setGoogleBusy((busy) => (busy ? false : busy))
    }, 400)
  }

  const changeLanguage = (next: CoachLanguage) => {
    void router.navigate({
      to: "/i/$token",
      params: { token: params.token },
      search: { lang: next },
      replace: true,
    })
  }

  const shell = (children: React.ReactNode) => (
    <InviteShell locale={locale} onLanguageChange={changeLanguage}>
      {children}
    </InviteShell>
  )

  if (accepted !== undefined) {
    return shell(
      <ConfirmationScreen
        locale={locale}
        coachName={accepted.coachName}
        {...(accepted.coachHasPhoto ? { coachPhotoSrc } : {})}
        email={accepted.email}
        {...(accepted.session === undefined ? {} : { session: accepted.session })}
        {...(accepted.coachTimezone === undefined ? {} : { coachTimezone: accepted.coachTimezone })}
      />,
    )
  }

  if (outcome.kind !== "open") {
    return shell(
      <RefusalScreen
        locale={locale}
        kind={outcome.kind}
        {...(outcome.kind === "unknown" ? {} : { coachName: outcome.coachName })}
        {...(outcome.kind !== "unknown" && outcome.coachHasPhoto ? { coachPhotoSrc } : {})}
      />,
    )
  }

  const submit = (state: AcceptanceFormState) => {
    setSubmitting(true)
    setError(undefined)
    const copy = inviteCopy(locale)

    void acceptInvite({
      data: { token: params.token, name: state.name, email: state.email, language: locale },
    })
      .then((result) => {
        if (result.kind === "accepted") {
          // Committed, so the draft has nothing left to protect. The import
          // cookie is cleared by the same response, server-side.
          clearDraft(sessionDraftStorage(), params.token)
          return setAccepted(result.view)
        }
        // Every field stays in memory on a failure, and a retry cannot create
        // anything twice — acceptance is gated on `status = 'pending'`, so the
        // safety of pressing again is a property of the statement rather than of
        // this handler being careful.
        setError(
          result.kind === "stale"
            ? copy.refusal.stale
            : result.field === "name"
              ? copy.form.nameInvalid
              : copy.form.emailInvalid,
        )
      })
      .catch(() => setError(inviteCopy(locale).failure))
      .finally(() => setSubmitting(false))
  }

  return shell(
    <AcceptancePage
      locale={locale}
      coachName={outcome.coachName}
      {...(outcome.coachHasPhoto ? { coachPhotoSrc } : {})}
      {...(outcome.session === undefined ? {} : { session: outcome.session })}
      {...(outcome.coachTimezone === undefined ? {} : { coachTimezone: outcome.coachTimezone })}
      {...(outcome.suggestedEmail === undefined ? {} : { suggestedEmail: outcome.suggestedEmail })}
      submitting={submitting}
      {...(error === undefined ? {} : { error })}
      onSubmit={submit}
      googleAvailable={outcome.googleAvailable}
      googleBusy={googleBusy}
      googleFailed={googleFailed}
      {...(imported === undefined ? {} : { imported })}
      onGoogleImport={startGoogleImport}
      draft={{
        // Only the fallback ever reads one back — the popup leaves this page
        // standing — so the read is the return leg of a navigation that already
        // happened, and the write is what makes that leg safe.
        read: () => readDraft(sessionDraftStorage(), params.token),
        write: (draft) => writeDraft(sessionDraftStorage(), params.token, draft),
      }}
    />,
  )
}
