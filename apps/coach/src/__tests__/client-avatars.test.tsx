import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ClientList } from "@/features/coach/components/client-list.tsx"
import { coachCopy } from "@/features/i18n/coach-copy.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { MiniAppProvider } from "@/mini-app.tsx"
import { PersonAvatar } from "@praximo/ui/custom/person-avatar"
import type { CoachClients } from "@/server/coach-clients.ts"

/**
 * The faces on the roster (#231).
 *
 * Two claims worth holding still. Initials render on the first paint and are the
 * ordinary case — most clients will never have a photo, because nobody is asked for
 * one. And no object key reaches the markup: the disc's address is the client's own
 * route, and the key stays server-side.
 */

const copy = coachCopy("ru")

/** A row is a `Link`, so the tree needs a router to render at all. */
const render = async (node: ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({
    component: () => (
      <MiniAppProvider>
        <TimestampFormatProvider value={coachTimestampFormat("ru")}>{node}</TimestampFormatProvider>
      </MiniAppProvider>
    ),
  })
  const routeTree = rootRoute.addChildren([
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

const summary = (
  overrides: Partial<CoachClients.ClientSummary> = {},
): CoachClients.ClientSummary => ({
  id: "cl_anna",
  name: "Анна Ковальська",
  hasAvatar: false,
  state: "accepted",
  invitedAt: "2026-07-27T09:00:00.000Z",
  inviteExpiresAt: "2026-08-03T09:00:00.000Z",
  acceptedAt: "2026-07-27T10:00:00.000Z",
  ...overrides,
})

describe("the roster's discs", () => {
  it("draws initials for a client with no photo, and asks for nothing", async () => {
    const html = await render(<ClientList copy={copy.clients} clients={[summary()]} />)

    expect(html).toContain("АК")
    // No request per row for the many clients who have no photo — which is what
    // `hasAvatar` on the payload buys over letting every disc try and 404.
    expect(html).not.toContain("<img")
    expect(html).not.toContain("/clients/cl_anna/avatar")
  })

  it("draws initials first for a client who does have one", async () => {
    // The photo arrives from a `fetch` — the route authorises by header, so an
    // `<img src>` could not carry the credential — and until it does, the monogram
    // is what shows. Never an empty disc.
    const html = await render(
      <ClientList copy={copy.clients} clients={[summary({ hasAvatar: true })]} />,
    )

    expect(html).toContain("АК")
    expect(html).not.toContain("avatars/")
  })
})

describe("PersonAvatar", () => {
  it("puts the photo in the markup rather than waiting for hydration", () => {
    // The reason this is a plain `<img>` and not `AvatarImage`: the Acceptance Page
    // is server-rendered, and the primitive renders nothing at all on the server.
    const html = renderToStaticMarkup(
      <PersonAvatar name="Анна Ковальська" photoSrc="/clients/cl_anna/avatar" />,
    )

    expect(html).toContain('src="/clients/cl_anna/avatar"')
    // Decorative: the name is always beside it, and an empty alt is also what lets
    // a failed load fall back to the initials underneath rather than to a broken
    // image icon.
    expect(html).toContain('alt=""')
    // The fallback is in the markup too, underneath — so the initials are what a
    // reader sees until the bytes arrive.
    expect(html).toContain("АК")
  })

  it("is initials and nothing else without a photo", () => {
    const html = renderToStaticMarkup(<PersonAvatar name="Анна Ковальська" />)

    expect(html).toContain("АК")
    expect(html).not.toContain("<img")
  })
})
