import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AdminShell } from "@/components/admin-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import {
  attachBackButton,
  attachMainButton,
  enterFullscreen,
  readTelegramInitData,
  revealTelegramWebApp,
  shareInviteMessage,
  type TelegramBackButton,
  type TelegramMainButton,
  type TelegramWebApp,
} from "@/lib/telegram.ts"
import { APP_DARK_COLOR, APP_ON_PRIMARY_COLOR, APP_PRIMARY_COLOR } from "@/lib/theme.ts"

// The fullscreen requirement (mini-app.md: opens fullscreen via Bot API 8.0
// `requestFullscreen`, with `fullscreenChanged` handling + safe-area insets)
// has one browser-free seam — `enterFullscreen` — plus the SSR shape of the
// frame and the route wiring. The live `requestFullscreen` on a phone is what
// the deploy verifies; these pin the version gate and the layout invariants.

const fakeBackButton = (): TelegramBackButton => {
  const backButton: TelegramBackButton = {
    isVisible: false,
    show: vi.fn(() => backButton),
    hide: vi.fn(() => backButton),
    onClick: vi.fn(() => backButton),
    offClick: vi.fn(() => backButton),
  }
  return backButton
}

const fakeMainButton = (): TelegramMainButton => {
  const mainButton: TelegramMainButton = {
    isVisible: false,
    setText: vi.fn(() => mainButton),
    setParams: vi.fn(() => mainButton),
    show: vi.fn(() => mainButton),
    hide: vi.fn(() => mainButton),
    onClick: vi.fn(() => mainButton),
    offClick: vi.fn(() => mainButton),
  }
  return mainButton
}

const fakeWebApp = (overrides: Partial<TelegramWebApp> = {}): TelegramWebApp => ({
  initData: "signed-init-data",
  version: "8.0",
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
    const webApp = fakeWebApp()
    const onClick = vi.fn()

    const detach = attachMainButton(webApp, "Invite a coach", onClick)

    expect(webApp.MainButton.setParams).toHaveBeenCalledWith({
      color: APP_PRIMARY_COLOR,
      text_color: APP_ON_PRIMARY_COLOR,
    })
    expect(webApp.MainButton.setText).toHaveBeenCalledWith("Invite a coach")
    expect(webApp.MainButton.onClick).toHaveBeenCalledWith(onClick)
    expect(webApp.MainButton.show).toHaveBeenCalledOnce()

    detach()
    expect(webApp.MainButton.offClick).toHaveBeenCalledWith(onClick)
    expect(webApp.MainButton.hide).toHaveBeenCalledOnce()
  })

  it("leaves a pre-6.1 host its own button colors rather than styling it halfway", () => {
    const webApp = fakeWebApp({ version: "6.0", isVersionAtLeast: () => false })

    attachMainButton(webApp, "Invite a coach", vi.fn())

    expect(webApp.MainButton.setParams).not.toHaveBeenCalled()
    expect(webApp.MainButton.show).toHaveBeenCalledOnce()
  })
})

describe("enterFullscreen", () => {
  it("sets dark host chrome before revealing and requesting fullscreen", () => {
    const webApp = fakeWebApp()
    const onChange = vi.fn()

    const detach = enterFullscreen(webApp, onChange)

    expect(webApp.setHeaderColor).toHaveBeenCalledWith(APP_DARK_COLOR)
    expect(webApp.setBackgroundColor).toHaveBeenCalledWith(APP_DARK_COLOR)
    expect(webApp.setBottomBarColor).toHaveBeenCalledWith(APP_DARK_COLOR)
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

    expect(webApp.setBackgroundColor).toHaveBeenCalledWith(APP_DARK_COLOR)
    expect(webApp.setHeaderColor).not.toHaveBeenCalled()
    expect(webApp.setBottomBarColor).not.toHaveBeenCalled()
    expect(webApp.disableVerticalSwipes).not.toHaveBeenCalled()
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

describe("TelegramFullscreen", () => {
  it("renders nothing (it is a mount-time effect)", () => {
    expect(renderToStaticMarkup(<TelegramFullscreen />)).toBe("")
  })

  it("is mounted inside the admin route frame", () => {
    const adminRoute = readFileSync(
      fileURLToPath(new URL("../routes/admin/route.tsx", import.meta.url)),
      "utf8",
    )
    expect(adminRoute).toContain("<TelegramFullscreen />")
  })
})

describe("AdminShell safe-area insets", () => {
  it("pads the frame by the host's device + content safe-area insets", () => {
    const html = renderToStaticMarkup(
      <AdminShell>
        <span>content</span>
      </AdminShell>,
    )

    expect(html).toContain("--tg-safe-area-inset-top")
    expect(html).toContain("--tg-content-safe-area-inset-top")
  })
})
