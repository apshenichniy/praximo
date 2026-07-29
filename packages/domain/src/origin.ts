/**
 * A configured origin, reduced to the part a link may be built on.
 *
 * Two callers in two packages build absolute URLs onto a host that arrives from
 * configuration — the legal texts (`@praximo/i18n`, #191) and the invitation's
 * web door (#224) — and both need the same two things done to it: drop whatever
 * query or fragment it carried, and drop trailing slashes so the join produces
 * one.
 *
 * Dropping the query and the fragment is not tidiness. These origins are pasted
 * into consent buttons and forwarded to clients: a parameter the origin happened
 * to carry — a stage's `?b=<botId>`, say — would ride into somebody else's chat
 * and say something about who was sent it.
 *
 * Built by hand rather than through `URL`, which this package cannot assume: it
 * is typechecked against `lib: ES2022` with no DOM (ADR 0002). That was never
 * load-bearing — there is nothing here to percent-encode and nothing that can
 * throw.
 */
export const bareOrigin = (origin: string): string =>
  (origin.split(/[?#]/)[0] ?? "").replace(/\/+$/, "")
