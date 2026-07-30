import { DefaultWorkingHours } from "@praximo/domain"
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

import { ClientPickerScreen } from "@/features/coach/components/client-picker-screen.tsx"
import { ClientsScreen } from "@/features/coach/components/clients-screen.tsx"
import { SessionScreen } from "@/features/coach/components/session-screen.tsx"
import { SessionsScreen } from "@/features/coach/components/sessions-screen.tsx"
import { TodayScreen } from "@/features/coach/components/today-screen.tsx"
import { coachCatalog, coachCopy } from "@/features/i18n/coach-copy.ts"
import { coachTimestampFormat } from "@/features/mini-app/coach-timestamp-format.ts"
import { TimestampFormatProvider } from "@/features/mini-app/timestamp-format.tsx"
import { MiniAppProvider } from "@/mini-app.tsx"
import { attentionFor, type CoachSessions, orderAttention } from "@/server/coach-sessions.ts"
import { bookedDates } from "@/features/coach/session-days.ts"

/**
 * What each screen of #61 actually puts on the page, and — as much as the
 * ticket's rules are about absence — what it does not.
 */
const render = async (node: ReactNode): Promise<string> => {
  const rootRoute = createRootRoute({
    component: () => <MiniAppProvider>{node}</MiniAppProvider>,
  })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/clients" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/clients/new" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/clients/$clientId" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/sessions" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/sessions/$sessionId" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/main-mini-app" }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return renderToStaticMarkup(<RouterProvider router={router as never} />)
}

const withFormat = (node: ReactNode, locale: "en" | "uk" | "ru" = "en") =>
  render(
    <TimestampFormatProvider value={coachTimestampFormat(locale)}>{node}</TimestampFormatProvider>,
  )

const NOW = new Date("2026-07-27T09:00:00.000Z")

/** A row of today's calendar, as the repository hands it over. */
const booked = (clientId: string) => ({
  id: `se_${clientId}`,
  clientId,
  clientName: clientId.toUpperCase(),
  scheduledAt: new Date("2026-07-27T11:00:00.000Z"),
  durationMinutes: 60,
  kind: "regular",
  state: "scheduled",
  clientAccepted: false,
})

const session = (
  overrides: Partial<CoachSessions.SessionSummary> = {},
): CoachSessions.SessionSummary => ({
  id: "se_1",
  clientId: "cl_1",
  clientName: "Maria K.",
  scheduledAt: "2026-07-27T11:00:00.000Z",
  durationMinutes: 60,
  kind: "regular",
  clientAccepted: true,
  ...overrides,
})

const today = (overrides: Partial<CoachSessions.TodayView> = {}): CoachSessions.TodayView => ({
  coachName: "Olena P.",
  timezone: "Europe/Kyiv",
  sessions: [],
  attention: [],
  emptyPractice: false,
  mainMiniAppHintVisible: false,
  workingHours: DefaultWorkingHours,
  ...overrides,
})

describe("Today", () => {
  it("speaks the day's count, the zero included, and names the coach", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today()}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).toContain("Olena P.")
    // Silence about a zero reads as a screen that failed to load.
    expect(html).toContain("No sessions today")
  })

  it("shows every one of today's sessions as its own card, unclipped", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({
          sessions: [
            session(),
            session({ id: "se_2", clientName: "Ivan L.", scheduledAt: "2026-07-27T14:30:00.000Z" }),
          ],
        })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).toContain("2 sessions today")
    // Read in the coach's own zone, on a 24-hour clock.
    expect(html).toContain("14:00")
    expect(html).toContain("17:30")
    expect(html).toContain("Maria K.")
    expect(html).toContain("Ivan L.")
    expect(html).toContain("/sessions/se_2")
  })

  /**
   * A session whose client never accepted is real, on the day, and
   * undeliverable. The state word alone is a fact a coach reads as harmless, so
   * the card carries its consequence and the action that fixes it.
   */
  it("says what an unaccepted invitation costs, and offers the way out", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ sessions: [session({ clientAccepted: false })] })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).toContain(coachCatalog.en.today.unacceptedLead.trim())
    expect(html).toContain(coachCatalog.en.today.unacceptedTail.trim())
    expect(html).toContain(coachCatalog.en.today.resend)
    // The warning tone, never the bot-down one: red belongs to the one thing here the
    // coach cannot fix by talking to their client.
    expect(html).toContain("text-warning")
    expect(html).not.toMatch(/text-warning\/\d+/)
    expect(html).not.toContain("bg-destructive")
  })

  it("keeps a healthy session silent about its state", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ sessions: [session()] })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).not.toContain(coachCatalog.en.today.resend)
    expect(html).not.toContain("text-warning")
  })

  it("hides needs attention when there is nothing in it", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ sessions: [session()] })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).not.toContain(coachCatalog.en.today.attentionTitle)
  })

  it("carries the lapsed and the nearly-lapsed, each linked to its client", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({
          sessions: [session()],
          attention: [
            {
              clientId: "cl_9",
              clientName: "Артём В.",
              expiresAt: "2026-07-24T09:00:00.000Z",
              expired: true,
            },
            {
              clientId: "cl_8",
              clientName: "Олена П.",
              expiresAt: "2026-07-29T09:00:00.000Z",
              expired: false,
            },
          ],
        })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).toContain(coachCatalog.en.today.attentionTitle)
    expect(html).toContain(coachCatalog.en.today.attentionExpired)
    expect(html).toContain("/clients/cl_9")
    expect(html).toContain("/clients/cl_8")
  })

  /**
   * Three of mini-app.md's five blocks cannot exist yet, and the rule is that
   * they are **absent rather than empty**: a section that is always empty
   * promises something the coach then hunts for.
   */
  it("carries no artifacts feed, no generation failures and no join button", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ sessions: [session()] })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    for (const absent of ["Join", "Brief", "Artifact", "artifact"]) {
      expect(html).not.toContain(absent)
    }
  })

  it("opens an empty practice on the checklist, with the bot step already ticked", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ emptyPractice: true })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).toContain(coachCatalog.en.today.checklistTitle)
    expect(html).toContain(coachCatalog.en.today.checklistBot)
    expect(html).toContain(coachCatalog.en.today.checklistClient)
    expect(html).toContain(coachCatalog.en.today.checklistSession)
    expect(html).toContain("line-through")
    // No count line and no needs-attention beside it: the checklist replaces
    // three ways of looking at nothing rather than joining them.
    expect(html).not.toContain("No sessions today")
  })

  it("drops the checklist the moment a client exists", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ sessions: [] })}
        botUsername="ada_coach_bot"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).not.toContain(coachCatalog.en.today.checklistTitle)
    expect(html).toContain("No sessions today")
  })

  it("puts the re-link banner first, in the destructive tone, with no way to dismiss it", async () => {
    const html = await withFormat(
      <TodayScreen
        copy={coachCopy("en")}
        language="en"
        today={today({ sessions: [session()] })}
        botUsername="ada_coach_bot"
        relinkLink="https://t.me/praximo_bot?start=relink_abc"
        onResend={() => {}}
        resending={undefined}
        error={undefined}
      />,
    )

    expect(html).toContain(coachCatalog.en.home.relinkTitle)
    expect(html).toContain("bg-destructive")
    expect(html.indexOf(coachCatalog.en.home.relinkTitle)).toBeLessThan(html.indexOf("Olena P."))
  })
})

describe("needs attention", () => {
  it("puts what has already lapsed first, then whatever goes next", () => {
    const ordered = orderAttention([
      { clientId: "a", clientName: "A", expiresAt: "2026-07-29T09:00:00.000Z", expired: false },
      { clientId: "b", clientName: "B", expiresAt: "2026-07-20T09:00:00.000Z", expired: true },
      { clientId: "c", clientName: "C", expiresAt: "2026-07-28T09:00:00.000Z", expired: false },
    ])

    expect(ordered.map((item) => item.clientId)).toEqual(["b", "c", "a"])
  })

  const client = (
    id: string,
    state: "invited" | "expired" | "accepted",
    expiresInDays: number,
  ) => ({
    id,
    name: id.toUpperCase(),
    state,
    invitedAt: new Date("2026-07-20T09:00:00.000Z"),
    inviteExpiresAt: new Date(NOW.getTime() + expiresInDays * 24 * 60 * 60 * 1000),
  })

  it("carries only the invitations inside their last two days, and the lapsed", () => {
    const items = attentionFor(
      [client("fresh", "invited", 6), client("soon", "invited", 1), client("gone", "expired", -2)],
      [],
      NOW,
    )

    expect(items.map((item) => item.clientId)).toEqual(["gone", "soon"])
  })

  /**
   * The ticket's own rule: a session whose client never accepted already says so
   * on its card, and «These sessions do not also appear in Needs attention» —
   * otherwise limiting this section to urgent invitations buys nothing.
   */
  it("leaves out anybody whose card is already on today's screen", () => {
    const roster = [client("soon", "invited", 1), client("other", "invited", 1)]

    expect(attentionFor(roster, [booked("soon")], NOW).map((item) => item.clientId)).toEqual([
      "other",
    ])
  })

  it("never asks anything of a client who is already in", () => {
    expect(attentionFor([client("done", "accepted", -9)], [], NOW)).toEqual([])
  })
})

describe("sessions list", () => {
  const upcoming = {
    timezone: "Europe/Kyiv",
    sessions: [
      session(),
      session({ id: "se_2", scheduledAt: "2026-07-28T08:00:00.000Z" }),
      session({ id: "se_3", scheduledAt: "2026-08-03T08:00:00.000Z", clientName: "Ivan L." }),
    ],
  }

  it("groups by day, names today and tomorrow, and dates the rest", async () => {
    const html = await render(
      <SessionsScreen
        copy={coachCopy("en")}
        language="en"
        upcoming={upcoming}
        now={NOW}
        onCreate={() => {}}
      />,
    )

    expect(html).toContain(coachCatalog.en.sessions.today)
    expect(html).toContain(coachCatalog.en.sessions.tomorrow)
    expect(html).toContain("Monday 3 August")
    expect(html).toContain("/sessions/se_3")
  })

  /**
   * No session can be `completed` before #42, so a history heading here would
   * be a heading over nothing — the same rule that keeps the artifacts feed off
   * Today. #62 brings history.
   */
  it("has no past section", async () => {
    const html = await render(
      <SessionsScreen
        copy={coachCopy("en")}
        language="en"
        upcoming={upcoming}
        now={NOW}
        onCreate={() => {}}
      />,
    )

    for (const absent of ["Past", "History", "Completed"]) {
      expect(html).not.toContain(absent)
    }
  })

  it("says nothing about a healthy session, and warns about a broken one", async () => {
    const healthy = await render(
      <SessionsScreen
        copy={coachCopy("en")}
        language="en"
        upcoming={upcoming}
        now={NOW}
        onCreate={() => {}}
      />,
    )
    expect(healthy).not.toContain(coachCatalog.en.sessions.rowUnaccepted)

    const broken = await render(
      <SessionsScreen
        copy={coachCopy("en")}
        language="en"
        upcoming={{ ...upcoming, sessions: [session({ clientAccepted: false })] }}
        now={NOW}
        onCreate={() => {}}
      />,
    )
    expect(broken).toContain(coachCatalog.en.sessions.rowUnaccepted)
    expect(broken).toContain("text-warning")
    expect(broken).not.toMatch(/text-warning\/\d+/)
  })

  it("says so plainly when nothing is booked", async () => {
    const html = await render(
      <SessionsScreen
        copy={coachCopy("en")}
        language="en"
        upcoming={{ timezone: "Europe/Kyiv", sessions: [] }}
        now={NOW}
        onCreate={() => {}}
      />,
    )
    expect(html).toContain(coachCatalog.en.sessions.empty)
  })
})

describe("session screen", () => {
  it("renders the facts and no actions", async () => {
    const html = await render(
      <SessionScreen
        copy={coachCopy("en")}
        language="en"
        session={{ ...session(), timezone: "Europe/Kyiv" }}
      />,
    )

    expect(html).toContain("Maria K.")
    expect(html).toContain("14:00")
    expect(html).toContain(coachCatalog.en.clients.kindRegular)
    expect(html).toContain("60")
    expect(html).toContain("/clients/cl_1")
    // #62 owns every one of these; a stub that offered them would be a lie.
    for (const absent of ["Reschedule", "Cancel", "Join"]) {
      expect(html).not.toContain(absent)
    }
    expect(html).not.toContain("<button")
  })

  it("names the invitation only when it is a problem", async () => {
    const healthy = await render(
      <SessionScreen
        copy={coachCopy("en")}
        language="en"
        session={{ ...session(), timezone: "Europe/Kyiv" }}
      />,
    )
    expect(healthy).not.toContain(coachCatalog.en.sessions.detailInvitation)

    const broken = await render(
      <SessionScreen
        copy={coachCopy("en")}
        language="en"
        session={{ ...session(), clientAccepted: false, timezone: "Europe/Kyiv" }}
      />,
    )
    expect(broken).toContain(coachCatalog.en.sessions.detailUnaccepted)
  })
})

describe("clients list and the picker", () => {
  const clients = [
    {
      id: "cl_1",
      name: "Maria K.",
      state: "accepted" as const,
      invitedAt: "2026-07-01T09:00:00.000Z",
      inviteExpiresAt: "2026-07-08T09:00:00.000Z",
      acceptedAt: "2026-07-02T09:00:00.000Z",
    },
    {
      id: "cl_2",
      name: "Олена П.",
      state: "invited" as const,
      invitedAt: "2026-07-25T09:00:00.000Z",
      inviteExpiresAt: "2026-08-01T09:00:00.000Z",
      // Sent, and not accepted yet — which is what «Приглашён» means since #224.
      // Without a delivery this row reads «Не отправлено», and that case has its
      // own suite (`client-delivery.test.tsx`); here the point is that somebody
      // who has not accepted is still offered by the picker.
      delivered: { at: "2026-07-25T09:05:00.000Z", kind: "telegram" as const },
    },
  ]

  /**
   * New client moved off the list and onto the host's bottom button in #198, so
   * the list is only clients.
   *
   * The label being absent from this markup is the assertion, not an oversight.
   * `HostMainButton` chooses between the host's own button and the in-page
   * fallback only once it knows whether there is a host, which cannot be known
   * on the server — so neither renders here. What is checkable server-side is
   * that the row is gone and the list no longer navigates to `/clients/new`,
   * and that is exactly what moved.
   */
  it("moves the clients list to its own route, with New client off the list", async () => {
    const html = await withFormat(
      <ClientsScreen copy={coachCopy("en")} clients={clients} onCreate={() => {}} />,
    )

    expect(html).toContain(coachCatalog.en.clients.listTitle)
    expect(html).toContain("/clients/cl_1")
    expect(html).toContain("Maria K.")
    expect(html).not.toContain('href="/clients/new"')
    expect(html).not.toContain(coachCatalog.en.clients.newClient)
  })

  /**
   * Scheduling before acceptance is deliberate, so a pending invitation is no
   * reason to keep somebody out of the picker — the row's own state word already
   * warns. New client sits at the bottom here, not at the top.
   */
  it("offers every client, pending invitations included, with New client last", async () => {
    const html = await withFormat(
      <ClientPickerScreen copy={coachCopy("en")} clients={clients} onPick={() => {}} />,
    )

    expect(html).toContain("Maria K.")
    expect(html).toContain("Олена П.")
    expect(html).toContain(coachCatalog.en.clients.stateInvited)
    expect(html.indexOf("Maria K.")).toBeLessThan(html.indexOf(coachCatalog.en.clients.newClient))
    // A row is a choice here, not a destination.
    expect(html).not.toContain("/clients/cl_1")
  })
})

describe("the sheet's calendar dots", () => {
  it("marks the days this client already has a session on, in the coach's zone", () => {
    expect(
      bookedDates({
        timezone: "Europe/Kyiv",
        sessions: [
          // 23:30 in Kyiv on the 27th is already the 28th in UTC — the dot goes
          // on the day the coach is looking at.
          { scheduledAt: "2026-07-27T20:30:00.000Z" },
          { scheduledAt: "2026-08-03T08:00:00.000Z" },
        ],
      }),
    ).toEqual(["2026-07-27", "2026-08-03"])
  })
})
