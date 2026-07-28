import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { MiniAppShell } from "@/components/mini-app-shell.tsx"
import { HostFullscreen } from "@/presentation-host/telegram/telegram-fullscreen.tsx"
import {
  attachBackButton,
  claimMainButton,
  enterFullscreen,
  readTelegramInitData,
  revealTelegramWebApp,
  shareInviteMessage,
  watchTelegramColorScheme,
  type HostBackButton,
  type HostMainButton,
  type TelegramWebApp,
} from "@/presentation-host/telegram/bridge.ts"
import { APP_ON_PRIMARY_COLOR, APP_PRIMARY_COLOR, APP_SURFACE_COLOR } from "@/lib/theme.ts"

// The fullscreen requirement (mini-app.md: opens fullscreen via Bot API 8.0
// `requestFullscreen`, with `fullscreenChanged` handling + safe-area insets)
// has one browser-free seam — `enterFullscreen` — plus the SSR shape of the
// frame and the route wiring. The live `requestFullscreen` on a phone is what
// the deploy verifies; these pin the version gate and the layout invariants.

const fakeBackButton = (): HostBackButton => {
  const backButton: HostBackButton = {
    isVisible: false,
    show: vi.fn(() => backButton),
    hide: vi.fn(() => backButton),
    onClick: vi.fn(() => backButton),
    offClick: vi.fn(() => backButton),
  }
  return backButton
}

/**
 * `isVisible` is modelled rather than pinned to `false`, because the handoff
 * reads it: a claim shows the button only when it is down. A fake that never
 * becomes visible reports a second `show()` as if it were the first, which is
 * precisely the animation #198 removed.
 */
const fakeMainButton = (): HostMainButton => {
  const mainButton = {
    isVisible: false,
    setText: vi.fn(() => mainButton),
    setParams: vi.fn(() => mainButton),
    show: vi.fn(() => {
      mainButton.isVisible = true
      return mainButton
    }),
    hide: vi.fn(() => {
      mainButton.isVisible = false
      return mainButton
    }),
    onClick: vi.fn(() => mainButton),
    offClick: vi.fn(() => mainButton),
  }
  return mainButton
}

const fakeWebApp = (overrides: Partial<TelegramWebApp> = {}): TelegramWebApp => ({
  initData: "signed-init-data",
  version: "8.0",
  platform: "ios",
  colorScheme: "dark",
  isFullscreen: false,
  ready: vi.fn(),
  expand: vi.fn(),
  isVersionAtLeast: () => true,
  setHeaderColor: vi.fn(),
  setBackgroundColor: vi.fn(),
  setBottomBarColor: vi.fn(),
  requestFullscreen: vi.fn(),
  disableVerticalSwipes: vi.fn(),
  shareMessage: vi.fn(),
  openTelegramLink: vi.fn(),
  openLink: vi.fn(),
  BackButton: fakeBackButton(),
  MainButton: fakeMainButton(),
  onEvent: vi.fn(),
  offEvent: vi.fn(),
  ...overrides,
})

describe("Telegram admin adapters", () => {
  it("reads non-empty signed initData only", () => {
    expect(readTelegramInitData(fakeWebApp())).toBe("signed-init-data")
    expect(readTelegramInitData(fakeWebApp({ initData: "  " }))).toBeUndefined()
    expect(readTelegramInitData(undefined)).toBeUndefined()
  })

  it("shows the native BackButton and detaches it on route exit", () => {
    const webApp = fakeWebApp()
    const onBack = vi.fn()

    const detach = attachBackButton(webApp, onBack)

    expect(webApp.BackButton.onClick).toHaveBeenCalledWith(onBack)
    expect(webApp.BackButton.show).toHaveBeenCalledOnce()

    detach()
    expect(webApp.BackButton.offClick).toHaveBeenCalledWith(onBack)
    expect(webApp.BackButton.hide).toHaveBeenCalledOnce()
  })

  it("hands the screen's action to the host MainButton in the app's own palette", () => {
    vi.useFakeTimers()
    const webApp = fakeWebApp()
    const onClick = vi.fn()

    const release = claimMainButton(webApp, "Invite a coach", onClick)

    expect(webApp.MainButton.setParams).toHaveBeenCalledWith({
      color: APP_PRIMARY_COLOR.dark,
      text_color: APP_ON_PRIMARY_COLOR.dark,
    })
    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Invite a coach")
    expect(webApp.MainButton.show).toHaveBeenCalledOnce()

    // The host is given a stable wrapper, never the screen's own closure: the
    // closure changes on every render and `offClick` could not remove it.
    expect(webApp.MainButton.onClick).toHaveBeenCalledOnce()
    const bound = vi.mocked(webApp.MainButton.onClick).mock.calls[0]?.[0]
    bound?.()
    expect(onClick).toHaveBeenCalledOnce()

    // Releasing schedules the hide rather than doing it, so the next screen can
    // take the button over without it sliding away and back.
    release()
    expect(webApp.MainButton.hide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(webApp.MainButton.hide).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  /**
   * The blink this whole handoff exists for (#198): every screen mounts its own
   * `HostMainButton`, so a route change released one and claimed the next,
   * and the host animates a `hide()` and a `show()`. Button → button has to be a
   * `setText` and nothing more.
   */
  it("stays on screen when one route hands the button to the next", () => {
    vi.useFakeTimers()
    const webApp = fakeWebApp()

    const releaseFirst = claimMainButton(webApp, "New client", vi.fn())
    releaseFirst()
    claimMainButton(webApp, "New session", vi.fn())
    vi.advanceTimersByTime(200)

    expect(webApp.MainButton.hide).not.toHaveBeenCalled()
    expect(webApp.MainButton.setText).toHaveBeenLastCalledWith("New session")
    // Shown once for the pair, and bound once: a claim per route would otherwise
    // pile handlers up over a session.
    expect(webApp.MainButton.show).toHaveBeenCalledOnce()
    expect(webApp.MainButton.onClick).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it("leaves a pre-6.1 host its own button colors rather than styling it halfway", () => {
    const webApp = fakeWebApp({ version: "6.0", isVersionAtLeast: () => false })

    claimMainButton(webApp, "Invite a coach", vi.fn())

    expect(webApp.MainButton.setParams).not.toHaveBeenCalled()
    expect(webApp.MainButton.show).toHaveBeenCalledOnce()
  })
})

describe("enterFullscreen", () => {
  it("paints the host chrome in the client's scheme before revealing", () => {
    const webApp = fakeWebApp()
    const onChange = vi.fn()

    const detach = enterFullscreen(webApp, onChange)

    expect(webApp.setHeaderColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.dark)
    expect(webApp.setBackgroundColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.dark)
    expect(webApp.setBottomBarColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.dark)
    const [readyOrder = Number.POSITIVE_INFINITY] = vi.mocked(webApp.ready).mock.invocationCallOrder
    expect(vi.mocked(webApp.setHeaderColor).mock.invocationCallOrder[0]).toBeLessThan(readyOrder)
    expect(vi.mocked(webApp.setBackgroundColor).mock.invocationCallOrder[0]).toBeLessThan(
      readyOrder,
    )
    expect(vi.mocked(webApp.setBottomBarColor).mock.invocationCallOrder[0]).toBeLessThan(readyOrder)
    expect(webApp.ready).toHaveBeenCalledOnce()
    expect(webApp.expand).toHaveBeenCalledOnce()
    expect(webApp.requestFullscreen).toHaveBeenCalledOnce()
    expect(webApp.onEvent).toHaveBeenCalledWith("fullscreenChanged", onChange)
    // Syncs the initial state once, up front.
    expect(onChange).toHaveBeenCalledOnce()

    // Swipe-to-minimize is disabled alongside fullscreen on 8.0+ hosts,
    // and before `ready()` like the rest of the host bridge calls.
    expect(webApp.disableVerticalSwipes).toHaveBeenCalledOnce()
    expect(vi.mocked(webApp.disableVerticalSwipes).mock.invocationCallOrder[0]).toBeLessThan(
      readyOrder,
    )

    detach?.()
    expect(webApp.offEvent).toHaveBeenCalledWith("fullscreenChanged", onChange)
  })

  it("only expands on a pre-8.0 host and never requests fullscreen", () => {
    const webApp = fakeWebApp({ version: "7.0", isVersionAtLeast: () => false })
    const onChange = vi.fn()

    const detach = enterFullscreen(webApp, onChange)

    expect(webApp.expand).toHaveBeenCalledOnce()
    expect(webApp.requestFullscreen).not.toHaveBeenCalled()
    expect(webApp.disableVerticalSwipes).not.toHaveBeenCalled()
    expect(webApp.onEvent).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(detach).toBeUndefined()
  })

  it("disables vertical swipes on 7.7–7.x hosts without requesting fullscreen", () => {
    const webApp = fakeWebApp({
      version: "7.10",
      isVersionAtLeast: (version) => version !== "8.0",
    })
    const onChange = vi.fn()

    enterFullscreen(webApp, onChange)

    expect(webApp.disableVerticalSwipes).toHaveBeenCalledOnce()
    const [readyOrder = Number.POSITIVE_INFINITY] = vi.mocked(webApp.ready).mock.invocationCallOrder
    expect(vi.mocked(webApp.disableVerticalSwipes).mock.invocationCallOrder[0]).toBeLessThan(
      readyOrder,
    )
    expect(webApp.expand).toHaveBeenCalledOnce()
    expect(webApp.requestFullscreen).not.toHaveBeenCalled()
  })

  it("uses only host color methods supported by the reported Bot API version", () => {
    const webApp = fakeWebApp({
      isVersionAtLeast: (version) => version === "6.1",
    })

    revealTelegramWebApp(webApp)

    expect(webApp.setBackgroundColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.dark)
    expect(webApp.setHeaderColor).not.toHaveBeenCalled()
    expect(webApp.setBottomBarColor).not.toHaveBeenCalled()
    expect(webApp.disableVerticalSwipes).not.toHaveBeenCalled()
  })
})

describe("the client's colour scheme", () => {
  it("paints the host chrome and the bottom button light when the client is light", () => {
    const webApp = fakeWebApp({ colorScheme: "light" })

    revealTelegramWebApp(webApp)
    claimMainButton(webApp, "Invite a coach", vi.fn())

    expect(webApp.setHeaderColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.light)
    expect(webApp.setBackgroundColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.light)
    expect(webApp.setBottomBarColor).toHaveBeenCalledWith(APP_SURFACE_COLOR.light)
    expect(webApp.MainButton.setParams).toHaveBeenCalledWith({
      color: APP_PRIMARY_COLOR.light,
      text_color: APP_ON_PRIMARY_COLOR.light,
    })
  })

  it("reports the scheme the host is in whenever it moves, and unsubscribes", () => {
    let fire: (() => void) | undefined
    let scheme: "light" | "dark" = "dark"
    const webApp = fakeWebApp({
      onEvent: vi.fn((event: string, handler: () => void) => {
        if (event === "themeChanged") fire = handler
      }),
    })
    // The host mutates its own `colorScheme` and then fires the event; the
    // handler must read it at that moment rather than close over the launch one.
    Object.defineProperty(webApp, "colorScheme", { get: () => scheme })
    const onScheme = vi.fn()

    const detach = watchTelegramColorScheme(webApp, onScheme)

    // Subscribing is not itself a change: the launch scheme is already applied.
    expect(onScheme).not.toHaveBeenCalled()

    scheme = "light"
    fire?.()
    expect(onScheme).toHaveBeenCalledWith("light")

    detach()
    expect(webApp.offEvent).toHaveBeenCalledWith("themeChanged", expect.any(Function))
  })
})

describe("shareInviteMessage", () => {
  const link = "https://t.me/PraximoManagerBot?start=ws_ADA23456"
  const message = `Your Praximo workspace is ready.\n\nOpen this one-time link within 7 days to connect your bot:\n${link}`

  it("prepares on tap and shares the bot message on 8.0+ hosts", async () => {
    const webApp = fakeWebApp({
      shareMessage: vi.fn((_id: string, callback?: (sent: boolean) => void) => callback?.(true)),
    })
    const prepare = vi.fn(async () => "prepared-123")

    const outcome = await shareInviteMessage(webApp, { prepare, link, message })

    expect(outcome).toBe("shared")
    expect(prepare).toHaveBeenCalledOnce()
    expect(webApp.shareMessage).toHaveBeenCalledWith("prepared-123", expect.any(Function))
    expect(webApp.openTelegramLink).not.toHaveBeenCalled()
  })

  it("reports a dismissed picker without preparing twice", async () => {
    const webApp = fakeWebApp({
      shareMessage: vi.fn((_id: string, callback?: (sent: boolean) => void) => callback?.(false)),
    })

    const outcome = await shareInviteMessage(webApp, {
      prepare: async () => "prepared-123",
      link,
      message,
    })

    expect(outcome).toBe("dismissed")
  })

  it("falls back to a share-url on pre-8.0 hosts without preparing", async () => {
    const webApp = fakeWebApp({ version: "7.0", isVersionAtLeast: () => false })
    const prepare = vi.fn(async () => "unused")

    const outcome = await shareInviteMessage(webApp, { prepare, link, message })

    expect(outcome).toBe("fallback")
    expect(prepare).not.toHaveBeenCalled()
    expect(webApp.shareMessage).not.toHaveBeenCalled()
    const [url] = vi.mocked(webApp.openTelegramLink).mock.calls[0] ?? []
    expect(url).toContain("https://t.me/share/url?url=")
    expect(url).toContain(encodeURIComponent(link))
    // The link is the url param; the text is the prose without a duplicate link.
    const text = new URL(url ?? "").searchParams.get("text") ?? ""
    expect(text).toContain("Your Praximo workspace is ready.")
    expect(text).not.toContain(link)
  })

  it("propagates a prepare failure so the caller can offer a retry", async () => {
    const webApp = fakeWebApp()
    const prepare = vi.fn(async () => {
      throw new Error("prepared message expired")
    })

    await expect(shareInviteMessage(webApp, { prepare, link, message })).rejects.toThrow(
      "prepared message expired",
    )
    expect(webApp.shareMessage).not.toHaveBeenCalled()
  })
})

describe("HostFullscreen", () => {
  it("renders nothing (it is a mount-time effect)", () => {
    expect(renderToStaticMarkup(<HostFullscreen />)).toBe("")
  })

  it("is mounted inside the Coach entry route", () => {
    const coachRoute = readFileSync(
      fileURLToPath(new URL("../routes/index.tsx", import.meta.url)),
      "utf8",
    )
    expect(coachRoute).toContain("<HostFullscreen />")
  })
})

describe("MiniAppShell safe-area insets", () => {
  it("pads the frame by the host's device + content safe-area insets", () => {
    const html = renderToStaticMarkup(
      <MiniAppShell>
        <span>content</span>
      </MiniAppShell>,
    )

    expect(html).toContain("--tg-safe-area-inset-top")
    expect(html).toContain("--tg-content-safe-area-inset-top")
  })
})
