/**
 * Genuinely signed coach Mini App launches for the server tests.
 *
 * Nothing about verification is stubbed: these mint real Ed25519 `initData`
 * with a throwaway key pair and hand `CoachInitData.testLayer` its public half,
 * which is the same shape local development uses (ADR 0006). A wrong key can
 * only make verification fail.
 */
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>

const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as {
  readonly privateKey: Key
  readonly publicKey: Key
}

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

export const TEST_PUBLIC_KEY = toHex(await crypto.subtle.exportKey("raw", pair.publicKey))

export const launchFor = async (options: {
  readonly botId: string
  readonly authDate: number
  readonly telegramUserId?: number
}): Promise<string> => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(options.authDate / 1_000)),
    query_id: "AAEAAAE",
    user: JSON.stringify({ id: options.telegramUserId ?? 700000103, first_name: "Ada" }),
  })
  const sorted = new URLSearchParams(params)
  sorted.sort()
  const lines = [...sorted.entries()].map(([key, value]) => `${key}=${value}`)
  const signature = await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode([`${options.botId}:WebAppData`, ...lines].join("\n")),
  )
  params.set(
    "signature",
    btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", ""),
  )
  return params.toString()
}
