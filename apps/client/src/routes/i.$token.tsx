import { type CoachLanguage, narrowCoachLanguage } from "@praximo/domain"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { AcceptancePage, type AcceptanceFormState } from "@/features/invite/acceptance-page.tsx"
import { InviteShell } from "@/features/invite/invite-shell.tsx"
import { ConfirmationScreen, RefusalScreen } from "@/features/invite/notice-screen.tsx"
import { acceptInvite, openInvite } from "@/server/invite.functions.ts"
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
  validateSearch: (search: Record<string, unknown>): { readonly lang?: CoachLanguage } =>
    typeof search.lang === "string" ? { lang: narrowCoachLanguage(search.lang) } : {},
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
  const { lang } = Route.useSearch()
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
        if (result.kind === "accepted") return setAccepted(result.view)
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
    />,
  )
}
