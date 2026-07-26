import { describe, expect, it } from "vitest"
import {
  demoClients,
  DemoIdPrefix,
  type DemoTarget,
  DemoTargetUnresolved,
  parseDemoArgs,
  resolveDemoTarget,
} from "./demo-clients.ts"

const sessions = demoClients.flatMap((demo) => demo.sessions)
const invites = demoClients.flatMap((demo) => demo.invite ?? [])

const prefixed = (id: string) => id.startsWith(DemoIdPrefix)

describe("demo client fixture contract", () => {
  /**
   * The matrix is the reason this command exists: these are the states #56's
   * client list and #61's needs-attention section are built to render, and none
   * of them can be produced by hand — "expires in 2 days" would take a six-day
   * wait, "in 40 minutes" would take sitting at the screen at the right moment.
   */
  it("covers every state the client list has to render", () => {
    // A session close enough to be the next thing that happens today.
    expect(
      sessions.some((session) => session.startsInMinutes > 0 && session.startsInMinutes <= 60),
    ).toBe(true)

    // A client with three sessions, and on three different days.
    const busiest = demoClients.find((demo) => demo.sessions.length >= 3)
    expect(busiest).toBeDefined()
    const days = new Set(
      busiest?.sessions.map((session) => Math.floor(session.startsInMinutes / (24 * 60))),
    )
    expect(days.size).toBe(3)

    // An invitation inside its last two days, and one that has already lapsed.
    expect(
      invites.some(
        (invite) =>
          invite.status === "pending" &&
          invite.expiresInHours > 0 &&
          invite.expiresInHours <= 2 * 24,
      ),
    ).toBe(true)
    expect(invites.some((invite) => invite.status === "expired" && invite.expiresInHours < 0)).toBe(
      true,
    )

    // A pending invitation *and* a scheduled session on the same client.
    expect(
      demoClients.some(
        (demo) =>
          demo.invite?.status === "pending" &&
          demo.sessions.some((session) => session.state === "scheduled"),
      ),
    ).toBe(true)

    // An accepted client with nothing scheduled — the empty state that belongs
    // to a real client rather than to an empty practice.
    expect(
      demoClients.some(
        (demo) =>
          demo.channel !== undefined && demo.invite === undefined && demo.sessions.length === 0,
      ),
    ).toBe(true)
  })

  it("carries a past session, so a client has history to summarise", () => {
    expect(sessions.some((session) => session.startsInMinutes < 0)).toBe(true)
    expect(sessions.some((session) => session.state === "completed")).toBe(true)
  })

  /**
   * `--clear` deletes on this prefix and nothing else. A fixture id without it
   * would survive a clear and then collide on the next seed — and, worse, would
   * be indistinguishable from a real client.
   */
  it("prefixes every id it writes", () => {
    for (const demo of demoClients) {
      expect(prefixed(demo.id), demo.id).toBe(true)
      for (const session of demo.sessions) expect(prefixed(session.id), session.id).toBe(true)
      if (demo.invite !== undefined) {
        expect(prefixed(demo.invite.id), demo.invite.id).toBe(true)
      }
    }
  })

  it("uses ids and tokens that are unique across the set", () => {
    const ids = [
      ...demoClients.map((d) => d.id),
      ...sessions.map((s) => s.id),
      ...invites.map((i) => i.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(invites.map((invite) => invite.token)).size).toBe(invites.length)
  })

  /**
   * Half the decisions about truncation and line wrapping are only visible on
   * real names in three alphabets — "Client 3" hides every one of them.
   */
  it("names people in both Latin and Cyrillic", () => {
    const names = demoClients.map((demo) => demo.name)
    expect(names.some((name) => /^[A-Za-z]/.test(name))).toBe(true)
    expect(names.some((name) => /[Ѐ-ӿ]/.test(name))).toBe(true)
    // Ukrainian and Russian are different alphabets to a reader, and the product
    // speaks both.
    expect(new Set(demoClients.map((demo) => demo.language))).toEqual(new Set(["en", "uk", "ru"]))
  })

  it("gives consent only to clients that accepted", () => {
    // A pending invitation has granted nothing yet; the seed derives consent from
    // the channel, so a fixture with an invite and a channel would seed a grant
    // nobody made.
    for (const demo of demoClients) {
      if (demo.invite?.status === "pending") expect(demo.channel, demo.name).toBeUndefined()
    }
  })
})

const target = (botUsername: string, workspaceId = `ws_${botUsername}`): DemoTarget => ({
  workspaceId,
  workspaceName: botUsername,
  botUsername,
  telegramBotId: `700${botUsername.length}`,
})

describe("resolveDemoTarget", () => {
  it("needs no argument when there is exactly one connected workspace", () => {
    const only = target("ada_bot")

    expect(resolveDemoTarget([only], undefined)).toBe(only)
  })

  /**
   * Seeding the wrong practice is invisible until somebody opens the wrong Mini
   * App, so ambiguity is refused rather than guessed — and the message carries
   * the candidates, since the next thing the operator types is one of them.
   */
  it("refuses to guess between two, and names them", () => {
    const candidates = [target("ada_bot"), target("grace_bot")]

    expect(() => resolveDemoTarget(candidates, undefined)).toThrow(DemoTargetUnresolved)
    expect(() => resolveDemoTarget(candidates, undefined)).toThrow(/ada_bot.*grace_bot/s)
  })

  it("selects by username, with or without the @", () => {
    const candidates = [target("ada_bot"), target("grace_bot")]

    expect(resolveDemoTarget(candidates, "grace_bot").workspaceId).toBe("ws_grace_bot")
    expect(resolveDemoTarget(candidates, "@grace_bot").workspaceId).toBe("ws_grace_bot")
  })

  it("selects by Telegram bot id", () => {
    const candidates = [target("ada_bot"), target("grace_bot_x")]

    expect(resolveDemoTarget(candidates, "70011").workspaceId).toBe("ws_grace_bot_x")
  })

  it("says what to do when nothing is connected at all", () => {
    expect(() => resolveDemoTarget([], undefined)).toThrow(/no connected workspace/)
  })

  it("names the candidates when --bot matches none of them", () => {
    expect(() => resolveDemoTarget([target("ada_bot")], "grace_bot")).toThrow(/Available: ada_bot/)
  })
})

describe("parseDemoArgs", () => {
  it("defaults to seeding the single connected workspace", () => {
    expect(parseDemoArgs([])).toEqual({ clear: false, bot: undefined })
  })

  it("reads the two flags, in either order", () => {
    expect(parseDemoArgs(["--clear"])).toEqual({ clear: true, bot: undefined })
    expect(parseDemoArgs(["--bot", "ada_bot"])).toEqual({ clear: false, bot: "ada_bot" })
    expect(parseDemoArgs(["--clear", "--bot", "ada_bot"])).toEqual({ clear: true, bot: "ada_bot" })
    expect(parseDemoArgs(["--bot", "ada_bot", "--clear"])).toEqual({ clear: true, bot: "ada_bot" })
  })

  /**
   * A typo must not silently seed the wrong workspace — or, worse, silently seed
   * nothing and leave the operator looking at an empty screen wondering why.
   */
  it("refuses anything it does not understand", () => {
    expect(() => parseDemoArgs(["--demo"])).toThrow(/unknown db:demo argument: --demo/)
    expect(() => parseDemoArgs(["ada_bot"])).toThrow(/unknown db:demo argument: ada_bot/)
    expect(() => parseDemoArgs(["--bot"])).toThrow(/--bot needs a value/)
    expect(() => parseDemoArgs(["--bot", "--clear"])).toThrow(/--bot needs a value/)
  })
})
