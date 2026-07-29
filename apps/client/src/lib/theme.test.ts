import { afterEach, describe, expect, it } from "vitest"

import {
  APP_SURFACE_COLOR,
  applyColorScheme,
  readColorScheme,
  readThemePreference,
  THEME_BOOTSTRAP,
  THEME_STORAGE_KEY,
  writeThemePreference,
  type ColorScheme,
  type ThemePreference,
} from "@/lib/theme.ts"

// The scheme is settled before the first paint by a string of plain ES5 in the
// document head — there is no module to import and no browser to run it in, so
// the string itself is evaluated here against fake globals. Anything less would
// only be inspecting it.

/** What the one scheme-following `<link rel="icon">` looks like to these functions. */
interface FakeIcon {
  href: string
  readonly dataset: { readonly light: string; readonly dark: string }
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
}

const fakeIcon = (): FakeIcon => {
  const icon: FakeIcon = {
    href: "/light.ico",
    dataset: { light: "/light.ico", dark: "/dark.ico" },
    getAttribute: (name) =>
      name === "data-light"
        ? icon.dataset.light
        : name === "data-dark"
          ? icon.dataset.dark
          : name === "href"
            ? icon.href
            : null,
    setAttribute: (name, value) => {
      if (name === "href") icon.href = value
    },
  }
  return icon
}

/**
 * `querySelector` answers *per selector* rather than returning one stub for
 * everything: `applyColorScheme` asks for two different elements now, and a fake
 * that hands the same object to both would let a mix-up pass.
 */
const fakeDocument = (
  classes: Iterable<string> = [],
  meta: { content: string } | null = null,
  icon: FakeIcon | null = null,
) => {
  const set = new Set(classes)
  return {
    classes: set,
    icon,
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
    querySelector: (selector: string) => (selector.startsWith("link") ? icon : meta),
  }
}

/** A store that answers, one that is empty, or one that throws on every access. */
const fakeStorage = (stored?: string | "throws") => {
  if (stored === "throws") {
    return {
      getItem: () => {
        throw new Error("SecurityError: the operation is insecure")
      },
      setItem: () => {
        throw new Error("SecurityError: the operation is insecure")
      },
      removeItem: () => {
        throw new Error("SecurityError: the operation is insecure")
      },
    }
  }
  const map = new Map<string, string>(stored === undefined ? [] : [[THEME_STORAGE_KEY, stored]])
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

const bootstrap = (options: {
  readonly stored?: string | "throws"
  /** `undefined` stands for a browser without `matchMedia` at all. */
  readonly prefersDark?: boolean
}): ColorScheme => {
  const document = fakeDocument()
  const window = {
    localStorage: fakeStorage(options.stored),
    matchMedia:
      options.prefersDark === undefined
        ? undefined
        : (query: string) => ({ matches: query.includes("dark") === options.prefersDark }),
  }

  new Function("window", "document", THEME_BOOTSTRAP)(window, document)

  return document.classes.has("dark") ? "dark" : "light"
}

describe("THEME_BOOTSTRAP", () => {
  it("follows the browser's own preference when the reader has not chosen", () => {
    expect(bootstrap({ prefersDark: true })).toBe("dark")
    expect(bootstrap({ prefersDark: false })).toBe("light")
  })

  /**
   * The whole reason the preference has three values. A reader who chose light
   * chose it *knowing* what their browser said, so the browser does not get to
   * overrule them at sunset.
   */
  it("lets a stored choice beat the browser's preference", () => {
    expect(bootstrap({ stored: "light", prefersDark: true })).toBe("light")
    expect(bootstrap({ stored: "dark", prefersDark: false })).toBe("dark")
  })

  it("treats a stored `system` as no choice at all", () => {
    expect(bootstrap({ stored: "system", prefersDark: true })).toBe("dark")
    expect(bootstrap({ stored: "system", prefersDark: false })).toBe("light")
  })

  it("falls through to the preference when the stored value is not one of the two", () => {
    expect(bootstrap({ stored: "sepia", prefersDark: true })).toBe("dark")
    expect(bootstrap({ stored: "", prefersDark: true })).toBe("dark")
  })

  /**
   * Safari in private browsing throws on `localStorage` rather than returning
   * null. A page that took that as fatal would paint no scheme at all.
   */
  it("survives a storage that throws, and still asks the browser", () => {
    expect(bootstrap({ stored: "throws", prefersDark: true })).toBe("dark")
    expect(bootstrap({ stored: "throws", prefersDark: false })).toBe("light")
  })

  /**
   * Light, not dark — unlike the Mini App, whose fallback is the dark it shipped
   * with. Light is what `:root` carries with no class on the document, so the
   * failure mode here is the document doing nothing rather than guessing.
   */
  it("leaves the light ground on when nothing can be asked", () => {
    expect(bootstrap({})).toBe("light")
    expect(bootstrap({ stored: "throws" })).toBe("light")
  })
})

describe("the stored preference", () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    globalThis.window = originalWindow
  })

  const withStorage = (stored?: string | "throws") => {
    const storage = fakeStorage(stored)
    // @ts-expect-error — the fake carries only what these functions touch.
    globalThis.window = { localStorage: storage }
    return storage
  }

  it("reads back the two explicit choices", () => {
    withStorage("light")
    expect(readThemePreference()).toBe("light")
    withStorage("dark")
    expect(readThemePreference()).toBe("dark")
  })

  it("reports `system` for an absent, unrecognised or unreadable store", () => {
    for (const stored of [undefined, "sepia", "throws" as const]) {
      withStorage(stored)
      expect(readThemePreference()).toBe("system")
    }
  })

  /**
   * `system` clears the key rather than storing the word: the absence of a
   * preference is exactly what it means, and the bootstrap reads it that way
   * with one fewer branch.
   */
  it("stores a choice, and clears the key for `system`", () => {
    const storage = withStorage("dark")

    writeThemePreference("light")
    expect(storage.map?.get(THEME_STORAGE_KEY)).toBe("light")

    writeThemePreference("system")
    expect(storage.map?.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it("does not throw when the choice cannot be persisted", () => {
    withStorage("throws")

    for (const preference of ["system", "light", "dark"] as ReadonlyArray<ThemePreference>) {
      expect(() => writeThemePreference(preference)).not.toThrow()
    }
  })
})

describe("applyColorScheme", () => {
  const originalDocument = globalThis.document

  afterEach(() => {
    globalThis.document = originalDocument
  })

  const withDocument = (
    classes: Iterable<string>,
    meta: { content: string } | null,
    icon: FakeIcon | null = null,
  ) => {
    const document = fakeDocument(classes, meta, icon)
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

  /**
   * The favicon follows the *reader's* scheme, not the browser's.
   *
   * This is the whole reason it is written here rather than left to a `media`
   * attribute on the link: a reader on a light system who chooses Dark got a
   * dark page wearing the icon cast for pale ground, and the media query had no
   * way to know they had chosen anything.
   */
  it("recasts the favicon for the scheme", () => {
    const icon = fakeIcon()
    withDocument([], { content: "" }, icon)

    applyColorScheme("dark")
    expect(icon.href).toBe("/dark.ico")

    applyColorScheme("light")
    expect(icon.href).toBe("/light.ico")
  })

  it("still sets the scheme on a document with no favicon link", () => {
    const document = withDocument([], { content: "" }, null)

    applyColorScheme("dark")

    expect(document.classes.has("dark")).toBe(true)
  })
})
