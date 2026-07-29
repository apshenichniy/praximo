/**
 * The meeting already on the books, as every surface on this page needs it.
 *
 * One declaration because three used to carry the same three fields — the view
 * the page renders, the confirmation after the commit, and the greeting's own
 * prop. Three copies of a shape is three places to forget when a fourth field
 * arrives.
 *
 * `scheduledAt` is an ISO string rather than a `Date`: this crosses a server
 * function boundary, and a `Date` that survives serialisation on one path and
 * not another is a bug waiting for whichever path is tested less.
 */
export interface SessionSummary {
  readonly scheduledAt: string
  readonly durationMinutes: number
  readonly kind: string
}
