import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { CoachInitData } from "./coach-init-data.ts"

const BOT_ID = "9100777"
const OTHER_BOT_ID = "9100778"
const AUTH_DATE = Date.parse("2026-07-23T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1_000
const SHORT_WINDOW = 15 * 60 * 1_000

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

const toBase64Url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")

/** `CryptoKeyPair` is not a type in this package's ambient lib; this is. */
type Ed25519Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>
interface Ed25519Pair {
  readonly privateKey: Ed25519Key
  readonly publicKey: Ed25519Key
}

/**
 * A throwaway Ed25519 pair standing in for Telegram's. The scheme is the whole
 * subject here, so these tests mint genuinely signed launches and run the real
 * verifier — nothing about the signature check is stubbed.
 */
const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
])) as Ed25519Pair
const PUBLIC_KEY = toHex(await crypto.subtle.exportKey("raw", keyPair.publicKey))

const otherPair = (await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
])) as Ed25519Pair
const OTHER_PUBLIC_KEY = toHex(await crypto.subtle.exportKey("raw", otherPair.publicKey))

/** Exactly what Telegram signs: the bot's id, then the sorted received fields. */
const signedBytes = (fields: URLSearchParams, botId: string): Uint8Array => {
  const payload = new URLSearchParams(fields)
  payload.delete("hash")
  payload.delete("signature")
  payload.sort()
  const lines = [...payload.entries()].map(([key, value]) => `${key}=${value}`)
  return new TextEncoder().encode([`${botId}:WebAppData`, ...lines].join("\n"))
}

const launch = async (
  options: {
    readonly botId?: string
    readonly authDate?: number
    readonly user?: unknown
    readonly extra?: Record<string, string>
  } = {},
): Promise<URLSearchParams> => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor((options.authDate ?? AUTH_DATE) / 1_000)),
    query_id: "AAEAAAE",
    user: JSON.stringify(options.user ?? { id: 700000103, first_name: "Ada" }),
    ...options.extra,
  })
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    signedBytes(params, options.botId ?? BOT_ID),
  )
  params.set("signature", toBase64Url(signature))
  return params
}

const verifier = (publicKey = PUBLIC_KEY) => CoachInitData.testLayer(publicKey)

/**
 * The same launch with its Ed25519 signature stripped and a genuine WebAppData
 * HMAC put in its place — what a coach who reads their own bot token out of
 * @BotFather can produce for any Telegram user id they like.
 */
const withManagerStyleHash = async (
  params: URLSearchParams,
  botToken: string,
): Promise<URLSearchParams> => {
  const forged = new URLSearchParams(params)
  forged.delete("signature")
  forged.delete("hash")
  forged.sort()
  const encoder = new TextEncoder()
  const seed = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const secret = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.sign("HMAC", seed, encoder.encode(botToken)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const lines = [...forged.entries()].map(([name, value]) => `${name}=${value}`).join("\n")
  forged.set("hash", toHex(await crypto.subtle.sign("HMAC", secret, encoder.encode(lines))))
  return forged
}

describe("CoachInitData", () => {
  it.effect("accepts a launch Telegram signed for the bot it names", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const initData = (yield* Effect.promise(() => launch())).toString()

      expect(yield* (yield* CoachInitData.Service).verify(initData, BOT_ID, DAY)).toEqual({
        telegramBotId: BOT_ID,
        telegramUserId: "700000103",
        authDateMillis: AUTH_DATE,
      })
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("rejects a launch whose fields were edited after signing", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const params = yield* Effect.promise(() => launch())
      params.set("user", JSON.stringify({ id: 700000999, first_name: "Ada" }))

      const error = yield* Effect.flip(
        (yield* CoachInitData.Service).verify(params.toString(), BOT_ID, DAY),
      )
      expect(error._tag).toBe("CoachInitData.VerificationFailed")
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("rejects a launch minted for a different bot", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const initData = (yield* Effect.promise(() => launch({ botId: OTHER_BOT_ID }))).toString()

      // The bot id is part of what Telegram signs, so borrowing another coach's
      // `?b=` cannot resolve their workspace — it just fails to verify.
      const service = yield* CoachInitData.Service
      expect((yield* Effect.flip(service.verify(initData, BOT_ID, DAY)))._tag).toBe(
        "CoachInitData.VerificationFailed",
      )
      expect(yield* service.verify(initData, OTHER_BOT_ID, DAY)).toMatchObject({
        telegramBotId: OTHER_BOT_ID,
      })
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("rejects a launch signed by a key that is not the trust anchor", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const initData = (yield* Effect.promise(() => launch())).toString()

      const error = yield* Effect.flip((yield* CoachInitData.Service).verify(initData, BOT_ID, DAY))
      expect(error._tag).toBe("CoachInitData.VerificationFailed")
    }).pipe(Effect.provide(verifier(OTHER_PUBLIC_KEY))),
  )

  it.effect("holds each caller to the window it asked for", () =>
    Effect.gen(function* () {
      const service = yield* CoachInitData.Service
      const initData = (yield* Effect.promise(() => launch())).toString()

      // Twenty minutes on: still a valid read, no longer a valid state change.
      yield* TestClock.setTime(AUTH_DATE + 20 * 60_000)
      expect(yield* service.verify(initData, BOT_ID, DAY)).toMatchObject({
        authDateMillis: AUTH_DATE,
      })
      expect((yield* Effect.flip(service.verify(initData, BOT_ID, SHORT_WINDOW)))._tag).toBe(
        "CoachInitData.VerificationFailed",
      )

      yield* TestClock.setTime(AUTH_DATE + DAY + 1_000)
      expect((yield* Effect.flip(service.verify(initData, BOT_ID, DAY)))._tag).toBe(
        "CoachInitData.VerificationFailed",
      )

      yield* TestClock.setTime(AUTH_DATE - 1_000)
      expect((yield* Effect.flip(service.verify(initData, BOT_ID, DAY)))._tag).toBe(
        "CoachInitData.VerificationFailed",
      )
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("never accepts a launch on the strength of its hash", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const service = yield* CoachInitData.Service
      const params = yield* Effect.promise(() => launch())

      // A hash the HMAC scheme would accept — a coach can compute one from the
      // bot token @BotFather shows them — buys nothing here.
      const forged = yield* Effect.promise(() =>
        withManagerStyleHash(params, "9100777:AAHkq2Lb8fN1sQx3TzVpYr7WcJd4MgEuKvB"),
      )

      expect((yield* Effect.flip(service.verify(forged.toString(), BOT_ID, DAY)))._tag).toBe(
        "CoachInitData.VerificationFailed",
      )

      // And a hash sitting beside a real signature changes nothing: it is
      // excluded from the signed payload rather than merely ignored.
      const withHash = new URLSearchParams(params)
      withHash.set("hash", "0".repeat(64))
      expect(yield* service.verify(withHash.toString(), BOT_ID, DAY)).toMatchObject({
        telegramUserId: "700000103",
      })
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("rejects a signed user id that is not a safe positive integer", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const service = yield* CoachInitData.Service

      // Past 2^53 an id stops round-tripping through a JavaScript number, which
      // is a parser differential rather than a bigger id.
      const unsafe = Number.MAX_SAFE_INTEGER + 2
      for (const id of [0, -1, unsafe, "700000103"]) {
        const initData = (yield* Effect.promise(() =>
          launch({ user: { id, first_name: "Ada" } }),
        )).toString()
        expect((yield* Effect.flip(service.verify(initData, BOT_ID, DAY)))._tag).toBe(
          "CoachInitData.VerificationFailed",
        )
      }
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("reads the claimed user id without checking anything about it", () =>
    Effect.gen(function* () {
      const service = yield* CoachInitData.Service
      const params = yield* Effect.promise(() => launch())

      // Deliberately usable on a launch nothing has verified — that is the point
      // of it, and why the name says so. It only ever names a candidate bot for
      // a launch that arrived without `?b=`.
      params.set("signature", "not-a-signature")
      expect(yield* service.unverifiedTelegramUserId(params.toString())).toBe("700000103")

      // The one thing it does refuse is an id that cannot be a Telegram id.
      const malformed = yield* Effect.promise(() => launch({ user: { id: -1 } }))
      expect(
        (yield* Effect.flip(service.unverifiedTelegramUserId(malformed.toString())))._tag,
      ).toBe("CoachInitData.VerificationFailed")
    }).pipe(Effect.provide(verifier())),
  )

  it.effect("rejects a bot id that is not a bot id", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(AUTH_DATE + 60_000)
      const initData = (yield* Effect.promise(() => launch())).toString()

      const service = yield* CoachInitData.Service
      for (const candidate of ["", "9100777 ", "abc", "9100777:WebAppData"]) {
        expect((yield* Effect.flip(service.verify(initData, candidate, DAY)))._tag).toBe(
          "CoachInitData.VerificationFailed",
        )
      }
    }).pipe(Effect.provide(verifier())),
  )
})
