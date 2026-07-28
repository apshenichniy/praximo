import { afterEach, describe, expect, it } from "vitest"

import {
  APP_SURFACE_COLOR,
  applyColorScheme,
  COLOR_SCHEME_BOOTSTRAP,
  readColorScheme,
  type ColorScheme,
} from "@/lib/theme.ts"

// The scheme is settled before the first paint by a string of plain ES5 in the
// document head — there is no module to import and no browser to run it in, so
// the string itself is evaluated here against fake globals. Anything less would
// only be inspecting it.

const fakeDocument = (classes: Iterable<string> = [], meta: { content: string } | null = null) => {
  const set = new Set(classes)
  return {
    classes: set,
    documentElement: {
      classList: {
        toggle: (token: string, force?: boolean) => {
          if (force ?? !set.has(token)) set.add(token)
          else set.delete(token)
        },
        add: (token: string) => void set.add(token),
        contains: (token: string) => set.has(token),
      },
    },
    querySelector: () => meta,
  }
}

const bootstrap = (options: {
  readonly hash?: string
  /** `undefined` stands for a host without `matchMedia` at all. */
  readonly prefersLight?: boolean
}): ColorScheme => {
  const document = fakeDocument()
  const window = {
    matchMedia:
      options.prefersLight === undefined
        ? undefined
        : (query: string) => ({ matches: query.includes("light") === options.prefersLight }),
  }

  new Function("window", "document", "location", COLOR_SCHEME_BOOTSTRAP)(window, document, {
    hash: options.hash ?? "",
  })

  return document.classes.has("dark") ? "dark" : "light"
}

const themeParams = (background: string): string =>
  `#tgWebAppData=user%3D1&tgWebAppVersion=8.0&tgWebAppThemeParams=${encodeURIComponent(
    JSON.stringify({ bg_color: background, text_color: "#000000" }),
  )}`

describe("COLOR_SCHEME_BOOTSTRAP", () => {
  it("reads the scheme off the Telegram launch's own background colour", () => {
    // Telegram's light and dark chat backgrounds, verbatim.
    expect(bootstrap({ hash: themeParams("#ffffff"), prefersLight: false })).toBe("light")
    expect(bootstrap({ hash: themeParams("#17212b"), prefersLight: true })).toBe("dark")
  })

  it("accepts the colour with or without its hash and in either case", () => {
    expect(bootstrap({ hash: themeParams("FFFFFF"), prefersLight: false })).toBe("light")
    expect(bootstrap({ hash: themeParams("#1D2733"), prefersLight: true })).toBe("dark")
  })

  it("follows the browser's own preference outside a Telegram launch", () => {
    expect(bootstrap({ prefersLight: true })).toBe("light")
    expect(bootstrap({ prefersLight: false })).toBe("dark")
  })

  it("falls through to the preference when the launch params are unreadable", () => {
    expect(bootstrap({ hash: "#tgWebAppThemeParams=not-json", prefersLight: true })).toBe("light")
    expect(bootstrap({ hash: themeParams("teal"), prefersLight: true })).toBe("light")
    expect(bootstrap({ hash: themeParams("#fff"), prefersLight: true })).toBe("light")
  })

  it("keeps the dark the app shipped with when nothing can be asked", () => {
    expect(bootstrap({})).toBe("dark")
  })
})

describe("applyColorScheme", () => {
  const originalDocument = globalThis.document

  // Restores the Node global the fake stood in for.
  afterEach(() => {
    globalThis.document = originalDocument
  })

  const withDocument = (classes: Iterable<string>, meta: { content: string } | null) => {
    const document = fakeDocument(classes, meta)
    // @ts-expect-error — the fake carries only what these two functions touch.
    globalThis.document = document
    return document
  }

  it("puts the scheme on the document and repaints the browser's own chrome", () => {
    const meta = { content: "" }
    const document = withDocument(["dark"], meta)

    applyColorScheme("light")
    expect(document.classes.has("dark")).toBe(false)
    expect(meta.content).toBe(APP_SURFACE_COLOR.light)
    expect(readColorScheme()).toBe("light")

    applyColorScheme("dark")
    expect(document.classes.has("dark")).toBe(true)
    expect(meta.content).toBe(APP_SURFACE_COLOR.dark)
    expect(readColorScheme()).toBe("dark")
  })

  it("still sets the scheme on a document with no theme-color meta", () => {
    const document = withDocument([], null)

    applyColorScheme("dark")

    expect(document.classes.has("dark")).toBe(true)
  })
})
