import { Config, Context, Effect, Layer, Redacted, Schema } from "effect"

export interface Interface {
  readonly encrypt: (token: string) => Effect.Effect<string, EncryptionFailed>
  readonly decrypt: (envelope: string) => Effect.Effect<string, DecryptionFailed>
}

export class Service extends Context.Service<Service, Interface>()(
  "@praximo/telegram/CoachBotCredential",
) {}

export class EncryptionFailed extends Schema.TaggedErrorClass<EncryptionFailed>()(
  "CoachBotCredential.EncryptionFailed",
  {},
) {}

export class DecryptionFailed extends Schema.TaggedErrorClass<DecryptionFailed>()(
  "CoachBotCredential.DecryptionFailed",
  {},
) {}

export class InvalidKey extends Schema.TaggedErrorClass<InvalidKey>()(
  "CoachBotCredential.InvalidKey",
  {},
) {}

const additionalData = new TextEncoder().encode("praximo:coach-bot-token:v1")

const encode = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

const decode = (value: string): Uint8Array => {
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
    (4 - (value.length % 4)) % 4,
  )}`
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const encodedKey = Redacted.value(yield* Config.redacted("COACH_BOT_CREDENTIAL_KEY"))
    const keyBytes = yield* Effect.try({
      try: () => decode(encodedKey),
      catch: () => new InvalidKey(),
    })
    if (keyBytes.byteLength !== 32) return yield* new InvalidKey()
    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, "AES-GCM", false, [
          "encrypt",
          "decrypt",
        ]),
      catch: () => new InvalidKey(),
    })

    const encrypt = Effect.fn("CoachBotCredential.encrypt")(function* (token: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: iv.buffer as ArrayBuffer,
              additionalData: additionalData.buffer as ArrayBuffer,
              tagLength: 128,
            },
            key,
            new TextEncoder().encode(token).buffer as ArrayBuffer,
          ),
        catch: () => new EncryptionFailed(),
      })
      return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`
    })

    const decrypt = Effect.fn("CoachBotCredential.decrypt")(function* (envelope: string) {
      const [version, encodedIv, encodedCiphertext, extra] = envelope.split(".")
      if (
        version !== "v1" ||
        encodedIv === undefined ||
        encodedCiphertext === undefined ||
        extra !== undefined
      ) {
        return yield* new DecryptionFailed()
      }
      const decoded = yield* Effect.try({
        try: () => ({ iv: decode(encodedIv), ciphertext: decode(encodedCiphertext) }),
        catch: () => new DecryptionFailed(),
      })
      const plaintext = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: decoded.iv.buffer as ArrayBuffer,
              additionalData: additionalData.buffer as ArrayBuffer,
              tagLength: 128,
            },
            key,
            decoded.ciphertext.buffer as ArrayBuffer,
          ),
        catch: () => new DecryptionFailed(),
      })
      return new TextDecoder().decode(plaintext)
    })

    return Service.of({ encrypt, decrypt })
  }),
)

export * as CoachBotCredential from "./coach-bot-credential.ts"
