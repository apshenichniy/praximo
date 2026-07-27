import { useId } from "react"

import { cn } from "@/lib/utils.ts"

/**
 * The Praximo mark — the Guiding Orbit, drawn rather than spelled (#173).
 *
 * Until this, four screens rendered the brand as the literal letter **P** on a
 * violet disc. The artwork exists now (#145) and lives in
 * `assets/branding/coach-bot/{light,dark}/avatar-transparent.svg`; this
 * component is that artwork's only entry into the app, so replacing it when the
 * masters change is one file.
 *
 * **No disc.** The mark is a complete lockup — an orbit around a figure,
 * reaching a point — and it is not set inside the `brand-disc` gradient the
 * letter needed. That gradient runs violet-700 → indigo-950, and the orbit's own
 * darker end is violet-700: the lower-left of the ring would sink into the
 * ground it was placed on. The transparent masters are cut for exactly this —
 * "the mark for placement over a matching themed surface", per their README.
 *
 * **Both grounds ship.** The two masters share their geometry to the coordinate
 * and differ only in colour, so the geometry below is written once and coloured
 * twice. Which one is shown is CSS's decision, not this component's: the scheme
 * comes from the Telegram client, and `lib/theme.ts` puts the class on <html>
 * ahead of the first paint (#190) — long after the server rendered this.
 */

interface Stop {
  readonly offset?: number
  readonly color: string
  readonly opacity?: number
}

interface Palette {
  /** The ring passing behind the figure, lower-left to upper-right. */
  readonly orbitBack: ReadonlyArray<Stop>
  /** The shorter arc crossing in front of it. */
  readonly orbitFront: ReadonlyArray<Stop>
  /** Head and body, one flat fill. */
  readonly figure: string
  /** The glow around the guiding point. The point itself stays white. */
  readonly halo: ReadonlyArray<Stop>
}

/**
 * Transcribed from the masters, stop for stop. The figure inverts between them
 * — deep indigo on a pale ground, pale indigo on a dark one — which is why this
 * is two palettes and not one set of tokens with a tint applied.
 */
const PALETTE = {
  light: {
    orbitBack: [
      { color: "#312e81" },
      { offset: 0.48, color: "#5b21d3" },
      { offset: 0.82, color: "#7c3aed" },
      { offset: 1, color: "#c084fc" },
    ],
    orbitFront: [
      { color: "#4c1d95" },
      { offset: 0.52, color: "#6d28d9" },
      { offset: 1, color: "#8b5cf6" },
    ],
    figure: "#3730a3",
    halo: [
      { offset: 0, color: "#a855f7", opacity: 0.45 },
      { offset: 0.42, color: "#a855f7", opacity: 0.2 },
      { offset: 1, color: "#a855f7", opacity: 0 },
    ],
  },
  dark: {
    orbitBack: [
      { color: "#7c3aed" },
      { offset: 0.5, color: "#8b5cf6" },
      { offset: 0.82, color: "#a855f7" },
      { offset: 1, color: "#ddd6fe" },
    ],
    orbitFront: [
      { color: "#7c3aed" },
      { offset: 0.52, color: "#a855f7" },
      { offset: 1, color: "#c084fc" },
    ],
    figure: "#c4b5fd",
    halo: [
      { offset: 0, color: "#a78bfa", opacity: 0.6 },
      { offset: 0.42, color: "#a78bfa", opacity: 0.28 },
      { offset: 1, color: "#a78bfa", opacity: 0 },
    ],
  },
} as const satisfies Record<"light" | "dark", Palette>

/** The ring behind the figure. */
const ORBIT_BACK_PATH =
  "M198 401C126 374 84 316 84 247 84 155 163 80 253 79c51-1 95 14 126 43-30-12-60-16-92-16-93 0-172 63-172 142 0 64 30 117 83 153Z"

/** The arc crossing in front of it. */
const ORBIT_FRONT_PATH =
  "M402 151c20 64-5 127-51 164-28 23-60 33-92 36 12-21 26-36 45-48 47-31 88-79 98-152Z"

/** Shoulders and torso, reaching towards the point. */
const FIGURE_BODY_PATH =
  "M319 290c-27 10-46 12-66 12-31 0-48 20-48 49 0 39 19 76 47 102-4-40-6-78 3-109 9-28 29-44 64-54Z"

const renderStops = (stops: ReadonlyArray<Stop>) =>
  stops.map((stop) => (
    <stop
      key={`${stop.offset ?? 0}-${stop.color}`}
      offset={stop.offset}
      stopColor={stop.color}
      stopOpacity={stop.opacity}
    />
  ))

/**
 * One copy of the mark. `idPrefix` namespaces the gradients: a `url(#…)` is
 * resolved against the whole document, so two marks sharing a page — or the
 * light and dark copies of a single one — would otherwise collapse onto
 * whichever definition came first, painting one of them in the other's colours.
 */
function MarkArtwork({
  palette,
  idPrefix,
  size,
  className,
}: {
  readonly palette: Palette
  readonly idPrefix: string
  readonly size: number
  readonly className: string
}) {
  const orbitBackId = `${idPrefix}-orbit-back`
  const orbitFrontId = `${idPrefix}-orbit-front`
  const haloId = `${idPrefix}-guide-halo`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient
          id={orbitBackId}
          x1="90"
          y1="326"
          x2="387"
          y2="109"
          gradientUnits="userSpaceOnUse"
        >
          {renderStops(palette.orbitBack)}
        </linearGradient>
        <linearGradient
          id={orbitFrontId}
          x1="260"
          y1="350"
          x2="409"
          y2="152"
          gradientUnits="userSpaceOnUse"
        >
          {renderStops(palette.orbitFront)}
        </linearGradient>
        <radialGradient id={haloId}>{renderStops(palette.halo)}</radialGradient>
      </defs>

      <path d={ORBIT_BACK_PATH} fill={`url(#${orbitBackId})`} />
      <path d={ORBIT_FRONT_PATH} fill={`url(#${orbitFrontId})`} />

      <circle cx="253" cy="238" r="43" fill={palette.figure} />
      <path d={FIGURE_BODY_PATH} fill={palette.figure} />

      <circle cx="389" cy="134" r="43" fill={`url(#${haloId})`} />
      <circle cx="389" cy="134" r="15.5" fill="#fff" />
    </svg>
  )
}

/**
 * Decorative throughout: every screen that carries the mark names Praximo in
 * words within the same frame — a heading underneath it, or the status label on
 * the loading frame's own wrapper — so an accessible name here would only
 * repeat what is already said.
 */
export function PraximoMark({
  size,
  className,
}: {
  /** Edge of the square the mark is drawn in, in pixels. */
  readonly size: number
  readonly className?: string
}) {
  // React's own ids carry punctuation that would have to be escaped wherever a
  // fragment reference is written; the mark only needs them to be distinct.
  const unique = useId().replace(/[^a-zA-Z0-9]/g, "")

  return (
    // `flex w-fit`, not `inline-flex`: an inline-level box sits on the parent's
    // baseline with the line's descender beneath it, which makes the mark's
    // footprint several pixels taller than the size asked for — and a frame
    // that swaps the mark for something else then moves. `flex` also blockifies
    // the two copies inside, so no line box forms in here either. `w-fit` keeps
    // it shrink-wrapped, so `mx-auto` still centres it in a block container.
    <span aria-hidden="true" className={cn("flex w-fit shrink-0", className)}>
      <MarkArtwork
        palette={PALETTE.light}
        idPrefix={`praximo-mark-light-${unique}`}
        size={size}
        className="dark:hidden"
      />
      <MarkArtwork
        palette={PALETTE.dark}
        idPrefix={`praximo-mark-dark-${unique}`}
        size={size}
        className="hidden dark:block"
      />
    </span>
  )
}
