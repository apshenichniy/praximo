import type { CoachLanguage } from "@praximo/domain"
import { clientCopy, legalUrl } from "@praximo/i18n"
import { PraximoMark } from "@praximo/ui"

import { inviteCopy } from "@/features/i18n/invite-copy.ts"

/**
 * The consent, which on this page *is* the commit (#57).
 *
 * Rendered **structurally** from `@praximo/i18n` rather than as the bot's one
 * string: a heading, a paragraph, an ordered list, and the privacy policy as an
 * ordinary link in a new tab. The words are the catalogue's, unchanged — the
 * version recorded on acceptance is a digest of exactly this text, so agreement
 * with the bot's record holds by construction as long as nothing here re-authors
 * it. A modal was rejected: it would trap nine sections and a subprocessor table
 * inside a sheet on a phone.
 */
export function ConsentPane({
  locale,
  coachName,
  sentinelRef,
}: {
  readonly locale: CoachLanguage
  readonly coachName: string
  /**
   * Sits after the last point. When it has been on screen the commit unlocks —
   * see `use-consent-gate.ts` for why an already-fitting pane unlocks at once.
   */
  readonly sentinelRef?: React.RefObject<HTMLDivElement | null>
}) {
  const consent = clientCopy(locale).consent
  const copy = inviteCopy(locale)

  return (
    // The wash needs a clipping box, and the box has to be the column: five
    // paragraphs make an almost square block, which is the one place on the page
    // the mark fits at its native proportion without taking a single pixel from
    // anything.
    <div className="relative overflow-hidden">
      <MarkWash />

      {/*
       * A grid with the measured gaps, and deliberately **not** `.typeset`.
       *
       * The plan called for the prose layer here, and trying it is what showed
       * why it does not fit: `.typeset` owns the flow *between authored blocks*,
       * and this pane has none. Every row is designed — a monospaced eyebrow, a
       * 31px title, a 52ch lead, five paragraphs hung off numerals in the margin
       * — so the layer's job reduces to supplying margins that every child then
       * opts out of. #223's consumers are the legal texts and rendered artifact
       * markdown, where the blocks really do arrive from somewhere else.
       */}
      <div className="relative grid gap-[26px]">
        <div className="grid gap-3.5">
          <span className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.14em] uppercase">
            {copy.consent.eyebrow}
          </span>
          <h1 className="text-[25px] leading-[1.12] font-semibold tracking-[-0.03em] text-balance sm:text-[31px]">
            {consent.title}
          </h1>
          <p className="text-muted-foreground max-w-[52ch] text-[15px] leading-[1.72] sm:text-[16.5px]">
            {consent.lead(coachName)}
          </p>
        </div>

        {/*
         * Numbered paragraphs with a large light numeral in the margin, not
         * bulleted rows in boxes — the numeral is the only graphic gesture in the
         * column, and it is what keeps five legal sentences reading as a document
         * rather than as a checklist.
         */}
        <ol className="grid list-none gap-[26px] p-0">
          {consent.points(coachName).map((point, index) => (
            <li
              key={point}
              className="grid grid-cols-[44px_1fr] items-start gap-3.5 p-0 marker:content-none"
            >
              {/*
                Quiet on light, much less quiet on dark — and the asymmetry is
                forced rather than chosen. The baseline's `--primary` is *darker*
                in dark mode than in light (L 0.432 against 0.491), so the 40%
                that reads as a soft violet on white lands almost on the
                background on black. The numeral has to carry the list's
                structure at a glance; below roughly this it stops being a
                numeral and becomes a smudge.
              */}
              <span className="text-primary/40 dark:text-primary/85 pt-0.5 text-[26px] leading-none font-light tracking-[-0.03em] tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="text-muted-foreground m-0 text-[15.5px] leading-[1.72]">{point}</p>
            </li>
          ))}
        </ol>

        <a
          className="text-primary w-fit text-[15px] font-medium underline underline-offset-[3px]"
          // Root-relative, and the empty origin is the point. The policy lives on
          // *this* Worker, so no origin is needed — and reading one off `window`
          // would mean the server rendered a different `href` from the client,
          // which React reports as a hydration mismatch it will not patch up.
          // `legalUrl` is still what builds it, so a renamed route cannot leave a
          // dead link inside a consent flow.
          href={legalUrl("", "privacy", locale)}
          // A new tab, because leaving this page mid-acceptance would throw away
          // everything the client has typed — nothing is stored until the commit.
          target="_blank"
          rel="noreferrer"
        >
          {consent.privacyButton} ↗
        </a>

        <div ref={sentinelRef} aria-hidden="true" />
      </div>
    </div>
  )
}

/**
 * The mark, washed under the text at the column's full width.
 *
 * Never a crop. `preserveAspectRatio: slice` in a tall narrow column reduces the
 * lockup to two arbitrary diagonal bands; at its native proportion it stays
 * recognisably the mark, only quieter. Nothing is drawn here that is not already
 * the brand — which is also why there is no stock illustration to defend.
 *
 * 7% on light and 13% on dark. The asymmetry once ran the other way, on the
 * reasoning that the dark master is the brighter casting and equal opacity would
 * make it louder — which was true of the artwork and false of the result. A wash
 * is read as the *difference* from the ground it sits on, and there is far less
 * of that difference to spend on near-black than on white: 6% left the mark
 * effectively absent on dark, which is not quiet, it is missing.
 */
function MarkWash() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-[5%] opacity-[0.07] dark:opacity-[0.13]"
    >
      <PraximoMark size="fluid" guidePointOpacity={0.45} />
    </span>
  )
}
