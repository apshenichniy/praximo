import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ShareInviteOptions } from "@/presentation-host/telegram/bridge.ts"

const prepareInviteCard = vi.fn()
const sharePreparedMessage = vi.fn()

vi.mock("@/server/coach-clients.functions.ts", () => ({
  prepareInviteCard: (input: unknown) => prepareInviteCard(input),
}))

vi.mock("@/presentation-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/presentation-host")>()),
  sharePreparedMessage: (options: ShareInviteOptions) => sharePreparedMessage(options),
}))

const { CARD_FRESHNESS_MARGIN_MILLIS, shareClientInvite } = await import("./invite-share.ts")

const LINK = "https://t.me/ada_coach_bot?start=inv_ABCDEFGH2345"
const BODY = "Hi Anna! 👋\n\nI am Olena's assistant."
const invite = {
  clientId: "cl_anna",
  link: LINK,
  message: `${BODY}\n\n${LINK}`,
}

const card = (millisFromNow: number) => ({
  ok: true as const,
  card: {
    preparedMessageId: `prepared-${millisFromNow}`,
    expiresAt: new Date(Date.now() + millisFromNow).toISOString(),
  },
})

beforeEach(() => {
  prepareInviteCard.mockReset()
  sharePreparedMessage.mockReset()
})

describe("sharing a client's invitation", () => {
  it("mints the card on the tap and hands its id to the host", async () => {
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      expect(await options.prepare()).toBe("prepared-1800000")
      return "shared"
    })

    expect(await shareClientInvite(invite)).toBe("shared")
    expect(prepareInviteCard).toHaveBeenCalledExactlyOnceWith({
      data: { clientId: "cl_anna" },
    })
  })

  it("reports a dismissed host picker without minting a second card", async () => {
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      await options.prepare()
      return "dismissed"
    })

    expect(await shareClientInvite(invite)).toBe("dismissed")
    expect(prepareInviteCard).toHaveBeenCalledOnce()
  })

  it("asks again rather than sharing an id that is already stale", async () => {
    prepareInviteCard
      .mockResolvedValueOnce(card(CARD_FRESHNESS_MARGIN_MILLIS - 1_000))
      .mockResolvedValueOnce(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      expect(await options.prepare()).toBe("prepared-1800000")
      return "shared"
    })

    expect(await shareClientInvite(invite)).toBe("shared")
    expect(prepareInviteCard).toHaveBeenCalledTimes(2)
  })

  it("does not mint when the host chooses its fallback path", async () => {
    sharePreparedMessage.mockResolvedValue("fallback")

    expect(await shareClientInvite(invite)).toBe("fallback")
    expect(prepareInviteCard).not.toHaveBeenCalled()
  })

  it("distinguishes a gone invitation from another preparation failure", async () => {
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      await options.prepare()
      return "shared"
    })

    prepareInviteCard.mockResolvedValue({ ok: false, error: "gone" })
    expect(await shareClientInvite(invite)).toBe("gone")

    prepareInviteCard.mockResolvedValue({ ok: false, error: "failed" })
    expect(await shareClientInvite(invite)).toBe("failed")
  })

  it("opens the plain share link outside a presentation host", async () => {
    sharePreparedMessage.mockResolvedValue("no-host")
    const open = vi.fn()
    vi.stubGlobal("open", open)

    expect(await shareClientInvite(invite)).toBe("no-telegram")
    expect(prepareInviteCard).not.toHaveBeenCalled()
    expect(open.mock.calls[0]?.[0]).toContain(`url=${encodeURIComponent(LINK)}`)
    vi.unstubAllGlobals()
  })
})
