import { describe, expect, it } from "vitest"

import { ClientScreen } from "@/features/coach/components/client-screen.tsx"
import { coachCatalog, coachCopy } from "@/features/i18n/coach-copy.ts"
import type { CoachClients } from "@/server/coach-clients.ts"
import { renderWithFormat as withFormat } from "./render-screen.tsx"

/**
 * What a client's own route says about the sessions they have already had
 * (#232).
 *
 * The rules being asserted are as much about absence as presence: no history
 * section on a client who has none, no alarm colour on a cancellation nobody
 * caused, and no session row — ahead or behind — that leads nowhere.
 */

const client = (overrides: Partial<CoachClients.ClientDetail> = {}): CoachClients.ClientDetail => ({
  id: "cl_maria",
  name: "Maria K.",
  hasAvatar: false,
  state: "accepted",
  createdAt: "2026-06-01T09:00:00.000Z",
  acceptedAt: "2026-06-01T10:00:00.000Z",
  channel: { kind: "telegram" },
  sessions: [],
  past: [],
  canDelete: false,
  timezone: "Europe/Kyiv",
  ...overrides,
})

const ahead = {
  id: "se_next",
  scheduledAt: "2026-08-03T08:00:00.000Z",
  durationMinutes: 60,
  kind: "regular",
}

const behind = (
  overrides: Partial<CoachClients.PastClientSession> = {},
): CoachClients.PastClientSession => ({
  id: "se_done",
  scheduledAt: "2026-07-20T08:00:00.000Z",
  durationMinutes: 60,
  kind: "intake",
  state: "completed",
  ...overrides,
})

const screen = (detail: CoachClients.ClientDetail, language: "en" | "uk" | "ru" = "en") =>
  withFormat(
    <ClientScreen
      copy={coachCopy(language)}
      language={language}
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
    />,
    language,
  )

describe("client route history", () => {
  /**
   * `mini-app.md`'s absent-rather-than-present-and-empty rule: a heading over
   * «nothing yet» on a page the coach opened to read about a person promises
   * something they then go hunting for.
   */
  it("has no history section on a client who has none", async () => {
    const html = await screen(client({ sessions: [ahead] }))

    expect(html).not.toContain(coachCatalog.en.clients.pastSessionsTitle)
  })

  it("lists what already happened, newest first, in the coach's own words", async () => {
    const html = await screen(
      client({
        past: [
          behind({ id: "se_off", scheduledAt: "2026-07-24T08:00:00.000Z", state: "cancelled" }),
          behind(),
        ],
      }),
    )

    expect(html).toContain(coachCatalog.en.clients.pastSessionsTitle)
    expect(html.indexOf("se_off")).toBeLessThan(html.indexOf("se_done"))
    expect(html).toContain(coachCatalog.en.sessions.stateCancelledByCoach)
    expect(html).toContain(coachCatalog.en.sessions.stateCompleted)
  })

  /**
   * The two the reconciler writes (ADR 0005). A coach meeting one of these
   * should read *what happened* — never an error they caused, and never
   * `no_show`.
   */
  it("puts an automatic cancellation in plain words and never in alarm colours", async () => {
    const html = await screen(
      client({
        past: [
          behind({ id: "se_noshow", state: "cancelled", cancelReason: "no_show" }),
          behind({
            id: "se_room",
            scheduledAt: "2026-07-13T08:00:00.000Z",
            state: "cancelled",
            cancelReason: "room_unavailable",
          }),
        ],
      }),
      "ru",
    )

    expect(html).not.toContain("no_show")
    for (const sentence of [
      coachCatalog.ru.sessions.stateCancelledNoShow,
      coachCatalog.ru.sessions.stateCancelledRoom,
    ]) {
      // The classes on the span that actually holds the sentence, rather than
      // anywhere on the page: the danger zone's own heading is destructive by
      // right, and this line must not be.
      const worn = new RegExp(`<span class="([^"]*)">${sentence}<`).exec(html)?.[1]
      expect(worn).toContain("text-muted-foreground")
      expect(worn).not.toContain("text-warning")
      expect(worn).not.toContain("text-destructive")
    }
  })

  /**
   * A past session is otherwise unreachable: it is on neither Today nor the
   * Upcoming list, and reschedule, cancel and the artifact list all live on its
   * own screen.
   */
  it("makes every session a way into that session, ahead and behind alike", async () => {
    const html = await screen(client({ sessions: [ahead], past: [behind()] }))

    expect(html).toContain('href="/sessions/se_next"')
    expect(html).toContain('href="/sessions/se_done"')
  })

  it("writes the state in each of the three languages", async () => {
    for (const language of ["en", "uk", "ru"] as const) {
      const html = await screen(client({ past: [behind({ state: "completed" })] }), language)
      expect(html).toContain(coachCatalog[language].sessions.stateCompleted)
    }
  })
})
