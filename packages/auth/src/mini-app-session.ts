import { WorkspaceId } from "@praximo/domain"
import { Context, Effect, Layer, Schema } from "effect"

/**
 * Verifies Telegram Mini App init data and resolves it to a workspace member.
 * The first-party Better-Auth `telegram-mini-app` plugin (client onboarding
 * spec) is implemented behind this seam.
 */
export interface Interface {
  readonly verify: (initData: string) => Effect.Effect<Session, VerificationFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/auth/MiniAppSession",
) {}

export const Session = Schema.Struct({
  workspace: WorkspaceId,
  telegramUserId: Schema.NonEmptyString,
})

export interface Session extends Schema.Schema.Type<typeof Session> {}

export class VerificationFailed extends Schema.TaggedErrorClass<VerificationFailed>()(
  "MiniAppSession.VerificationFailed",
  {
    reason: Schema.String,
  },
) {}

/**
 * Unwired until the Better-Auth plugin ticket: verifying init data needs the bot
 * token and the HMAC scheme. It rejects rather than issuing an unchecked session.
 */
export const layer = Layer.sync(Service, () => {
  const verify = Effect.fn("MiniAppSession.verify")(function* (_initData: string) {
    return yield* Effect.fail(
      new VerificationFailed({ reason: "mini app verification is not wired yet" }),
    )
  })

  return Service.of({ verify })
})

export * as MiniAppSession from "./mini-app-session.ts"
