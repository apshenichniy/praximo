import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClientList } from "@/features/coach/components/client-list.tsx"
import { ClientScreen } from "@/features/coach/components/client-screen.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { MiniAppProvider } from "@/mini-app.tsx"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The coach chooses which door to hand over, and the screen says what actually
 * happened (#224).
 *
 * These assert the *absences* as much as the presences: no card behind the Link
 * door, no Share button off iOS, and no «Приглашён» about an invitation still
 * sitting on the coach's screen.
 */

const render = async (node: ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({
    component: () => <MiniAppProvider>{node}</MiniAppProvider>,
  })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/clients" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/clients/new" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/clients/$clientId" }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return renderToStaticMarkup(<RouterProvider router={router as never} />)
}

const copy = coachCopy("ru")

const TELEGRAM_URL = "https://t.me/ada_coach_bot?start=inv_ABCDEFGH2345"
const WEB_URL = "https://me.praximo.io/i/ABCDEFGH2345"

const client = (
  invite: Partial<NonNullable<CoachClients.ClientDetail["invite"]>> = {},
): CoachClients.ClientDetail => ({
  id: "cl_anna",
  name: "Анна",
  hasAvatar: false,
  state: "invited",
  createdAt: "2026-07-27T09:00:00.000Z",
  invite: {
    token: "ABCDEFGH2345",
    status: "pending",
    expiresAt: "2026-08-03T09:00:00.000Z",
    language: "ru",
    telegram: { url: TELEGRAM_URL, message: `Привет!\n\n${TELEGRAM_URL}` },
    link: { url: WEB_URL, message: `Привет!\n\n${WEB_URL}` },
    ...invite,
  },
  sessions: [],
  past: [],
  canDelete: true,
  timezone: "Europe/Kyiv",
})

const screen = (detail: CoachClients.ClientDetail) =>
  render(
    <TimestampFormatProvider value={coachTimestampFormat("ru")}>
      <ClientScreen
        copy={copy}
        language="ru"
        client={detail}
        onSchedule={() => undefined}
        onShare={() => undefined}
        onShareSheet={() => undefined}
        onDelivered={() => undefined}
        onSendEmail={() => undefined}
        onResetInvite={() => undefined}
        onDelete={() => undefined}
        pending={false}
        error={undefined}
      />
    </TimestampFormatProvider>,
  )

const hostRunning = (platform: string | undefined): void => {
  vi.stubGlobal("window", platform === undefined ? {} : { Telegram: { WebApp: { platform } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the invitation section", () => {
  /**
   * The door is read off what the block *says and offers*, not off an address.
   *
   * It used to be read off the URL, because a read-only field carried it. That
   * field is gone: truncated to a phone's width it hid the token — the only part
   * that differs between two clients — so it verified nothing, and nobody
   * retypes one by hand. Neither door's URL is rendered anywhere now, which is
   * why these assert on the sentence and the lead action instead.
   */
  it("opens on Telegram and offers both doors", async () => {
    const html = await screen(client())

    expect(html).toContain(copy.clients.doors.telegram.label)
    expect(html).toContain(copy.clients.doors.link.label)
    expect(html).toContain(copy.clients.inviteEyebrow)
    // The default door: its sentence and its card.
    expect(html).toContain(copy.clients.doors.telegram.leadTail)
    expect(html).toContain(copy.clients.sendCard)
    expect(html).not.toContain(copy.clients.doors.link.leadTail)
  })

  // The token stays behind the copy button. Nothing on the screen prints it.
  it("shows neither form of the link", async () => {
    const html = await screen(client())

    expect(html).not.toContain(TELEGRAM_URL)
    expect(html).not.toContain(WEB_URL)
  })

  /**
   * The door already recorded is the one the screen opens on. A coach who sent a
   * link last week and returns to a Telegram-shaped screen would be reading a
   * state word about one door beside controls set for the other.
   */
  it("opens on the door the invitation actually went out through", async () => {
    const html = await screen(
      client({ delivered: { at: "2026-07-27T10:00:00.000Z", kind: "link" } }),
    )

    expect(html).toContain(copy.clients.doors.link.leadTail)
    expect(html).not.toContain(copy.clients.doors.telegram.leadTail)
    // No card behind the Link door: it opens a bot this client never appears in.
    expect(html).not.toContain(copy.clients.sendCard)
  })

  /**
   * The gate is the host platform, not `navigator.share` — which Android lacks,
   * both Telegram Web clients block by Permissions Policy, and Desktop's
   * WebView2 resolves without doing anything.
   */
  it("offers the share sheet on iOS and on no other host", async () => {
    const delivered = { at: "2026-07-27T10:00:00.000Z", kind: "link" } as const

    hostRunning("ios")
    expect(await screen(client({ delivered }))).toContain(copy.clients.shareAction)

    for (const platform of ["android", "tdesktop", "weba", undefined]) {
      hostRunning(platform)
      expect(await screen(client({ delivered })), platform ?? "no host").not.toContain(
        copy.clients.shareAction,
      )
    }
  })

  // Gone once the client is in: there is no message left to send them.
  it("says nothing about an invitation to a client who accepted", async () => {
    const html = await screen({ ...client(), state: "accepted" })
    expect(html).not.toContain(copy.clients.doors.link.label)
    expect(html).not.toContain(TELEGRAM_URL)
  })
})

describe("what the state word claims", () => {
  it("says «Не отправлено» while the invitation is still on the coach's screen", async () => {
    const html = await screen(client())

    expect(html).toContain(copy.clients.stateNotSent)
    expect(html).not.toContain(copy.clients.stateInvited)
    // Nothing has gone out, so there is no door and no moment to name.
    expect(html).not.toContain(copy.clients.sentVia.link)
    expect(html).not.toContain(copy.clients.sentVia.telegram)
  })

  /**
   * The badge says the standing; the line under it says what produced that
   * standing — the door and the moment, which is what a coach returning a week
   * later actually needs. The badge cannot carry either without becoming a
   * sentence, so it does not try.
   */
  it("names the door and the moment once something was handed over", async () => {
    const html = await screen(
      client({ delivered: { at: "2026-07-27T10:00:00.000Z", kind: "link" } }),
    )

    expect(html).toContain(copy.clients.stateInvited)
    expect(html).not.toContain(copy.clients.stateNotSent)
    expect(html).toContain(copy.clients.sentVia.link)
  })

  it("names the Telegram door on the client's own screen too", async () => {
    const html = await screen(
      client({ delivered: { at: "2026-07-27T10:00:00.000Z", kind: "telegram" } }),
    )

    expect(html).toContain(copy.clients.sentVia.telegram)
    expect(html).not.toContain(copy.clients.sentVia.link)
  })
})

const summary = (
  overrides: Partial<CoachClients.ClientSummary> = {},
): CoachClients.ClientSummary => ({
  id: "cl_anna",
  name: "Анна",
  hasAvatar: false,
  state: "invited",
  invitedAt: "2026-07-27T09:00:00.000Z",
  inviteExpiresAt: "2026-08-03T09:00:00.000Z",
  ...overrides,
})

const list = (clients: ReadonlyArray<CoachClients.ClientSummary>) =>
  render(
    <TimestampFormatProvider value={coachTimestampFormat("ru")}>
      <ClientList copy={copy.clients} clients={clients} />
    </TimestampFormatProvider>,
  )

describe("the clients list", () => {
  it("reads «Не отправлено» with the window it is still running", async () => {
    const html = await list([summary()])

    expect(html).toContain(copy.clients.stateNotSent)
    expect(html).toContain(copy.clients.expiresPrefix.trim())
  })

  /**
   * The door, not only the moment: a coach returning a week later needs to know
   * what this person is holding — and where their reminders are going.
   */
  it("names the door once the invitation has gone out", async () => {
    const html = await list([
      summary({ delivered: { at: "2026-07-27T09:00:00.000Z", kind: "link" } }),
    ])

    expect(html).toContain(copy.clients.stateInvited)
    expect(html).toContain(copy.clients.sentVia.link)
    expect(html).not.toContain(copy.clients.sentVia.telegram)
  })

  it("names the Telegram door in the same shape", async () => {
    const html = await list([
      summary({ delivered: { at: "2026-07-27T09:00:00.000Z", kind: "telegram" } }),
    ])

    expect(html).toContain(copy.clients.sentVia.telegram)
  })
})

/**
 * The service-sent invitation on the coach's screen (#58).
 *
 * The screen's job here is narrow — offer the send in the one place it belongs,
 * and say afterwards *where* it went — so these assert the placement and the
 * address, not the sending, which is the server's test.
 */
describe("the service-sent invitation", () => {
  /**
   * Not a third chip on the segment: an email is not a form of the token a coach
   * hands over, it is us sending the web URL for them. Behind Telegram's door it
   * would be an address for a client who is reachable in a chat.
   */
  it("offers the send behind the Link door and not behind Telegram", async () => {
    const html = await screen(client())

    // The screen opens on Telegram for an invitation nothing has been done with.
    expect(html).not.toContain(copy.clients.sendEmail)

    const linkDoor = await screen(
      client({ delivered: { at: "2026-07-27T10:00:00.000Z", kind: "link" } }),
    )
    expect(linkDoor).toContain(copy.clients.sendEmail)
  })

  // Once there is an address on file the button is answering «не дошло», not
  // sending for the first time — and the sheet opens on that same address.
  it("reads as a resend once an address is on file", async () => {
    const html = await screen(
      client({
        address: "anna@example.com",
        delivered: { at: "2026-07-27T10:00:00.000Z", kind: "email" },
      }),
    )

    expect(html).toContain(copy.clients.sendEmailAgain)
  })

  /**
   * The line that makes a typo findable. Without it the coach reads
   * «отправлено», the client never arrives, and nothing anywhere says the
   * message went to `ann@gmial.com`.
   */
  it("names the address a service-sent invitation went to", async () => {
    const html = await screen(
      client({
        address: "anna@example.com",
        delivered: { at: "2026-07-27T10:00:00.000Z", kind: "email" },
      }),
    )

    expect(html).toContain(copy.clients.sentVia.email)
    expect(html).toContain("anna@example.com")
    expect(html).not.toContain(copy.clients.stateNotSent)
  })

  /**
   * A reissue carries the address and drops the delivery, so the screen must be
   * able to say «Не отправлено» while still knowing where to send. The address
   * belongs to the sheet then, not to a line claiming something was sent.
   */
  it("does not claim a send from a carried-over address alone", async () => {
    const html = await screen(client({ address: "anna@example.com" }))

    expect(html).toContain(copy.clients.stateNotSent)
    expect(html).not.toContain(copy.clients.sentVia.email)
  })
})
