import { TelegramId } from "@praximo/domain"
import { Clock, Config, Context, Effect, Layer, Schema } from "effect"

/**
 * Telegram's own Ed25519 public keys, one per environment. They are public
 * values, published for exactly this purpose — the point of hardcoding them is
 * that the *trust anchor* is not a deployment value: `TELEGRAM_ENV` chooses
 * between two keys the source already contains, it never supplies one. This is
 * the same shape `manager-init-data.ts` uses, where the HMAC construction is in
 * source and only the bot token is configuration.
 */
const TelegramPublicKeys = {
  production: "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
  test: "40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec",
} as const

const WEB_APP_DATA_SUFFIX = ":WebAppData"

export interface VerifiedLaunch {
  readonly telegramBotId: string
  readonly telegramUserId: TelegramId
  /** The credential's own `auth_date`, in milliseconds. */
  readonly authDateMillis: number
}

/**
 * Third-party verification of a coach Mini App launch (ADR 0006).
 *
 * One operation, and it takes the bot the launch claims to come from: the coach
 * bot's Mini App URL carries `?b=<telegramBotId>`, so verification runs against
 * a named candidate *before* any database access. The candidate is untrusted —
 * Telegram signs `<botId>:WebAppData` together with the payload, so a wrong or
 * borrowed value fails to verify rather than resolving someone else's workspace.
 *
 * `maxAgeMillis` is a parameter rather than a constant because the two kinds of
 * call want different windows: reads accept the 24 hours the admin path does,
 * while a state change — the legally operative first write among them — accepts
 * fifteen minutes.
 */
export interface Interface {
  readonly verify: (
    initData: string,
    candidateBotId: string,
    maxAgeMillis: number,
  ) => Effect.Effect<VerifiedLaunch, VerificationFailed>
  readonly unverifiedTelegramUserId: (
    initData: string,
  ) => Effect.Effect<TelegramId, VerificationFailed>
}

export class Service extends Context.Service<Service, Interface>()("@praximo/auth/CoachInitData") {}

export class InvalidConfiguration extends Schema.TaggedErrorClass<InvalidConfiguration>()(
  "CoachInitData.InvalidConfiguration",
  { field: Schema.String },
) {}

export class VerificationFailed extends Schema.TaggedErrorClass<VerificationFailed>()(
  "CoachInitData.VerificationFailed",
  { reason: Schema.String },
) {}

const TelegramUser = Schema.Struct({ id: Schema.Number })
const decodeTelegramUser = Schema.decodeUnknownSync(TelegramUser)

const decodeHex = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("malformed hex")
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/**
 * Telegram sends `signature` base64url-encoded and unpadded. `atob` only speaks
 * standard base64, so the alphabet is translated and the padding restored — a
 * lenient Node-only decoder would work here and then reject on workerd.
 */
const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const standard = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * The bytes Telegram signed: the bot's own id, then every received field except
 * `hash` and `signature`, sorted, one `key=value` per line.
 *
 * `hash` is excluded and never consulted anywhere else either. A coach owns
 * their bot in @BotFather and can read its token; under the HMAC scheme that
 * token forges `initData` for any Telegram user id, under Ed25519 it forges
 * nothing. No leniency for an older client may reintroduce it.
 */
const dataCheckString = (params: URLSearchParams, botId: string): string => {
  const fields = new URLSearchParams(params)
  fields.delete("hash")
  fields.delete("signature")
  fields.sort()
  const lines = [...fields.entries()].map(([key, value]) => `${key}=${value}`)
  return [`${botId}${WEB_APP_DATA_SUFFIX}`, ...lines].join("\n")
}

/**
 * The `user.id` a launch claims, with the manager path's own guard on it: an id
 * that is not a safe positive integer would round-trip through `String()` into a
 * key nothing can match, which reads as a lookup miss rather than as the parser
 * differential it actually is.
 */
const readTelegramUserId = (params: URLSearchParams): TelegramId => {
  const userJson = params.get("user")
  if (!userJson) throw new Error("missing user")
  const user = decodeTelegramUser(JSON.parse(userJson))
  if (!Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("invalid Telegram user id")
  }
  return TelegramId.make(String(user.id))
}

interface Launch {
  readonly signature: Uint8Array<ArrayBuffer>
  readonly signed: Uint8Array<ArrayBuffer>
  readonly telegramUserId: TelegramId
  readonly authDateMillis: number
}

/**
 * Everything that can be decided without the key. It runs first so a malformed
 * launch never reaches the (comparatively expensive) signature check, and so
 * every rejection below is expressed the same way.
 */
const readLaunch = (
  initData: string,
  botId: string,
  maxAgeMillis: number,
  nowMillis: number,
): Launch => {
  if (!/^\d+$/.test(botId)) throw new Error("malformed bot id")

  const params = new URLSearchParams(initData)

  const signature = params.get("signature")
  if (!signature) throw new Error("missing signature")

  const authDate = params.get("auth_date")
  if (!authDate || !/^\d+$/.test(authDate)) throw new Error("missing or malformed auth_date")
  const authDateMillis = Number(authDate) * 1_000
  if (
    !Number.isSafeInteger(authDateMillis) ||
    authDateMillis > nowMillis ||
    nowMillis - authDateMillis > maxAgeMillis
  ) {
    throw new Error("auth_date outside the accepted window")
  }

  return {
    signature: decodeBase64Url(signature),
    signed: new TextEncoder().encode(dataCheckString(params, botId)),
    telegramUserId: readTelegramUserId(params),
    authDateMillis,
  }
}

/**
 * The verifier over one public key.
 *
 * `@telegram-apps/init-data-node` was the obvious candidate and does not fit:
 * its exported `validate3rd` takes only `{ expiresIn, test }`, so the public key
 * is chosen by a boolean from two values baked into that package — there is no
 * way to hand it one, which makes both a real signature test and a local
 * development key impossible. Its verifier also reaches for Node's `Buffer` and
 * decodes the signature with Node's lenient base64. The scheme itself is thirty
 * lines of WebCrypto, available unchanged on workerd, Node and the browser.
 */
const makeLayer = (publicKeyHex: Config.Config<string>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const hex = yield* publicKeyHex
      // Imported once, at layer construction: a key the runtime cannot import
      // is a configuration fault and should be loud at startup rather than
      // indistinguishable from a bad signature on every launch.
      const key = yield* Effect.tryPromise({
        try: () => crypto.subtle.importKey("raw", decodeHex(hex), "Ed25519", false, ["verify"]),
        catch: () => new InvalidConfiguration({ field: "TELEGRAM_ENV" }),
      })

      const verify = Effect.fn("CoachInitData.verify")(function* (
        initData: string,
        candidateBotId: string,
        maxAgeMillis: number,
      ) {
        const nowMillis = yield* Clock.currentTimeMillis
        const launch = yield* Effect.try({
          try: () => readLaunch(initData, candidateBotId, maxAgeMillis, nowMillis),
          catch: () => new VerificationFailed({ reason: "coach init data is not verifiable" }),
        })
        const verified = yield* Effect.tryPromise({
          try: () => crypto.subtle.verify("Ed25519", key, launch.signature, launch.signed),
          catch: () => new VerificationFailed({ reason: "coach init data is not verifiable" }),
        })
        if (!verified) {
          return yield* new VerificationFailed({ reason: "coach init data is not verifiable" })
        }
        return {
          telegramBotId: candidateBotId,
          telegramUserId: launch.telegramUserId,
          authDateMillis: launch.authDateMillis,
        } satisfies VerifiedLaunch
      })

      /**
       * The user id a launch *claims*, read without checking anything.
       *
       * Named to be uncomfortable, because it is only ever allowed to do one
       * thing: propose which bot to verify against, for a launch that carried no
       * `?b=` — a bot provisioned before the Mini App URL grew the parameter, or
       * a Main Mini App URL a coach pasted themselves. Ed25519 signs
       * `<botId>:WebAppData`, so without a candidate bot there is nothing to
       * verify against at all, and this is the only way to name one.
       *
       * It authorizes nothing. The caller must look a candidate up, verify
       * against that candidate's bot, and then resolve the principal from the
       * *verified* pair — so a launch claiming someone else's id selects a
       * candidate whose signature check then fails.
       */
      const unverifiedTelegramUserId = Effect.fn("CoachInitData.unverifiedTelegramUserId")(
        function* (initData: string) {
          return yield* Effect.try({
            try: () => readTelegramUserId(new URLSearchParams(initData)),
            catch: () => new VerificationFailed({ reason: "coach init data is not readable" }),
          })
        },
      )

      return Service.of({ verify, unverifiedTelegramUserId })
    }),
  )

export const layer = makeLayer(
  Config.literals(["production", "test"], "TELEGRAM_ENV").pipe(
    Config.map((environment) => TelegramPublicKeys[environment]),
  ),
)

/**
 * A verifier anchored on an explicit public key. Used by the signature tests,
 * and by local development, where the app mints real `initData` with a
 * throwaway private key and runs this very verifier against its public half —
 * so no authentication-bypass path exists at all. Supplying the wrong key can
 * only make verification fail; it can never make it succeed.
 */
export const testLayer = (publicKeyHex: string) => makeLayer(Config.succeed(publicKeyHex))

export * as CoachInitData from "./coach-init-data.ts"
