import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AdminShell } from "@/components/admin-shell.tsx"
import { TelegramFullscreen } from "@/components/telegram-fullscreen.tsx"
import {
  attachBackButton,
  enterFullscreen,
  readTelegramInitData,
  type TelegramBackButton,
  type TelegramWebApp,
} from "@/lib/telegram.ts"

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

const fakeWebApp = (overrides: Partial<TelegramWebApp> = {}): TelegramWebApp => ({
  initData: "signed-init-data",
  version: "8.0",
  isFullscreen: false,
  ready: vi.fn(),
  expand: vi.fn(),
  isVersionAtLeast: () => true,
  requestFullscreen: vi.fn(),
  BackButton: fakeBackButton(),
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
})

describe("enterFullscreen", () => {
  it("expands and requests fullscreen on a Bot API 8.0+ host", () => {
    const webApp = fakeWebApp()
    const onChange = vi.fn()

    const detach = enterFullscreen(webApp, onChange)

    expect(webApp.ready).toHaveBeenCalledOnce()
    expect(webApp.expand).toHaveBeenCalledOnce()
    expect(webApp.requestFullscreen).toHaveBeenCalledOnce()
    expect(webApp.onEvent).toHaveBeenCalledWith("fullscreenChanged", onChange)
    // Syncs the initial state once, up front.
    expect(onChange).toHaveBeenCalledOnce()

    detach?.()
    expect(webApp.offEvent).toHaveBeenCalledWith("fullscreenChanged", onChange)
  })

  it("only expands on a pre-8.0 host and never requests fullscreen", () => {
    const webApp = fakeWebApp({ version: "7.0", isVersionAtLeast: () => false })
    const onChange = vi.fn()

    const detach = enterFullscreen(webApp, onChange)

    expect(webApp.expand).toHaveBeenCalledOnce()
    expect(webApp.requestFullscreen).not.toHaveBeenCalled()
    expect(webApp.onEvent).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(detach).toBeUndefined()
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
