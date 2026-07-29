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
  const rootRoute = createRootRoute({ component: () => node })
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
  it("opens on Telegram and offers both doors over one token", async () => {
    const html = await screen(client())

    expect(html).toContain(copy.clients.doorTelegram)
    expect(html).toContain(copy.clients.doorLink)
    // The default door, its address, its eyebrow and its card.
    expect(html).toContain(TELEGRAM_URL)
    expect(html).toContain(copy.clients.invitationEyebrowTelegram)
    expect(html).toContain(copy.clients.sendCard)
    expect(html).not.toContain(copy.clients.invitationEyebrowLink)
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

    expect(html).toContain(WEB_URL)
    expect(html).toContain(copy.clients.invitationEyebrowLink)
    expect(html).not.toContain(TELEGRAM_URL)
    // No card behind the Link door: it opens a bot this client never appears in.
    expect(html).not.toContain(copy.clients.sendCard)
  })

  it("names where reminders will go for the door on screen", async () => {
    expect(await screen(client())).toContain(copy.clients.reminderTelegram)
    expect(
      await screen(client({ delivered: { at: "2026-07-27T10:00:00.000Z", kind: "link" } })),
    ).toContain(copy.clients.reminderLink)
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
    expect(html).not.toContain(copy.clients.doorLink)
    expect(html).not.toContain(TELEGRAM_URL)
  })
})

describe("what the state word claims", () => {
  it("says «Не отправлено» while the invitation is still on the coach's screen", async () => {
    const html = await screen(client())

    expect(html).toContain(copy.clients.stateNotSent)
    expect(html).not.toContain(copy.clients.stateInvited)
  })

  it("says «Приглашён» only once something was actually handed over", async () => {
    const html = await screen(
      client({ delivered: { at: "2026-07-27T10:00:00.000Z", kind: "link" } }),
    )

    expect(html).toContain(copy.clients.stateInvited)
    expect(html).not.toContain(copy.clients.stateNotSent)
  })
})

const summary = (
  overrides: Partial<CoachClients.ClientSummary> = {},
): CoachClients.ClientSummary => ({
  id: "cl_anna",
  name: "Анна",
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
    expect(html).toContain(copy.clients.sentViaLink)
    expect(html).not.toContain(copy.clients.sentViaTelegram)
  })

  it("names the Telegram door in the same shape", async () => {
    const html = await list([
      summary({ delivered: { at: "2026-07-27T09:00:00.000Z", kind: "telegram" } }),
    ])

    expect(html).toContain(copy.clients.sentViaTelegram)
  })
})
