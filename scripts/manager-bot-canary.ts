import { fileURLToPath } from "node:url"
import { ConfigProvider, Effect, Exit } from "effect"
import { parseAdminTelegramIds, assertNotProd, resolveStage } from "../packages/db/src/reset.ts"
import { ManagerBotSender } from "../packages/telegram/src/manager-bot-sender.ts"

const canaryMessage = "Praximo manager-bot canary: delivery is working."

export const sendManagerBotCanary = Effect.fn("ManagerBotCanary.send")(function* (
  stage: string,
  adminTelegramIds: string,
) {
  assertNotProd(stage)
  const [recipient] = parseAdminTelegramIds(adminTelegramIds)
  if (recipient === undefined) {
    return yield* Effect.die(
      new Error("validated ADMIN_TELEGRAM_IDS unexpectedly contained no ids"),
    )
  }

  const sender = yield* ManagerBotSender.Service
  yield* sender.sendText(recipient, canaryMessage)
})

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`missing ${name} — set it in the root .env (see .env.example)`)
  }
  return value
}

interface CliOutput {
  readonly log: (message: string) => void
  readonly error: (message: string) => void
}

export const runManagerBotCanaryCli = async (
  program: Effect.Effect<void, unknown>,
  output: CliOutput = console,
): Promise<number> => {
  output.log("manager-bot:canary — sending through the live manager-bot seam")
  const exit = await Effect.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    output.error("manager-bot:canary — delivery failed; inspect secure runtime logs")
    return 1
  }

  output.log("manager-bot:canary — Telegram accepted the message")
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const program = Effect.suspend(() =>
    sendManagerBotCanary(
      resolveStage({
        APP_STAGE: process.env.APP_STAGE,
        USER: process.env.USER,
      }),
      requireEnv("ADMIN_TELEGRAM_IDS"),
    ).pipe(
      Effect.provide(ManagerBotSender.layer),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(process.env))),
    ),
  )

  process.exitCode = await runManagerBotCanaryCli(program)
}
