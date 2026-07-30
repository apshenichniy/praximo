import { Calendar03Icon } from "@hugeicons-pro/core-stroke-rounded"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage } from "@praximo/domain"
import { clientCopy, DefaultTimeZone, sessionMoment } from "@praximo/i18n"
import { Button } from "@praximo/ui/components/button"
import { Input } from "@praximo/ui/components/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@praximo/ui/components/item"
import { Label } from "@praximo/ui/components/label"
import { useEffect, useId, useState } from "react"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { CoachBadge } from "@/features/invite/coach-badge.tsx"
import { ConsentPane } from "@/features/invite/consent-pane.tsx"
import { GoogleButton, GoogleOutcome, GoogleRule } from "@/features/invite/google-button.tsx"
import type { InviteDraft } from "@/features/invite/invite-draft.ts"
import type { SessionSummary } from "@/features/invite/session-summary.ts"
import { useConsentGate } from "@/features/invite/use-consent-gate.ts"

/**
 * The Acceptance Page — design treatment 05, «Буклет с приветствием» (#57).
 *
 * **One page, no steps.** Form on the left, consent on the right, one commit bar
 * across the bottom, and almost no rules: a single vertical line between the two
 * columns and nothing else. Air, measure and weight carry the hierarchy — that
 * is the difference between a professional document and a dashboard, and it is
 * why the inputs are filled rather than outlined.
 *
 * The greeting sits at the **head of the left column** rather than as a band
 * across the page. A band costs 180px of *both* columns on a 1280 × 800 laptop;
 * a separate greeting screen costs a click everybody pays. This way the vertical
 * is taken from nobody — the right column starts at the top and gets the whole
 * height, and it is the only one that needs height, because it holds five points
 * and the scroll gate.
 */

export interface AcceptanceFormState {
  readonly name: string
  readonly email: string
}

/**
 * What a Google import filled in, and it is only ever these two (#59).
 *
 * The `sub` and the picture never come near the page: they are sealed in a cookie
 * the browser cannot read and are read again, server-side, by the commit. An
 * attestation somebody's page could choose would attest to nothing.
 */
export interface GoogleImported {
  readonly name?: string
  readonly email?: string
  /** `false` when a non-Google domain is attached to the account (#28). */
  readonly emailVerified: boolean
}

/**
 * The draft, as a port rather than as `sessionStorage` reached for directly.
 *
 * The page owns the two fields, so the page is the only thing that can save them
 * before the redirect fallback navigates away — and a port is what lets that be
 * exercised in Node, where this app's suite runs.
 */
export interface DraftStore {
  readonly read: () => InviteDraft | undefined
  readonly write: (draft: InviteDraft) => void
}

/**
 * The import fills what the client did not write, and never overwrites what they
 * did.
 *
 * The button sits above the fields precisely so an import cannot cost the client
 * what they already wrote, and the same rule has to hold when they do it the
 * other way round: type first, then press. A client who wants Google's name
 * instead of their own clears the field, which is one keystroke; a client whose
 * typing was silently replaced has lost something and was never asked.
 *
 * **`suggested` is what makes that rule mean "typed" rather than "non-empty".**
 * The address field arrives pre-filled for every emailed invitation (#58), and
 * treating that as the client's own writing would mean Google's address silently
 * never landed for exactly the clients the invitation reached by email — while
 * the line above the fields told them it had. A value nobody typed is a
 * suggestion, and an import is a better-sourced one.
 *
 * An updater rather than a value, so it composes with `setState` and so the rule
 * is one testable line rather than a branch inside an effect.
 */
export const keepTyped =
  (incoming: string | undefined, suggested?: string) =>
  (current: string): string => {
    if (incoming === undefined) return current
    if (current.length === 0) return incoming
    return suggested !== undefined && current === suggested ? incoming : current
  }

export function AcceptancePage({
  locale,
  coachName,
  coachPhotoSrc,
  session,
  coachTimezone,
  suggestedEmail,
  submitting,
  error,
  onSubmit,
  googleAvailable = false,
  googleBusy = false,
  googleFailed = false,
  imported,
  onGoogleImport,
  draft,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  /** The coach's photo, when the platform has one to serve (#231). */
  readonly coachPhotoSrc?: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
  /**
   * The address the invitation was emailed to, when it was (#58).
   *
   * **The name is not pre-filled and this is** — the two are not the same
   * question. What the coach typed as a name is *their* private label in *their*
   * list («Анна через Марину»), and showing it back would leak it; the address
   * is one this client has already been reached at, and asking them to retype it
   * is asking them to copy it out of the message that brought them here.
   *
   * Editable, always. It is the only address in the product with evidence behind
   * it — mail demonstrably arrived there — so a client who changes it trades a
   * working address for an unverified one; the echo on the result screen is what
   * gives them the chance to notice.
   */
  readonly suggestedEmail?: string
  readonly submitting: boolean
  readonly error?: string
  readonly onSubmit: (state: AcceptanceFormState) => void
  /**
   * Whether there is a Google import to offer at all (#59) — false on a stage
   * with no OAuth client, and on an origin Google has not been told about.
   *
   * The button is then **absent, not disabled**. A dead control on a legally
   * operative page is the placeholder-reads-as-a-promise failure this whole
   * design refuses, and the column reads as finished without it, which is what
   * #57 shipped.
   */
  readonly googleAvailable?: boolean
  /** The popup is open, or its exchange is still in flight. */
  readonly googleBusy?: boolean
  readonly googleFailed?: boolean
  readonly imported?: GoogleImported
  readonly onGoogleImport?: () => void
  readonly draft?: DraftStore
}) {
  const copy = inviteCopy(locale)
  const consentCopy = copy.consent
  const nameId = useId()
  const emailId = useId()
  /**
   * Restored on the way in, so a client coming back from the full-page fallback
   * meets what they typed rather than an empty form.
   *
   * **Lazy initialisers, both of them.** A plain `useState(draft.read())` reads
   * storage on every render and throws all but the first away; the read is
   * synchronous and belongs to mount alone. On the server there is no storage at
   * all, so this is a no-op there and the document renders the same empty form it
   * always did.
   */
  const [name, setName] = useState(() => draft?.read()?.name ?? "")
  // A draft, where there is one, wins over the invitation's own address: it is
  // the more recent truth, including when the client deliberately cleared the
  // field before pressing the button. A draft of two empty strings is not a
  // draft, so restoring one can never blank a pre-filled address.
  const [email, setEmail] = useState(() => {
    const restored = draft?.read()
    return restored === undefined ? (suggestedEmail ?? "") : restored.email
  })
  const { unlocked, sentinelRef } = useConsentGate()

  /** The rule itself is `keepTyped`'s; this is only where it is applied. */
  useEffect(() => {
    if (imported === undefined) return
    setName(keepTyped(imported.name))
    // The suggestion is handed in so the import may replace it: see `keepTyped`.
    setEmail(keepTyped(imported.email, suggestedEmail))
  }, [imported, suggestedEmail])

  /**
   * An identity, which on this page means both fields.
   *
   * Checked **here** and not only on the server, because the commit being
   * unreachable until an identity is given is the spec's own wording — and
   * because a round trip that fails costs more than a wasted request. Each press
   * is counted against a rate limit of five a minute; somebody fumbling an
   * address would spend it and then be told their invitation is no longer open,
   * which is the worst sentence this page owns and would be a lie.
   */
  const identified = name.trim().length > 0 && email.trim().length > 0
  const ready = unlocked && identified && !submitting

  /**
   * What sits beside the commit, in three states.
   *
   * The summary is the point — it makes "nothing is saved until you agree"
   * *checkable*, because what is visible is exactly what travels. But it only
   * says anything once there is something to summarise: rendering it over empty
   * fields produces «Отправляем: , .», which reads as a bug and undermines the
   * one sentence it exists to make credible. Until then the catalogue's own
   * footer says the thing that is true at that moment, and it is the same
   * sentence the bot puts under the same five points.
   */
  const commitNote = !unlocked
    ? consentCopy.locked
    : identified
      ? consentCopy.summary({ name: name.trim(), email: email.trim() })
      : clientCopy(locale).consent.footer

  return (
    // A **container** query, not a media query: the layout answers to its own
    // width rather than to the window's, so it folds correctly wherever it is
    // put. `min-h-0` all the way down is what lets the two columns scroll
    // independently instead of the page scrolling as one.
    <form
      className="@container flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit({ name, email })
      }}
    >
      <div className="flex min-h-0 flex-1 justify-center">
        <div className="flex min-h-0 w-full max-w-[1180px] flex-col">
          <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
            <div className="min-h-0 shrink-0 overflow-y-auto px-5 pt-1.5 pb-6 @3xl:w-[392px] @3xl:px-11 @3xl:pt-3.5 @3xl:pb-[34px]">
              <div className="grid content-start gap-[26px]">
                <Greeting
                  locale={locale}
                  coachName={coachName}
                  {...(coachPhotoSrc === undefined ? {} : { coachPhotoSrc })}
                  {...(session === undefined ? {} : { session })}
                  {...(coachTimezone === undefined ? {} : { coachTimezone })}
                />

                <div className="grid gap-[18px]">
                  {/*
                   * **Continue with Google sits above the fields, and that is a
                   * finding rather than a layout preference** (#59, validated in
                   * prototype #28). Below them, an import either discards what the
                   * client has already typed or has to negotiate with it; above
                   * them, the natural order is press-then-check and there is
                   * nothing to discard.
                   *
                   * It is **absent** rather than disabled when the stage has no
                   * OAuth client or the origin is one Google has not been told
                   * about. A dead control on a legally operative page is exactly
                   * what #57 refused to ship, and the column reads as finished
                   * without it — which is why it could be finished without it.
                   */}
                  {googleAvailable && onGoogleImport !== undefined ? (
                    <div className="grid gap-[18px]">
                      <div className="grid gap-2">
                        {imported === undefined ? (
                          <GoogleButton
                            locale={locale}
                            busy={googleBusy}
                            onPress={() => {
                              // Saved *before* the handler runs, because the
                              // fallback inside it navigates away from this page.
                              draft?.write({ name, email })
                              onGoogleImport()
                            }}
                          />
                        ) : null}
                        {imported === undefined && !googleFailed ? null : (
                          <GoogleOutcome
                            locale={locale}
                            outcome={
                              imported === undefined
                                ? "failed"
                                : imported.emailVerified
                                  ? "done"
                                  : "unverified"
                            }
                          />
                        )}
                      </div>
                      <GoogleRule locale={locale} />
                    </div>
                  ) : null}
                  <Field
                    id={nameId}
                    label={copy.form.nameLabel}
                    // Arrives **empty**. What the coach typed at creation is
                    // their private label — «Анна через Марину» — and showing it
                    // back to the client would leak it. `client.name` keeps it;
                    // this goes into the channel snapshot instead.
                    placeholder={copy.form.namePlaceholder}
                    value={name}
                    onChange={setName}
                    autoComplete="name"
                  />
                  <Field
                    id={emailId}
                    label={copy.form.emailLabel}
                    placeholder={copy.form.emailPlaceholder}
                    value={email}
                    onChange={setEmail}
                    type="email"
                    autoComplete="email"
                    // The consequence, not the obligation. A person reading *why*
                    // types it; a person reading *required* looks for the way
                    // around, and there is no way around — the commit is simply
                    // unreachable until an identity is given.
                    hint={copy.form.emailHint}
                  />
                </div>
              </div>
            </div>

            <div className="border-border min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pt-6 pb-6 @3xl:border-l @3xl:px-11 @3xl:pt-3.5 @3xl:pb-[34px]">
              <ConsentPane locale={locale} coachName={coachName} sentinelRef={sentinelRef} />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-[18px] px-5 pt-3.5 pb-[18px] @3xl:px-11">
            <p
              className={
                error === undefined
                  ? "text-muted-foreground max-w-[54ch] text-xs leading-[1.45]"
                  : "text-destructive max-w-[54ch] text-xs leading-[1.45]"
              }
              // Announced rather than merely shown: on a failed commit the eye is
              // on the button, and the sentence that says what to do next has to
              // reach somebody who is not looking at it.
              role={error === undefined ? undefined : "alert"}
            >
              {error ?? commitNote}
            </p>
            {/*
             * The button's words come from the **consent** catalogue, not from
             * this app's: it is the same legal act the bot's button performs, and
             * naming it twice is how the two surfaces start disagreeing about
             * what was agreed to.
             */}
            <Button type="submit" size="lg" className="min-w-[200px]" disabled={!ready}>
              {clientCopy(locale).consent.agreeButton}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

/**
 * The head of the left column: who is inviting, what happens next, and the
 * session already on the books.
 *
 * This is also where the coach's name lands, and that is load-bearing rather
 * than decorative. The ru/uk consent text says «ваш коуч» instead of declining a
 * proper noun (#222) — a decision that only holds because the surface around it
 * says whose page this is. Remove this block and the page becomes a legally
 * operative document that never names the party it is about.
 */
function Greeting({
  locale,
  coachName,
  coachPhotoSrc,
  session,
  coachTimezone,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  readonly coachPhotoSrc?: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
}) {
  const copy = inviteCopy(locale)

  return (
    <div className="grid justify-items-start gap-3.5">
      <CoachBadge
        locale={locale}
        coachName={coachName}
        {...(coachPhotoSrc === undefined ? {} : { photoSrc: coachPhotoSrc })}
      />
      <div className="grid gap-2">
        <b className="text-[19px] leading-[1.25] font-[620] tracking-[-0.022em] sm:text-xl">
          {copy.greeting.invites(coachName)}
        </b>
        {/*
          No measure cap of its own. A `max-w` here set the lead's width from the
          text rather than from the column, so the greeting, the session plate
          and the fields below them each ended at a different place — three
          ragged right edges in a column whose whole hierarchy is air and
          alignment. The column is the measure; on the two-column layout it is
          392px, which is a good one.
        */}
        <p className="text-muted-foreground text-[13.5px] leading-[1.6]">{copy.greeting.lead}</p>
      </div>
      {session === undefined ? null : (
        <SessionItem
          locale={locale}
          session={session}
          {...(coachTimezone === undefined ? {} : { coachTimezone })}
        />
      )}
      {/* The greeting is set off from the form by a short stroke, not a rule and
          not a band — 56 pixels of border is the whole separation this page uses. */}
      <span className="bg-border mt-0.5 h-px w-14" />
    </div>
  )
}

/**
 * The session already on the books, as a two-line `Item` rather than a chip.
 *
 * **Not tinted.** The primary is this page's one loud colour and it is spent on
 * the commit; a violet plate up here competes with the button for the eye and
 * reads as something to press. `muted` is the right register — the booking is
 * context the client is being *told*, not an action offered to them.
 *
 * Two lines because the two facts are different in kind: which meeting it is,
 * and when. On one line they run together into a string nobody parses; stacked,
 * the date is scannable and the kind is a label above it.
 */
function SessionItem({
  locale,
  session,
  coachTimezone,
}: {
  readonly locale: CoachLanguage
  readonly session: SessionSummary
  readonly coachTimezone?: string
}) {
  const copy = inviteCopy(locale)
  const moment = sessionMoment(
    locale,
    new Date(session.scheduledAt),
    coachTimezone ?? DefaultTimeZone,
  )

  return (
    // Full width, like the fields under it. `w-auto` sized the plate from its
    // own longest line, which put its right edge somewhere between the greeting
    // and the inputs and made the column look accidentally ragged.
    <Item variant="muted" size="sm" className="w-full">
      <ItemMedia variant="icon">
        {/* A plain calendar, not a tick: the meeting is booked, but the client
            has not confirmed anything — they are still reading the page. */}
        <HugeiconsIcon icon={Calendar03Icon} className="text-muted-foreground" strokeWidth={2} />
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle className="text-[13px] font-medium">
          {session.kind === "intake" ? copy.greeting.intake : copy.greeting.session}
        </ItemTitle>
        <ItemDescription className="text-[12.5px]">
          {`${moment.day}, ${moment.time} (${moment.offset})`}
        </ItemDescription>
      </ItemContent>
    </Item>
  )
}

/**
 * Filled, not outlined — `bg-muted` with no border.
 *
 * That is the treatment's central move: the page removes lines rather than
 * adding decoration, and an input that is a shape instead of a box is what stops
 * a column of fields reading as a form on a dashboard.
 */
function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  type,
  autoComplete,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly hint?: string
  readonly type?: string
  readonly autoComplete?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[13.5px] leading-none font-[560]">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        className="bg-muted h-10 rounded-[9px] border-transparent px-[13px] text-[14.5px]"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint === undefined ? null : (
        <span className="text-muted-foreground text-xs leading-[1.45]">{hint}</span>
      )}
    </div>
  )
}
