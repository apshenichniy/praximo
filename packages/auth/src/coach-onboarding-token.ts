import { CoachOnboardingInviteCode, CoachOnboardingInviteCodePattern } from "@praximo/domain"
import { Config, Context, Effect, Layer, Schema } from "effect"

const StartParameterPrefix = "ws_"
const TelegramUsernamePattern = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

/**
 * The coach-onboarding start-param codec. It builds `t.me/{bot}?start=ws_{code}`
 * deep links and reads the code back off an incoming `/start` — a plain,
 * unauthenticated envelope around the short invite code. There is no secret and
 * no signature: the code itself is the unguessable token, and the bot resolves it
 * against `coach_onboarding_invite.code`. `verify` is only the cheap pre-DB junk
 * filter (§T1) — it rejects malformed and legacy `ws_{id}_{sig}` links.
 */
export interface Interface {
  readonly linkFor: (code: CoachOnboardingInviteCode) => Effect.Effect<string>
  readonly verify: (parameter: string) => Effect.Effect<CoachOnboardingInviteCode, InvalidToken>
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

const makeLayer = (usernameConfig: Config.Config<string>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const username = yield* usernameConfig

      if (!TelegramUsernamePattern.test(username)) {
        return yield* new InvalidConfiguration({ field: "MANAGER_BOT_USERNAME" })
      }

      const linkFor = (code: CoachOnboardingInviteCode): Effect.Effect<string> =>
        Effect.succeed(`https://t.me/${username}?start=ws_${code}`)

      const verify = Effect.fn("CoachOnboardingToken.verify")(function* (parameter: string) {
        const code = parameter.startsWith(StartParameterPrefix)
          ? parameter.slice(StartParameterPrefix.length)
          : undefined
        // The domain pattern is the single source of truth for a valid code;
        // legacy `ws_{id}_{sig}` links fail it and fall through to InvalidToken.
        if (code === undefined || !CoachOnboardingInviteCodePattern.test(code)) {
          return yield* new InvalidToken()
        }
        return CoachOnboardingInviteCode.make(code)
      })

      return Service.of({ linkFor, verify })
    }),
  )

export const layer = makeLayer(Config.nonEmptyString("MANAGER_BOT_USERNAME"))

export const testLayer = (username: string) => makeLayer(Config.succeed(username))

export * as CoachOnboardingToken from "./coach-onboarding-token.ts"
