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

/** The `oklch(L C H)` triple a token is authored as. Alpha forms are not read. */
const token = (scheme: "light" | "dark", name: string): readonly [number, number, number] => {
  const block = appCss.match(scheme === "light" ? /:root\s*{([^}]*)}/s : /\.dark\s*{([^}]*)}/s)?.[1]
  const raw = block?.match(new RegExp(`--${name}:\\s*oklch\\(([^)]*)\\)`))?.[1]
  if (raw === undefined) throw new Error(`${scheme} --${name} is not an opaque oklch value`)

  const [l = 0, c = 0, h = 0] = raw.trim().split(/\s+/).map(Number)
  return [l, c, h]
}

const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

const toSrgb = ([L, C, H]: readonly [number, number, number]): ReadonlyArray<number> => {
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

/** WCAG 2 relative luminance, then the ratio the guidelines are stated in. */
const contrast = (scheme: "light" | "dark", name: string): number => {
  const ink = luminance(toSrgb(token(scheme, name)))
  const ground = luminance(toSrgb(token(scheme, "background")))
  const brighter = Math.max(ink, ground)
  const darker = Math.min(ink, ground)

  return (brighter + 0.05) / (darker + 0.05)
}

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
})
