import { createHmac, timingSafeEqual } from "node:crypto"
import { CoachOnboardingInviteId } from "@praximo/domain"
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

const ParameterPattern = /^ws_([A-Za-z0-9_-]{1,32})_([A-Za-z0-9_-]{22})$/
const TelegramUsernamePattern = /^[A-Za-z][A-Za-z0-9_]{4,31}$/
const TelegramStartParameterMaxLength = 64

export interface Interface {
  readonly parameterFor: (
    inviteId: CoachOnboardingInviteId,
  ) => Effect.Effect<string, InvalidConfiguration>
  readonly linkFor: (
    inviteId: CoachOnboardingInviteId,
  ) => Effect.Effect<string, InvalidConfiguration>
  readonly verify: (parameter: string) => Effect.Effect<CoachOnboardingInviteId, InvalidToken>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/auth/CoachOnboardingToken",
) {}

export class InvalidConfiguration extends Schema.TaggedErrorClass<InvalidConfiguration>()(
  "CoachOnboardingToken.InvalidConfiguration",
  { field: Schema.String },
) {}

export class InvalidToken extends Schema.TaggedErrorClass<InvalidToken>()(
  "CoachOnboardingToken.InvalidToken",
  {},
) {}

const makeLayer = (
  secretConfig: Config.Config<Redacted.Redacted>,
  usernameConfig: Config.Config<string>,
) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const secret = Redacted.value(yield* secretConfig)
      const username = yield* usernameConfig

      if (!TelegramUsernamePattern.test(username)) {
        return yield* new InvalidConfiguration({ field: "MANAGER_BOT_USERNAME" })
      }

      const signatureFor = (inviteId: string): string =>
        createHmac("sha256", secret)
          .update(`coach-onboarding:${inviteId}`)
          .digest("base64url")
          .slice(0, 22)

      const parameterFor = Effect.fn("CoachOnboardingToken.parameterFor")(function* (
        inviteId: CoachOnboardingInviteId,
      ) {
        const parameter = `ws_${inviteId}_${signatureFor(inviteId)}`
        if (parameter.length > TelegramStartParameterMaxLength) {
          return yield* new InvalidConfiguration({ field: "coach onboarding invite id" })
        }
        return parameter
      })

      const linkFor = Effect.fn("CoachOnboardingToken.linkFor")(function* (
        inviteId: CoachOnboardingInviteId,
      ) {
        const parameter = yield* parameterFor(inviteId)
        return `https://t.me/${username}?start=${parameter}`
      })

      const verify = Effect.fn("CoachOnboardingToken.verify")(function* (parameter: string) {
        if (parameter.length > TelegramStartParameterMaxLength) return yield* new InvalidToken()
        const match = ParameterPattern.exec(parameter)
        if (match === null) return yield* new InvalidToken()
        const inviteId = match[1]
        const receivedSignature = match[2]
        if (inviteId === undefined || receivedSignature === undefined) {
          return yield* new InvalidToken()
        }

        const expectedSignature = signatureFor(inviteId)
        if (
          !timingSafeEqual(
            Buffer.from(receivedSignature, "utf8"),
            Buffer.from(expectedSignature, "utf8"),
          )
        ) {
          return yield* new InvalidToken()
        }

        return CoachOnboardingInviteId.make(inviteId)
      })

      return Service.of({ parameterFor, linkFor, verify })
    }),
  )

export const layer = makeLayer(
  Config.redacted("COACH_ONBOARDING_TOKEN_SECRET"),
  Config.nonEmptyString("MANAGER_BOT_USERNAME"),
)

export const testLayer = (secret: string, username: string) =>
  makeLayer(Config.succeed(Redacted.make(secret)), Config.succeed(username))

export * as CoachOnboardingToken from "./coach-onboarding-token.ts"
