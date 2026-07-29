import { Calendar03Icon } from "@hugeicons-pro/core-stroke-rounded"
import { HugeiconsIcon } from "@hugeicons/react"
import type { CoachLanguage } from "@praximo/domain"
import { clientCopy, DefaultTimeZone, sessionMoment } from "@praximo/i18n"
import { Avatar, AvatarFallback } from "@praximo/ui/components/avatar"
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
import { useId, useState } from "react"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"
import { ConsentPane } from "@/features/invite/consent-pane.tsx"
import { initials } from "@/features/invite/initials.ts"
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

export interface SessionSummary {
  readonly scheduledAt: string
  readonly durationMinutes: number
  readonly kind: string
}

export interface AcceptanceFormState {
  readonly name: string
  readonly email: string
}

export function AcceptancePage({
  locale,
  coachName,
  session,
  coachTimezone,
  submitting,
  error,
  onSubmit,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
  readonly submitting: boolean
  readonly error?: string
  readonly onSubmit: (state: AcceptanceFormState) => void
}) {
  const copy = inviteCopy(locale)
  const consentCopy = copy.consent
  const nameId = useId()
  const emailId = useId()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const { unlocked, sentinelRef } = useConsentGate()

  const ready = unlocked && !submitting

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
    : name.trim().length > 0 && email.trim().length > 0
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
                  {...(session === undefined ? {} : { session })}
                  {...(coachTimezone === undefined ? {} : { coachTimezone })}
                />

                <div className="grid gap-[18px]">
                  {/*
                   * Google sits **above** the typed fields, because an import
                   * placed below them discards what the client already wrote —
                   * validated in prototype #28. It arrives separately with #59;
                   * until then this is a disabled affordance rather than a gap,
                   * and the column has to look finished either way.
                   */}
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full font-[540]"
                    disabled
                  >
                    <GoogleG />
                    {copy.form.google}
                  </Button>
                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    <span className="bg-border h-px flex-1" />
                    {copy.form.or}
                    <span className="bg-border h-px flex-1" />
                  </div>

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
  session,
  coachTimezone,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  readonly session?: SessionSummary
  readonly coachTimezone?: string
}) {
  const copy = inviteCopy(locale)

  return (
    <div className="grid justify-items-start gap-3.5">
      <Avatar className="ring-background outline-primary/45 size-[60px] ring-[3px] outline-[1.5px]">
        <AvatarFallback className="bg-secondary text-secondary-foreground text-xl font-[620]">
          {initials(coachName)}
        </AvatarFallback>
      </Avatar>
      <div className="grid gap-2">
        <b className="text-[19px] leading-[1.25] font-[620] tracking-[-0.022em] sm:text-xl">
          {copy.greeting.invites(coachName)}
        </b>
        <p className="text-muted-foreground max-w-[33ch] text-[13.5px] leading-[1.6]">
          {copy.greeting.lead}
        </p>
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
    <Item variant="muted" size="sm" className="w-auto max-w-full">
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

/** Google's own mark arrives with #59; until then the button carries a placeholder. */
function GoogleG() {
  return (
    <span
      aria-hidden="true"
      className="border-border grid size-[17px] place-items-center rounded-full border font-mono text-[10px] font-bold"
    >
      G
    </span>
  )
}
