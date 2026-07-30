import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ShareInviteOptions } from "@/mini-app.tsx"

const prepareInviteCard = vi.fn()
const recordInviteDelivery = vi.fn()
const sharePreparedMessage = vi.fn()

vi.mock("@/server/coach-clients.functions.ts", () => ({
  prepareInviteCard: (input: unknown) => prepareInviteCard(input),
  recordInviteDelivery: (input: unknown) => recordInviteDelivery(input),
}))

vi.mock("@/mini-app.tsx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mini-app.tsx")>()),
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
  recordInviteDelivery.mockReset()
  recordInviteDelivery.mockResolvedValue({ ok: true })
  sharePreparedMessage.mockReset()
})

const recordedKinds = (): ReadonlyArray<unknown> =>
  recordInviteDelivery.mock.calls.map((call) => (call[0] as { data: { kind: unknown } }).data.kind)

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

/**
 * Delivery becomes a record (#224).
 *
 * Recorded here rather than at each call site because both of them are the same
 * event: the client's own screen and the resend on an unaccepted session (#61)
 * hand the same invitation to the same picker, and a coach who resent one has
 * delivered it just as much as a coach who sent it the first time.
 */
describe("recording what actually went out", () => {
  it("writes the Telegram door down once the picker reports a send", async () => {
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      await options.prepare()
      return "shared"
    })

    expect(await shareClientInvite(invite)).toBe("shared")
    expect(recordInviteDelivery).toHaveBeenCalledExactlyOnceWith({
      data: { clientId: "cl_anna", kind: "telegram" },
    })
  })

  /**
   * The pre-8.0 form counts too: `t.me/share/url` opens the same native chat
   * picker with the invitation in the input field. It is no weaker evidence than
   * a copy is, and the state word claims no more than "this was handed over".
   */
  it("counts the sub-8.0 fallback as a delivery", async () => {
    sharePreparedMessage.mockResolvedValue("fallback")

    expect(await shareClientInvite(invite)).toBe("fallback")
    expect(recordedKinds()).toEqual(["telegram"])
  })

  // A coach who changed their mind sent nothing, and a card that could not be
  // minted never reached anybody. Neither is a delivery.
  it("writes nothing for a picker that was dismissed or a card that failed", async () => {
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      await options.prepare()
      return "dismissed"
    })
    expect(await shareClientInvite(invite)).toBe("dismissed")

    prepareInviteCard.mockResolvedValue({ ok: false, error: "failed" })
    expect(await shareClientInvite(invite)).toBe("failed")

    prepareInviteCard.mockResolvedValue({ ok: false, error: "gone" })
    expect(await shareClientInvite(invite)).toBe("gone")

    expect(recordInviteDelivery).not.toHaveBeenCalled()
  })

  /**
   * Outside Telegram the link opens in a new tab and nothing tells us what
   * happened next. The admin section draws the same line, and this is the case
   * where "the most that can honestly be observed" is nothing at all.
   */
  it("writes nothing when there is no host to report back", async () => {
    sharePreparedMessage.mockResolvedValue("no-host")
    vi.stubGlobal("open", vi.fn())

    expect(await shareClientInvite(invite)).toBe("no-telegram")
    expect(recordInviteDelivery).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  /**
   * The record has to land *before* the outcome reaches the caller, because the
   * caller re-reads the screen on it. Resolving the share first would let the
   * re-read race the write and redraw «Не отправлено» over a card the coach just
   * watched leave.
   */
  it("finishes writing before it reports the outcome", async () => {
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      await options.prepare()
      return "shared"
    })
    let settled = false
    recordInviteDelivery.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            settled = true
            resolve({ ok: true })
          }, 10)
        }),
    )

    expect(await shareClientInvite(invite)).toBe("shared")
    expect(settled).toBe(true)
  })

  /**
   * Bookkeeping must never read as a failed share: by the time this is written
   * the invitation has already left the coach's phone.
   */
  it("still reports the share when the record itself fails", async () => {
    prepareInviteCard.mockResolvedValue(card(30 * 60_000))
    sharePreparedMessage.mockImplementation(async (options: ShareInviteOptions) => {
      await options.prepare()
      return "shared"
    })
    recordInviteDelivery.mockRejectedValue(new Error("offline"))

    expect(await shareClientInvite(invite)).toBe("shared")
  })
})
