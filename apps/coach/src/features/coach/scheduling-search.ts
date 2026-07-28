/**
 * What `/sessions/new` carries in its URL (#186).
 *
 * The booking used to be a drawer over whatever screen opened it, which made
 * the flow's own position invisible to the router: a swipe down and Telegram's
 * BackButton did two different things, and neither was undoable. Both facts the
 * screen needs — *who* the session is for and *where the booking came from* —
 * therefore travel as search parameters, so back is back and the whole flow is
 * one navigable stack.
 */
export interface SchedulingSearch {
  /** The client the session is for. Absent means the picker still has to run. */
  readonly client?: string
  /**
   * The client route, when the booking started there. It decides what a booked
   * session returns to: the coach who came from a person expects that person
   * back, and the coach who came from Today expects the list.
   */
  readonly from?: "client"
}

export const validateSchedulingSearch = (search: Record<string, unknown>): SchedulingSearch => ({
  ...(typeof search.client === "string" && search.client.length > 0
    ? { client: search.client }
    : {}),
  ...(search.from === "client" ? { from: "client" as const } : {}),
})
