import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TelegramWebApp } from "@/lib/telegram.ts"

/**
 * The browser's half of the invitation card (#179), which is deliberately almost
 * nothing: `shareInviteMessage` already owns the 8.0 gate, the `USER_DECLINED`
 * branch and the sub-8.0 fallback. What is this module's own is *when* an id is
 * asked for, and what happens when the one it gets back is already stale.
 */

const prepareInviteCard = vi.fn()
const loadTelegramWebApp = vi.fn()

vi.mock("@/server/coach-clients.functions.ts", () => ({
  prepareInviteCard: (input: unknown) => prepareInviteCard(input),
}))

vi.mock("@/lib/telegram.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telegram.ts")>()),
  loadTelegramWebApp: () => loadTelegramWebApp(),
}))

const { CARD_FRESHNESS_MARGIN_MILLIS, shareClientInvite } = await import("./invite-share.ts")

const LINK = "https://t.me/ada_coach_bot?start=inv_ABCDEFGH2345"
/** As the server assembles it: the body written to the client, then the link. */
const BODY = "Hi Anna! 👋\n\nI am Olena's assistant."
const invite = {
  clientId: "cl_anna",
  link: LINK,
  message: `${BODY}\n\n${LINK}`,
}

const webApp = (overrides: Partial<TelegramWebApp> = {}): TelegramWebApp =>
  ({
    version: "8.0",
    isVersionAtLeast: () => true,
    shareMessage: vi.fn((_id: string, callback?: (sent: boolean) => void) => callback?.(true)),
    openTelegramLink: vi.fn(),
    ...overrides,
  }) as unknown as TelegramWebApp

/** A card Telegram will still accept, and one it will not. */
const card = (millisFromNow: number) => ({
  ok: true as const,
  card: {
    preparedMessageId: `prepared-${millisFromNow}`,
    expiresAt: new Date(Date.now() + millisFromNow).toISOString(),
  },
})

beforeEach(() => {
  prepareInviteCard.mockReset()
  loadTelegramWebApp.mockReset()
})

describe("sharing a client's invitation", () => {
  it("mints the card on the tap and hands its id to the picker", async () => {
    const host = webApp()
    loadTelegramWebApp.mockResolvedValue(host)
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))

    expect(await shareClientInvite(invite)).toBe("shared")
    expect(prepareInviteCard).toHaveBeenCalledExactlyOnceWith({ data: { clientId: "cl_anna" } })
    expect(host.shareMessage).toHaveBeenCalledWith("prepared-1800000", expect.any(Function))
  })

  // A dismissed picker leaves the invitation exactly where it was: nothing is
  // reissued, nothing is recorded, and tapping again is safe.
  it("reports a dismissed picker without minting a second card", async () => {
    loadTelegramWebApp.mockResolvedValue(
      webApp({
        shareMessage: vi.fn((_id: string, callback?: (sent: boolean) => void) => callback?.(false)),
      }),
    )
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))

    expect(await shareClientInvite(invite)).toBe("dismissed")
    expect(prepareInviteCard).toHaveBeenCalledOnce()
  })

  // Telegram's `expiration_date` is read, not assumed. A card that comes back
  // inside the margin would fail at the picker — after the coach has already
  // chosen who to send it to — so it is re-minted instead.
  it("asks again rather than sharing an id that is already stale", async () => {
    const host = webApp()
    loadTelegramWebApp.mockResolvedValue(host)
    prepareInviteCard
      .mockResolvedValueOnce(card(CARD_FRESHNESS_MARGIN_MILLIS - 1_000))
      .mockResolvedValueOnce(card(30 * 60_000))

    expect(await shareClientInvite(invite)).toBe("shared")
    expect(prepareInviteCard).toHaveBeenCalledTimes(2)
    expect(host.shareMessage).toHaveBeenCalledWith("prepared-1800000", expect.any(Function))
  })

  it("never asks for a card on a host that cannot share one", async () => {
    const host = webApp({ version: "7.0", isVersionAtLeast: () => false })
    loadTelegramWebApp.mockResolvedValue(host)

    expect(await shareClientInvite(invite)).toBe("fallback")
    expect(prepareInviteCard).not.toHaveBeenCalled()
    // The `t.me/share/url` form, unchanged: the link as the url, the prose
    // beside it as the text — the same body the card carries, never twice.
    const [url] = vi.mocked(host.openTelegramLink).mock.calls[0] ?? []
    expect(url).toContain(`url=${encodeURIComponent(LINK)}`)
    expect(new URL(url ?? "").searchParams.get("text")).toBe(BODY)
  })

  it("tells a caller apart: an invitation that is gone from a bot that refused", async () => {
    loadTelegramWebApp.mockResolvedValue(webApp())

    prepareInviteCard.mockResolvedValue({ ok: false, error: "gone" })
    expect(await shareClientInvite(invite)).toBe("gone")

    prepareInviteCard.mockResolvedValue({ ok: false, error: "failed" })
    expect(await shareClientInvite(invite)).toBe("failed")
  })

  // A plain browser has no bridge to prepare a card *through*: the link opens
  // the ordinary way and nothing is minted.
  it("opens the plain share link outside a Telegram host", async () => {
    loadTelegramWebApp.mockResolvedValue(undefined)
    const open = vi.fn()
    vi.stubGlobal("open", open)

    expect(await shareClientInvite(invite)).toBe("no-telegram")
    expect(prepareInviteCard).not.toHaveBeenCalled()
    expect(open.mock.calls[0]?.[0]).toContain(`url=${encodeURIComponent(LINK)}`)
    vi.unstubAllGlobals()
  })
})
