import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The two schemes have to be equally readable, and eyeballing a palette does not
 * establish that (#194).
 *
 * The light ground shipped with the preset's own `--muted-foreground`, which put
 * secondary text at 4.6:1 on white where the dark scheme had it at 8.1:1 on
 * near-black. Nothing in the diff looked wrong — one token, straight from the
 * registry — and the whole app came out pale, because secondary text is most of
 * what these screens are made of. So the invariant is asserted rather than
 * trusted: a token may be retuned, but not until it reads on its own ground.
 */

const appCss = readFileSync(fileURLToPath(new URL("../styles/app.css", import.meta.url)), "utf8")

/** `oklch(L C H)` or `oklch(L C H / P%)`, as authored. Alpha defaults to 1. */
const token = (
  scheme: "light" | "dark",
  name: string,
): readonly [number, number, number, number] => {
  const block = appCss.match(scheme === "light" ? /:root\s*{([^}]*)}/s : /\.dark\s*{([^}]*)}/s)?.[1]
  const raw = block?.match(new RegExp(`--${name}:\\s*oklch\\(([^)]*)\\)`))?.[1]
  if (raw === undefined) throw new Error(`${scheme} --${name} is not an oklch value`)

  const [colour = "", alpha] = raw.split("/")
  const [l = 0, c = 0, h = 0] = colour.trim().split(/\s+/).map(Number)
  return [l, c, h, alpha === undefined ? 1 : Number.parseFloat(alpha) / 100]
}

const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

const toSrgb = ([L, C, H]: readonly [number, number, number, number]): ReadonlyArray<number> => {
  const hue = (H * Math.PI) / 180
  const a = C * Math.cos(hue)
  const b = C * Math.sin(hue)
  const long = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((channel) => Math.min(1, Math.max(0, gamma(channel))))
}

const linear = (channel = 0) =>
  channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

const luminance = (colour: ReadonlyArray<number>) =>
  0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2])

/** A translucent token painted onto an opaque one, the way a browser does it. */
const composite = (
  scheme: "light" | "dark",
  ink: string,
  ground: string,
): ReadonlyArray<number> => {
  const [, , , alpha = 1] = token(scheme, ink)
  const over = toSrgb(token(scheme, ink))
  const under = toSrgb(token(scheme, ground))

  return over.map((channel, index) => channel * alpha + (under[index] ?? 0) * (1 - alpha))
}

const contrastOf = (one: number, other: number) =>
  (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)

/** WCAG 2 relative luminance, then the ratio the guidelines are stated in. */
const ratio = (scheme: "light" | "dark", a: string, b: string): number =>
  contrastOf(luminance(toSrgb(token(scheme, a))), luminance(toSrgb(token(scheme, b))))

/** The common case: something against the ground it is read on. */
const contrast = (scheme: "light" | "dark", name: string): number =>
  ratio(scheme, name, "background")

describe("scheme contrast parity", () => {
  it("reads running text the same in either scheme", () => {
    expect(contrast("light", "foreground")).toBeGreaterThan(15)
    expect(contrast("dark", "foreground")).toBeGreaterThan(15)
  })

  it("keeps secondary text within reach of its counterpart", () => {
    const light = contrast("light", "muted-foreground")
    const dark = contrast("dark", "muted-foreground")

    // Both comfortably past AA for body text, and neither scheme conceding a
    // third of its readability to the other.
    expect(light).toBeGreaterThan(6.5)
    expect(dark).toBeGreaterThan(6.5)
    expect(Math.abs(light - dark) / Math.max(light, dark)).toBeLessThan(0.2)
  })

  it("still lets secondary text recede from running text", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(contrast(scheme, "muted-foreground")).toBeLessThan(
        contrast(scheme, "foreground") * 0.65,
      )
    }
  })

  /**
   * Elevation needs something to be elevated against (#195). The light ground
   * shipped with page, card and popover all `oklch(1 0 0)`, so a bottom sheet
   * was white on white and a card existed only by its shadow — the same class of
   * miss as the text one above, and equally invisible in a diff.
   */
  it("raises cards and sheets off the page in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const raised of ["card", "popover"]) {
        expect(ratio(scheme, raised, "background")).toBeGreaterThan(1.05)
      }
      // And a recessed fill sits off the surface it is cut into, not off the page.
      expect(ratio(scheme, "muted", "card")).toBeGreaterThan(1.1)
    }
  })

  /**
   * Light only: the dark scheme authors `--border` as white at 10%, and this
   * reader takes opaque oklch. Light is where the hairline has two grounds to
   * hold on — a white card and a page that is no longer white — so it is the
   * one that can go wrong quietly.
   */
  it("keeps a light hairline visible on both grounds it crosses", () => {
    expect(ratio("light", "border", "card")).toBeGreaterThan(1.2)
    expect(ratio("light", "border", "background")).toBeGreaterThan(1.15)
  })

  /**
   * A press has to answer *and* stay on its own surface (#196). `--pressed` was
   * an opaque `accent/70` tuned against a white page; once the page receded, a
   * pressed row came to rest on the page's own colour — 1.01:1 against the
   * ground behind the card, which reads as a hole rather than as a press. Ink
   * cannot drift that way, and this is the assertion that says so.
   */
  it("answers a press without landing on the page", () => {
    for (const scheme of ["light", "dark"] as const) {
      const pressedOnCard = luminance(composite(scheme, "pressed", "card"))
      const card = luminance(toSrgb(token(scheme, "card")))
      const page = luminance(toSrgb(token(scheme, "background")))

      // Visible against the surface it is pressed on…
      expect(contrastOf(pressedOnCard, card)).toBeGreaterThan(1.15)
      // …and not mistakable for the ground the card sits on.
      //
      // Relaxed from 1.1 in #198. The defect this guards was a pressed row
      // landing on the page's *own* colour — 1.01:1, a hole cut through the
      // card — and anything past about 1.04 is already not that. The higher
      // floor had a cost: with the page lightened it forced the wash to 11%
      // black, and a full-width row at that weight reads as a second surface
      // rather than as the moment somebody's thumb is down. The card is where
      // the press has to be legible, and that is the assertion above.
      expect(contrastOf(pressedOnCard, page)).toBeGreaterThan(1.04)
    }
  })
})
