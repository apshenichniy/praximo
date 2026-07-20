import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http"
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

/**
 * The Drizzle-over-Neon connection seam. Repositories depend on `Database` and
 * read every row through `client`; nothing else in the package constructs a
 * connection. This is the single seam the repository tests resolve through — the
 * test layer points it at the dev Neon branch via `DATABASE_URL`.
 *
 * The driver is the neon-http (HTTP) driver ADR 0003 fixed: it runs on workerd
 * and, being fetch-based, works equally in Node for tests and the reset script.
 *
 * Per ADR 0002 the package only *declares* the config it needs (`DATABASE_URL`);
 * each app supplies the value through its own ConfigProvider over the Worker env.
 */

/** Untyped relations — repos use the core query builder (`.select().from(...)`). */
export type DrizzleClient = NeonHttpDatabase

/** Build a Drizzle client from a raw connection string (shared with db:reset). */
export const makeClient = (connectionString: string): DrizzleClient => drizzle(connectionString)

export interface Interface {
  readonly client: DrizzleClient
}

export class Service extends Context.Service<Service, Interface>()("@praximo/db/Database") {}

/**
 * The package's one infrastructure error: a query, or the decode of its rows,
 * failed (ADR 0002 — infra errors live in the owning package). Repos surface
 * this instead of leaking a Drizzle/Neon exception or an invalid row.
 */
export class QueryFailed extends Schema.TaggedErrorClass<QueryFailed>()("Database.QueryFailed", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * Take the first row of a single-row query and decode it into a domain entity,
 * mapping a decode failure to a `<operation>.decode` {@link QueryFailed}. A
 * missing row is caller-specific — `onMissing` supplies the domain "not found"
 * (or another QueryFailed) — so every repo's find shares one shape.
 */
export const decodeFirstRow = <A, EMissing>(
  rows: ReadonlyArray<unknown>,
  operation: string,
  decode: (row: unknown) => Effect.Effect<A, unknown>,
  onMissing: () => Effect.Effect<never, EMissing>,
): Effect.Effect<A, EMissing | QueryFailed> =>
  Effect.gen(function* () {
    const row = rows[0]
    if (row === undefined) return yield* onMissing()

    return yield* decode(row).pipe(
      Effect.mapError((cause) => new QueryFailed({ operation: `${operation}.decode`, cause })),
    )
  })

/** The live connection, resolved from the `DATABASE_URL` config the app supplies. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const url = yield* Config.redacted("DATABASE_URL")
    return Service.of({ client: makeClient(Redacted.value(url)) })
  }),
)

/**
 * Test layer over an explicit connection string (the dev Neon branch). Repository
 * tests skip entirely when `DATABASE_URL` is absent, so `layer` is never resolved
 * without it.
 */
export const testLayer = (connectionString: string): Layer.Layer<Service> =>
  // `Layer.sync`, not `Layer.succeed`: the client is built only when the layer is
  // actually resolved, so a skipped test suite never opens (or validates) a
  // connection at collection time.
  Layer.sync(Service, () => Service.of({ client: makeClient(connectionString) }))

export * as Database from "./client.ts"
