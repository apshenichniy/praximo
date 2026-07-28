export type OklchColor = {
  readonly lightness: number
  readonly chroma: number
  readonly hue: number
}

type Rgb = readonly [red: number, green: number, blue: number]

const numberPattern = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`
const oklchPattern = new RegExp(
  String.raw`^oklch\(\s*(${numberPattern})(%)?\s+(${numberPattern})\s+(none|${numberPattern})(?:deg)?\s*\)$`,
  "i",
)
const hexPattern = /^#(?:[\da-f]{3}|[\da-f]{6})$/i

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value))

const clean = (value: number, precision: number) => {
  const rounded = Number(value.toFixed(precision))
  return Object.is(rounded, -0) ? 0 : rounded
}

function parseOklch(value: string): OklchColor | null {
  const match = oklchPattern.exec(value.trim())
  if (match === null) return null

  const rawLightness = Number(match[1])
  const lightness = match[2] === "%" ? rawLightness / 100 : rawLightness
  const chroma = Number(match[3])
  const rawHue = match[4]?.toLowerCase() === "none" ? 0 : Number(match[4])

  if (
    !Number.isFinite(lightness) ||
    !Number.isFinite(chroma) ||
    !Number.isFinite(rawHue) ||
    lightness < 0 ||
    lightness > 1 ||
    chroma < 0
  ) {
    return null
  }

  return {
    lightness,
    chroma,
    hue: ((rawHue % 360) + 360) % 360,
  }
}

export function formatOklch(color: OklchColor): string {
  return `oklch(${clean(color.lightness, 6)} ${clean(color.chroma, 6)} ${clean(color.hue, 3)})`
}

export function normalizeOklch(value: string): string | null {
  const color = parseOklch(value)
  return color === null ? null : formatOklch(color)
}

function linearizeSrgb(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function encodeSrgb(channel: number): number {
  const clamped = clamp(channel)
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
}

function hexToRgb(value: string): Rgb | null {
  if (!hexPattern.test(value)) return null

  const source = value.slice(1)
  const normalized =
    source.length === 3
      ? source
          .split("")
          .map((channel) => channel.repeat(2))
          .join("")
      : source
  const numeric = Number.parseInt(normalized, 16)
  return [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255]
}

export function hexToOklch(value: string): string | null {
  const rgb = hexToRgb(value)
  if (rgb === null) return null

  const [red, green, blue] = rgb.map(linearizeSrgb) as unknown as Rgb
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const chroma = Math.sqrt(a ** 2 + b ** 2)
  const hue = chroma < 0.000001 ? 0 : (Math.atan2(b, a) * 180) / Math.PI

  return formatOklch({ lightness, chroma, hue: ((hue % 360) + 360) % 360 })
}

function oklchToLinearRgb(value: string): Rgb | null {
  const color = parseOklch(value)
  if (color === null) return null

  const hue = (color.hue * Math.PI) / 180
  const a = color.chroma * Math.cos(hue)
  const b = color.chroma * Math.sin(hue)
  const lRoot = color.lightness + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = color.lightness - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = color.lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function oklchToHex(value: string): string {
  const rgb = oklchToLinearRgb(value)
  if (rgb === null) return "#000000"

  return `#${rgb
    .map((channel) =>
      Math.round(encodeSrgb(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

export function relativeLuminance(value: string): number {
  const rgb = oklchToLinearRgb(value)
  if (rgb === null) {
    throw new Error(`Unsupported color: ${value}`)
  }

  const [red, green, blue] = rgb.map((channel) => clamp(channel)) as unknown as Rgb
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}
