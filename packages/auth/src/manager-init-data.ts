import { createHmac, timingSafeEqual } from "node:crypto"
import { URLSearchParams } from "node:url"
import { TelegramId } from "@praximo/domain"
import { Clock, Config, Context, Effect, Layer, Redacted, Schema } from "effect"

const MAX_AGE_MILLIS = 24 * 60 * 60 * 1_000
const WEB_APP_DATA_KEY = "WebAppData"

export interface Interface {
  readonly verify: (initData: string) => Effect.Effect<TelegramId, VerificationFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/auth/ManagerInitData",
) {}

export class VerificationFailed extends Schema.TaggedErrorClass<VerificationFailed>()(
  "ManagerInitData.VerificationFailed",
  {
    reason: Schema.String,
  },
) {}

const TelegramUser = Schema.Struct({ id: Schema.Number })
const decodeTelegramUser = Schema.decodeUnknownSync(TelegramUser)

const verifyAt = (initData: string, token: string, nowMillis: number): TelegramId => {
  const params = new URLSearchParams(initData)
  const receivedHash = params.get("hash")
  if (!receivedHash || !/^[0-9a-f]{64}$/.test(receivedHash)) {
    throw new Error("missing or malformed hash")
  }

  params.delete("hash")
  params.sort()
  const dataCheckString = [...params.entries()].map(([key, value]) => `${key}=${value}`).join("\n")

  const secretKey = createHmac("sha256", WEB_APP_DATA_KEY).update(token).digest()
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest()
  const receivedHashBytes = Buffer.from(receivedHash, "hex")

  if (
    receivedHashBytes.byteLength !== expectedHash.byteLength ||
    !timingSafeEqual(receivedHashBytes, expectedHash)
  ) {
    throw new Error("signature mismatch")
  }

  const authDate = params.get("auth_date")
  if (!authDate || !/^\d+$/.test(authDate)) {
    throw new Error("missing or malformed auth_date")
  }
  const authDateMillis = Number(authDate) * 1_000
  if (
    !Number.isSafeInteger(authDateMillis) ||
    authDateMillis > nowMillis ||
    nowMillis - authDateMillis > MAX_AGE_MILLIS
  ) {
    throw new Error("auth_date outside the accepted window")
  }

  const userJson = params.get("user")
  if (!userJson) throw new Error("missing user")
  const user = decodeTelegramUser(JSON.parse(userJson))
  if (!Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("invalid Telegram user id")
  }

  return TelegramId.make(String(user.id))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const token = yield* Config.redacted("MANAGER_BOT_TOKEN")

    const verify = Effect.fn("ManagerInitData.verify")(function* (initData: string) {
      const nowMillis = yield* Clock.currentTimeMillis
      return yield* Effect.try({
        try: () => verifyAt(initData, Redacted.value(token), nowMillis),
        catch: () => new VerificationFailed({ reason: "manager init data verification failed" }),
      })
    })

    return Service.of({ verify })
  }),
)

export * as ManagerInitData from "./manager-init-data.ts"
