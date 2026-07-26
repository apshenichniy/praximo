import { Database } from "../packages/db/src/client.ts"
import {
  clearDemoClients,
  connectedWorkspaces,
  demoSeedSummary,
  type DemoTarget,
  parseDemoArgs,
  resolveDemoTarget,
  seedDemoClients,
} from "../packages/db/src/demo-clients.ts"
import { assertNotProd, resolveStage } from "../packages/db/src/reset.ts"
import { Effect, Layer } from "effect"
import { requireEnv } from "./env.ts"

/**
 * `bun db:demo` — seed clients, invitations and sessions into an existing
 * connected workspace, so the states #56 and #61 render are reachable at all.
 *
 * **Deliberately not part of `db:reset`.** A reset drops and recreates the
 * `public` schema, taking the coach's workspace and bot connection with it, so
 * every UI iteration would end in re-provisioning a bot through @BotFather. This
 * writes into a workspace that already exists and touches neither. And if demo
 * clients were seeded by `db:reset`, the state "a brand-new coach with an empty
 * practice" — the first screen a real human sees — would stop being reachable.
 *
 * `--clear` removes only what this wrote, identified by the `demo_` id prefix.
 * Refuses `prod` through the same guard `db:reset` uses (ADR 0003).
 */

/**
 * Report a refusal the operator is meant to act on, and stop.
 *
 * An unusable target and a mistyped flag are the two errors this command
 * actually produces, and both carry the next thing to type. A raw stack trace
 * would bury that under twenty lines of `throw new DemoTargetUnresolved`.
 */
const refuse = (error: unknown): never => {
  console.error(`db:demo — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const stage = resolveStage({ APP_STAGE: process.env.APP_STAGE, USER: process.env.USER })
assertNotProd(stage)
const args = ((): ReturnType<typeof parseDemoArgs> => {
  try {
    return parseDemoArgs(process.argv.slice(2))
  } catch (error) {
    return refuse(error)
  }
})()

const client = Database.makeClient(requireEnv("DATABASE_URL"))
const database = Layer.succeed(Database.Service, Database.Service.of({ client }))

const run = <A, E>(effect: Effect.Effect<A, E, Database.Service>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(database)))

// Resolved outside the Effect so an ambiguous target reports its own message
// rather than arriving wrapped as a fiber defect — this is the error an operator
// is most likely to see, and it is the one that tells them what to type next.
const candidates = await run(connectedWorkspaces())
const target = ((): DemoTarget => {
  try {
    return resolveDemoTarget(candidates, args.bot)
  } catch (error) {
    return refuse(error)
  }
})()
const where = `${target.botUsername ?? target.telegramBotId ?? target.workspaceId} ("${target.workspaceName}")`

if (args.clear) {
  console.log(`db:demo — clearing demo clients from ${where} (stage ${stage})`)
  await run(clearDemoClients(target.workspaceId))
  console.log("db:demo — done: every row with a demo_ id is gone; nothing else was touched")
} else {
  console.log(`db:demo — seeding demo clients into ${where} (stage ${stage})`)
  // Re-seeding clears first, so times are refreshed rather than collided on.
  await run(seedDemoClients(new Date(), target.workspaceId))
  console.log(
    `db:demo — done: ${demoSeedSummary.clients} clients, ${demoSeedSummary.invites} invitations, ${demoSeedSummary.sessions} sessions, all timed from now`,
  )
}
