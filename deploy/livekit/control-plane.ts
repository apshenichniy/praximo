import { createHash, randomUUID } from "node:crypto"
import { chmod, lstat, open, readFile } from "node:fs/promises"

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Config, Effect, Exit, Option, Redacted, Schedule, Schema } from "effect"

import { releaseWithExit, withCleanup } from "./cleanup.ts"

const cloudflareApi = "https://api.cloudflare.com/client/v4"
const cloudflareBucket = "praximo-prod-r2"
const cloudflareBucketJurisdiction = "eu"
const cloudflareR2Endpoint = "https://27940cd0d92bb3f03943a5378ccf68d3.eu.r2.cloudflarestorage.com"
const cloudflareR2ReadPermission = "6a018a9f2fc74eb6b293b0c548f38b39"
const cloudflareR2WritePermission = "2efd5506f9c8494dacb1fa10a3e7d5b6"
const cloudflareDnsWritePermission = "4755a26eedb94da69e1066d98aa820be"
const roomDnsRecordId = "f8d7076f1bad0b017d2d60820b657766"
const tailscaleApi = "https://api.tailscale.com/api/v2"

const CloudflareEnvelope = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Unknown,
})
const CloudflareErrorEnvelope = Schema.Struct({
  errors: Schema.Array(Schema.Struct({ message: Schema.String })),
})
const TokenIdentity = Schema.Struct({ id: Schema.String, status: Schema.String })
const CloudflareTokenContract = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  policies: Schema.Array(
    Schema.Struct({
      permission_groups: Schema.Array(Schema.Struct({ id: Schema.String })),
      resources: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
})
const DnsRecord = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  content: Schema.String,
  proxied: Schema.Boolean,
})
const TailscaleAccessToken = Schema.Struct({ access_token: Schema.String })
const TailscaleKey = Schema.Struct({ id: Schema.String, key: Schema.String })
const R2CreatedToken = Schema.Struct({ id: Schema.String, value: Schema.String })
const OvhVps = Schema.Struct({ name: Schema.String })
const OvhImage = Schema.Struct({ id: Schema.String, name: Schema.String })
const OvhTask = Schema.Struct({ id: Schema.Union([Schema.String, Schema.Number]) })
const OvhCredential = Schema.Struct({
  credentialId: Schema.Number,
  rules: Schema.Array(Schema.Struct({ method: Schema.String, path: Schema.String })),
})
const OvhFirewallRule = Schema.Struct({
  protocol: Schema.String,
  destinationPort: Schema.String,
  source: Schema.String,
  action: Schema.String,
  state: Schema.String,
})
const OvhFirewallState = Schema.Struct({
  ipOnFirewall: Schema.String,
  enabled: Schema.Boolean,
  state: Schema.String,
})
const OvhFirewallRuleDetail = Schema.Struct({
  sequence: Schema.Number,
  action: Schema.String,
  protocol: Schema.String,
  destinationPort: Schema.NullOr(Schema.String),
  tcpOption: Schema.NullOr(Schema.String),
  source: Schema.String,
  destination: Schema.String,
  state: Schema.String,
})
const StringArray = Schema.Array(Schema.String)
const NumberArray = Schema.Array(Schema.Number)

const expectedOvhFirewallRules = [
  { sequence: 0, action: "permit", protocol: "tcp", destinationPort: "eq 80", tcpOption: null },
  { sequence: 1, action: "permit", protocol: "tcp", destinationPort: "eq 443", tcpOption: null },
  {
    sequence: 2,
    action: "permit",
    protocol: "tcp",
    destinationPort: "eq 7881",
    tcpOption: null,
  },
  {
    sequence: 3,
    action: "permit",
    protocol: "udp",
    destinationPort: "eq 3478",
    tcpOption: null,
  },
  {
    sequence: 4,
    action: "permit",
    protocol: "udp",
    destinationPort: "range 50000 60000",
    tcpOption: null,
  },
  {
    sequence: 5,
    action: "permit",
    protocol: "tcp",
    destinationPort: null,
    tcpOption: "established",
  },
  { sequence: 19, action: "deny", protocol: "ipv4", destinationPort: null, tcpOption: null },
] as const

export class ProviderFailure extends Schema.TaggedErrorClass<ProviderFailure>()(
  "LiveKit.ProviderFailure",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {}

interface Configuration {
  readonly cloudflareAccountId: string
  readonly cloudflareAccountTokenBootstrap: Redacted.Redacted<string>
  readonly cloudflareAccountTokenBootstrapId: string
  readonly cloudflareDnsApiToken: Redacted.Redacted<string>
  readonly cloudflareDnsTokenId: string
  readonly cloudflareR2ApiToken: Redacted.Redacted<string>
  readonly cloudflareTokenBootstrap: Redacted.Redacted<string>
  readonly cloudflareTokenBootstrapId: string
  readonly cloudflareZoneId: string
  readonly ovhApplicationKey: Redacted.Redacted<string>
  readonly ovhApplicationSecret: Redacted.Redacted<string>
  readonly ovhConsumerKey: Redacted.Redacted<string>
  readonly ovhEndpoint: string
  readonly ovhIpv4: string
  readonly ovhServiceName: string
  readonly tailscaleOauthClientId: Redacted.Redacted<string>
  readonly tailscaleOauthClientSecret: Redacted.Redacted<string>
}

const configuration = Effect.gen(function* () {
  return {
    cloudflareAccountId: yield* Config.string("CLOUDFLARE_ACCOUNT_ID"),
    cloudflareAccountTokenBootstrap: yield* Config.redacted("CLOUDFLARE_ACCOUNT_TOKEN_BOOTSTRAP"),
    cloudflareAccountTokenBootstrapId: yield* Config.string(
      "CLOUDFLARE_ACCOUNT_TOKEN_BOOTSTRAP_ID",
    ),
    cloudflareDnsApiToken: yield* Config.redacted("CLOUDFLARE_DNS_API_TOKEN"),
    cloudflareDnsTokenId: yield* Config.string("CLOUDFLARE_DNS_TOKEN_ID"),
    cloudflareR2ApiToken: yield* Config.redacted("CLOUDFLARE_R2_API_TOKEN"),
    cloudflareTokenBootstrap: yield* Config.redacted("CLOUDFLARE_TOKEN_BOOTSTRAP"),
    cloudflareTokenBootstrapId: yield* Config.string("CLOUDFLARE_TOKEN_BOOTSTRAP_ID"),
    cloudflareZoneId: yield* Config.string("CLOUDFLARE_ZONE_ID"),
    ovhApplicationKey: yield* Config.redacted("OVH_APPLICATION_KEY"),
    ovhApplicationSecret: yield* Config.redacted("OVH_APPLICATION_SECRET"),
    ovhConsumerKey: yield* Config.redacted("OVH_CONSUMER_KEY"),
    ovhEndpoint: yield* Config.string("OVH_ENDPOINT"),
    ovhIpv4: yield* Config.string("OVH_IPV4"),
    ovhServiceName: yield* Config.string("OVH_SERVICE_NAME"),
    tailscaleOauthClientId: yield* Config.redacted("TAILSCALE_OAUTH_CLIENT_ID"),
    tailscaleOauthClientSecret: yield* Config.redacted("TAILSCALE_OAUTH_CLIENT_SECRET"),
  } satisfies Configuration
})

const detailFromCause = (cause: unknown): string => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "operation" in cause &&
    "detail" in cause &&
    typeof cause.operation === "string" &&
    typeof cause.detail === "string"
  ) {
    return `${cause.operation}: ${cause.detail}`
  }
  return cause instanceof Error ? cause.message : String(cause)
}

const tryOperation = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ProviderFailure({ operation, detail: detailFromCause(cause) }),
  })

const decodeProvider = <S extends Schema.Constraint>(
  operation: string,
  schema: S,
  value: unknown,
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderFailure({
          operation,
          detail: `unexpected provider response: ${String(cause)}`,
        }),
    ),
  )

const fetchJson = Effect.fn("LiveKit.fetchJson")(function* (
  operation: string,
  url: string,
  init: RequestInit = {},
) {
  return yield* tryOperation(operation, async () => {
    const response = await fetch(url, init)
    const responseText = await response.text()
    if (!response.ok) {
      const errorEnvelope = Schema.decodeUnknownOption(CloudflareErrorEnvelope)(
        JSON.parse(responseText),
      )
      const providerDetail =
        errorEnvelope._tag === "Some"
          ? errorEnvelope.value.errors.map(({ message }) => message).join("; ")
          : ""
      throw new Error(
        providerDetail.length === 0
          ? `HTTP ${response.status}`
          : `HTTP ${response.status}: ${providerDetail}`,
      )
    }
    return responseText.length === 0 ? null : JSON.parse(responseText)
  })
})

const bearerHeaders = (token: Redacted.Redacted<string>): Record<string, string> => ({
  Authorization: `Bearer ${Redacted.value(token)}`,
  "Content-Type": "application/json",
})

const cloudflareRequest = Effect.fn("LiveKit.cloudflareRequest")(function* (
  operation: string,
  token: Redacted.Redacted<string>,
  path: string,
  init: RequestInit = {},
) {
  return yield* fetchJson(operation, `${cloudflareApi}${path}`, {
    ...init,
    headers: { ...bearerHeaders(token), ...init.headers },
  })
})

const cloudflareResult = Effect.fn("LiveKit.cloudflareResult")(function* <
  S extends Schema.Constraint,
>(operation: string, schema: S, value: unknown) {
  const envelope = yield* decodeProvider(operation, CloudflareEnvelope, value)
  return yield* decodeProvider(operation, schema, envelope.result)
})

export const deriveR2SecretAccessKey = (tokenValue: string): string =>
  createHash("sha256").update(tokenValue).digest("hex")

export const buildR2TokenRequest = (accountId: string, name: string) => ({
  name,
  policies: [
    {
      effect: "allow",
      resources: {
        [`com.cloudflare.edge.r2.bucket.${accountId}_${cloudflareBucketJurisdiction}_${cloudflareBucket}`]:
          "*",
      },
      permission_groups: [{ id: cloudflareR2ReadPermission }, { id: cloudflareR2WritePermission }],
    },
  ],
})

export const matchesConfirmation = (
  value: string,
  confirmation: string,
  optionName: string,
): boolean => value.length > 0 && confirmation === `--confirm-${optionName}=${value}`

export const isSupportedOvhImage = (
  templateId: string,
  image: { readonly id: string; readonly name: string },
): boolean => image.id === templateId && image.name === "Ubuntu 26.04"

const tailscaleAccessToken = Effect.fn("LiveKit.tailscaleAccessToken")(function* (
  config: Configuration,
) {
  const credentials = Buffer.from(
    `${Redacted.value(config.tailscaleOauthClientId)}:${Redacted.value(config.tailscaleOauthClientSecret)}`,
  ).toString("base64")
  const response = yield* fetchJson(
    "authenticate Tailscale OAuth client",
    `${tailscaleApi}/oauth/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "auth_keys" }),
    },
  )
  const result = yield* decodeProvider(
    "authenticate Tailscale OAuth client",
    TailscaleAccessToken,
    response,
  )
  return Redacted.make(result.access_token)
})

export const buildOvhSignature = (
  applicationSecret: string,
  consumerKey: string,
  method: string,
  url: string,
  body: string,
  timestamp: number,
): string =>
  `$1$${createHash("sha1")
    .update(`${applicationSecret}+${consumerKey}+${method}+${url}+${body}+${timestamp}`)
    .digest("hex")}`

const ovhBaseUrl = (endpoint: string): string => {
  if (endpoint !== "ovh-eu") throw new Error(`unsupported OVH endpoint: ${endpoint}`)
  return "https://eu.api.ovh.com/1.0"
}

const ovhRequest = Effect.fn("LiveKit.ovhRequest")(function* (
  config: Configuration,
  method: string,
  path: string,
  body = "",
) {
  const baseUrl = ovhBaseUrl(config.ovhEndpoint)
  const timestampValue = yield* fetchJson("read OVH API time", `${baseUrl}/auth/time`)
  if (typeof timestampValue !== "number") {
    return yield* Effect.fail(
      new ProviderFailure({ operation: "read OVH API time", detail: "unexpected response" }),
    )
  }
  const url = `${baseUrl}${path}`
  const applicationSecret = Redacted.value(config.ovhApplicationSecret)
  const consumerKey = Redacted.value(config.ovhConsumerKey)
  const signature = buildOvhSignature(
    applicationSecret,
    consumerKey,
    method,
    url,
    body,
    timestampValue,
  )
  return yield* fetchJson(`OVH ${method} ${path}`, url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Ovh-Application": Redacted.value(config.ovhApplicationKey),
      "X-Ovh-Consumer": consumerKey,
      "X-Ovh-Signature": signature,
      "X-Ovh-Timestamp": String(timestampValue),
    },
    body: body.length === 0 ? undefined : body,
  })
})

const verifyOvhFirewallContract = Effect.fn("LiveKit.verifyOvhFirewallContract")(function* (
  config: Configuration,
) {
  const firewallPath = `/ip/${config.ovhIpv4}/firewall/${config.ovhIpv4}`
  const firewall = yield* decodeProvider(
    "read OVH firewall state",
    OvhFirewallState,
    yield* ovhRequest(config, "GET", firewallPath),
  )
  if (firewall.ipOnFirewall !== config.ovhIpv4 || !firewall.enabled || firewall.state !== "ok") {
    return yield* Effect.fail(
      new ProviderFailure({ operation: "verify OVH firewall state", detail: "state drifted" }),
    )
  }
  const rulePath = `${firewallPath}/rule`
  const sequences = yield* decodeProvider(
    "read OVH firewall rule inventory",
    NumberArray,
    yield* ovhRequest(config, "GET", rulePath),
  )
  const sortedSequences = [...sequences].sort((left, right) => left - right)
  const expectedSequences: ReadonlyArray<number> = expectedOvhFirewallRules.map(
    ({ sequence }) => sequence,
  )
  if (
    sortedSequences.some(
      (sequence) => !expectedSequences.includes(sequence) && sequence !== 17 && sequence !== 18,
    )
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "verify OVH firewall rule inventory",
        detail: "unexpected sequence is present",
      }),
    )
  }
  const optionalRules = yield* Effect.forEach(
    sortedSequences,
    (sequence) =>
      ovhRequest(config, "GET", `${rulePath}/${sequence}`).pipe(
        Effect.flatMap((value) =>
          decodeProvider("read OVH firewall rule", OvhFirewallRuleDetail, value),
        ),
        Effect.map(Option.some),
        Effect.catchIf(
          (error) => (sequence === 17 || sequence === 18) && error.detail.includes("HTTP 404"),
          () => Effect.succeed(Option.none()),
        ),
      ),
    { concurrency: 5 },
  )
  const rules = optionalRules.flatMap(Option.toArray)
  if (
    JSON.stringify(rules.map(({ sequence }) => sequence).sort((left, right) => left - right)) !==
    JSON.stringify(expectedSequences)
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "verify OVH firewall rule inventory",
        detail: "canonical sequence inventory drifted",
      }),
    )
  }
  for (const expected of expectedOvhFirewallRules) {
    const actual = rules.find(({ sequence }) => sequence === expected.sequence)
    if (
      actual === undefined ||
      actual.action !== expected.action ||
      actual.protocol !== expected.protocol ||
      actual.destinationPort !== expected.destinationPort ||
      actual.tcpOption !== expected.tcpOption ||
      actual.source !== "any" ||
      actual.destination !== `${config.ovhIpv4}/32` ||
      actual.state !== "ok"
    ) {
      return yield* Effect.fail(
        new ProviderFailure({
          operation: "verify OVH firewall rule contract",
          detail: `canonical rule ${expected.sequence} drifted`,
        }),
      )
    }
  }
})

const writeSecretFile = Effect.fn("LiveKit.writeSecretFile")(function* (
  path: string,
  contents: string,
) {
  yield* tryOperation(`create secret file ${path}`, async () => {
    const handle = await open(path, "wx", 0o600)
    try {
      await handle.writeFile(contents, { encoding: "utf8" })
    } finally {
      await handle.close()
    }
    await chmod(path, 0o600)
  })
})

const ensureSecretPathAvailable = Effect.fn("LiveKit.ensureSecretPathAvailable")(function* (
  path: string,
) {
  yield* Effect.tryPromise({
    try: async () => {
      try {
        await lstat(path)
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          return
        }
        throw cause
      }
      throw new Error("output path already exists")
    },
    catch: (cause) =>
      new ProviderFailure({
        operation: `reserve secret file ${path}`,
        detail: detailFromCause(cause),
      }),
  })
})

const verifyControlPlane = Effect.fn("LiveKit.verifyControlPlane")(function* () {
  const config = yield* configuration

  const userBootstrap = yield* cloudflareResult(
    "verify Cloudflare user-token bootstrap",
    TokenIdentity,
    yield* cloudflareRequest(
      "verify Cloudflare user-token bootstrap",
      config.cloudflareTokenBootstrap,
      "/user/tokens/verify",
    ),
  )
  if (userBootstrap.status !== "active" || userBootstrap.id !== config.cloudflareTokenBootstrapId) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "verify Cloudflare user-token bootstrap",
        detail: "token identity or status drifted",
      }),
    )
  }

  const accountBootstrap = yield* cloudflareResult(
    "verify Cloudflare account-token bootstrap",
    TokenIdentity,
    yield* cloudflareRequest(
      "verify Cloudflare account-token bootstrap",
      config.cloudflareAccountTokenBootstrap,
      "/user/tokens/verify",
    ),
  )
  if (
    accountBootstrap.status !== "active" ||
    accountBootstrap.id !== config.cloudflareAccountTokenBootstrapId
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "verify Cloudflare account-token bootstrap",
        detail: "token is not active",
      }),
    )
  }

  const r2Token = yield* cloudflareResult(
    "verify Cloudflare R2 token",
    TokenIdentity,
    yield* cloudflareRequest(
      "verify Cloudflare R2 token",
      config.cloudflareR2ApiToken,
      `/accounts/${config.cloudflareAccountId}/tokens/verify`,
    ),
  )
  if (r2Token.status !== "active") {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "verify Cloudflare R2 token",
        detail: "token is not active",
      }),
    )
  }

  const dnsToken = yield* cloudflareResult(
    "read Cloudflare DNS token contract",
    CloudflareTokenContract,
    yield* cloudflareRequest(
      "read Cloudflare DNS token contract",
      config.cloudflareTokenBootstrap,
      `/user/tokens/${config.cloudflareDnsTokenId}`,
    ),
  )
  const dnsTokenHasExpectedScope = dnsToken.policies.some(
    ({ permission_groups, resources }) =>
      permission_groups.some(({ id }) => id === cloudflareDnsWritePermission) &&
      Object.hasOwn(resources, `com.cloudflare.api.account.zone.${config.cloudflareZoneId}`),
  )
  if (
    dnsToken.id !== config.cloudflareDnsTokenId ||
    dnsToken.status !== "active" ||
    !dnsTokenHasExpectedScope
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "read Cloudflare DNS token contract",
        detail: "token identity, status, zone resource, or DNS Write permission drifted",
      }),
    )
  }

  const dnsRecord = yield* cloudflareResult(
    "read Cloudflare LiveKit DNS record",
    DnsRecord,
    yield* cloudflareRequest(
      "read Cloudflare LiveKit DNS record",
      config.cloudflareDnsApiToken,
      `/zones/${config.cloudflareZoneId}/dns_records/${roomDnsRecordId}`,
    ),
  )
  if (
    dnsRecord.name !== "room.praximo.io" ||
    dnsRecord.type !== "A" ||
    dnsRecord.content !== config.ovhIpv4 ||
    dnsRecord.proxied !== false ||
    config.cloudflareDnsTokenId.length !== 32
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "read Cloudflare LiveKit DNS record",
        detail: "record or token contract drifted",
      }),
    )
  }

  yield* tailscaleAccessToken(config)

  const ovhCredential = yield* decodeProvider(
    "read OVH credential identity",
    OvhCredential,
    yield* ovhRequest(config, "GET", "/auth/currentCredential"),
  )

  const vps = yield* decodeProvider(
    "read OVH VPS",
    OvhVps,
    yield* ovhRequest(config, "GET", `/vps/${config.ovhServiceName}`),
  )
  if (vps.name !== config.ovhServiceName) {
    return yield* Effect.fail(
      new ProviderFailure({ operation: "read OVH VPS", detail: "service identity drifted" }),
    )
  }
  yield* ovhRequest(config, "GET", `/vps/${config.ovhServiceName}/images/current`)
  yield* verifyOvhFirewallContract(config)

  yield* Effect.logInfo(
    `Control-plane authority authenticated: Cloudflare DNS/R2 rotation, Tailscale auth-key issuance, and OVH VPS/firewall; OVH credential=${ovhCredential.credentialId}`,
  )
})

const requestTailscaleKey = Effect.fn("LiveKit.requestTailscaleKey")(function* (
  config: Configuration,
) {
  const accessToken = yield* tailscaleAccessToken(config)
  const response = yield* fetchJson(
    "create one-time Tailscale auth key",
    `${tailscaleApi}/tailnet/-/keys`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken),
      body: JSON.stringify({
        capabilities: {
          devices: {
            create: {
              reusable: false,
              ephemeral: false,
              preauthorized: true,
              tags: ["tag:ci"],
            },
          },
        },
        expirySeconds: 600,
        description: "Praximo LiveKit one-time rebuild key",
      }),
    },
  )
  const result = yield* decodeProvider("create one-time Tailscale auth key", TailscaleKey, response)
  return { accessToken, id: result.id, key: result.key }
})

const createTailscaleKey = Effect.fn("LiveKit.createTailscaleKey")(function* (outputPath: string) {
  if (outputPath.length === 0) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "create Tailscale auth key",
        detail: "output path is required",
      }),
    )
  }
  yield* ensureSecretPathAvailable(outputPath)
  const config = yield* configuration
  const id = yield* Effect.acquireUseRelease(
    requestTailscaleKey(config),
    ({ id, key }) => writeSecretFile(outputPath, `${key}\n`).pipe(Effect.as(id)),
    ({ accessToken, id }, exit) =>
      Exit.isFailure(exit)
        ? releaseWithExit(
            exit,
            fetchJson(
              "revoke unwritten Tailscale auth key",
              `${tailscaleApi}/tailnet/-/keys/${id}`,
              {
                method: "DELETE",
                headers: bearerHeaders(accessToken),
              },
            ),
          )
        : Effect.void,
  )
  yield* Effect.logInfo(`One-time Tailscale auth key ${id} written mode 0600 to ${outputPath}`)
})

const revokeTailscaleKey = Effect.fn("LiveKit.revokeTailscaleKey")(function* (
  keyId: string,
  confirmation: string,
) {
  if (!/^[A-Za-z0-9]+$/.test(keyId) || !matchesConfirmation(keyId, confirmation, "key")) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "revoke Tailscale auth key",
        detail: "pass KEY_ID and --confirm-key=KEY_ID",
      }),
    )
  }
  const config = yield* configuration
  const accessToken = yield* tailscaleAccessToken(config)
  yield* fetchJson("revoke Tailscale auth key", `${tailscaleApi}/tailnet/-/keys/${keyId}`, {
    method: "DELETE",
    headers: bearerHeaders(accessToken),
  })
  yield* Effect.logInfo(`Tailscale auth key ${keyId} revoked`)
})

const proveTailscaleKeyAuthority = Effect.fn("LiveKit.proveTailscaleKeyAuthority")(function* (
  config: Configuration,
) {
  yield* Effect.acquireUseRelease(
    requestTailscaleKey(config),
    () => Effect.void,
    ({ accessToken, id }, exit) =>
      releaseWithExit(
        exit,
        fetchJson("revoke disposable Tailscale auth key", `${tailscaleApi}/tailnet/-/keys/${id}`, {
          method: "DELETE",
          headers: bearerHeaders(accessToken),
        }),
      ),
  )
})

const createDnsToken = Effect.fn("LiveKit.createDnsToken")(function* (
  config: Configuration,
  name: string,
) {
  return yield* cloudflareResult(
    "create Cloudflare DNS token",
    R2CreatedToken,
    yield* cloudflareRequest(
      "create Cloudflare DNS token",
      config.cloudflareTokenBootstrap,
      "/user/tokens",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          policies: [
            {
              effect: "allow",
              resources: {
                [`com.cloudflare.api.account.zone.${config.cloudflareZoneId}`]: "*",
              },
              permission_groups: [{ id: cloudflareDnsWritePermission }],
            },
          ],
        }),
      },
    ),
  )
})

const revokeDnsToken = Effect.fn("LiveKit.revokeDnsToken")(function* (
  config: Configuration,
  tokenId: string,
) {
  yield* cloudflareRequest(
    "revoke Cloudflare DNS token",
    config.cloudflareTokenBootstrap,
    `/user/tokens/${tokenId}`,
    { method: "DELETE" },
  )
})

const createDnsCredential = Effect.fn("LiveKit.createDnsCredential")(function* (
  outputPath: string,
) {
  if (outputPath.length === 0) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "create DNS credential",
        detail: "output path is required",
      }),
    )
  }
  yield* ensureSecretPathAvailable(outputPath)
  const config = yield* configuration
  yield* Effect.acquireUseRelease(
    createDnsToken(config, `praximo-livekit-dns-maintenance-${new Date().toISOString()}`),
    (token) =>
      writeSecretFile(
        outputPath,
        [`CLOUDFLARE_DNS_TOKEN_ID=${token.id}`, `CLOUDFLARE_DNS_API_TOKEN=${token.value}`, ""].join(
          "\n",
        ),
      ),
    (token, exit) =>
      Exit.isFailure(exit) ? releaseWithExit(exit, revokeDnsToken(config, token.id)) : Effect.void,
  )
  yield* Effect.logInfo(`New DNS credential written mode 0600 to ${outputPath}`)
})

const revokeDnsCredential = Effect.fn("LiveKit.revokeDnsCredential")(function* (
  tokenId: string,
  confirmation: string,
) {
  if (!/^[a-f0-9]{32}$/.test(tokenId) || !matchesConfirmation(tokenId, confirmation, "token")) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "revoke DNS credential",
        detail: "pass TOKEN_ID and --confirm-token=TOKEN_ID",
      }),
    )
  }
  const config = yield* configuration
  yield* revokeDnsToken(config, tokenId)
  yield* Effect.logInfo(`Cloudflare DNS token ${tokenId} revoked`)
})

const proveCloudflareDnsAuthority = Effect.fn("LiveKit.proveCloudflareDnsAuthority")(function* (
  config: Configuration,
) {
  const record = yield* Effect.acquireUseRelease(
    createDnsToken(config, `praximo-livekit-dns-canary-${new Date().toISOString()}`),
    (created) =>
      Effect.gen(function* () {
        const disposableToken = Redacted.make(created.value)
        return yield* cloudflareResult(
          "prove disposable Cloudflare DNS write",
          DnsRecord,
          yield* cloudflareRequest(
            "prove disposable Cloudflare DNS write",
            disposableToken,
            `/zones/${config.cloudflareZoneId}/dns_records/${roomDnsRecordId}`,
            { method: "PATCH", body: JSON.stringify({ content: config.ovhIpv4 }) },
          ),
        )
      }),
    (created, exit) => releaseWithExit(exit, revokeDnsToken(config, created.id)),
  )
  if (record.content !== config.ovhIpv4) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "prove disposable Cloudflare DNS write",
        detail: "record content drifted during idempotent patch",
      }),
    )
  }
})

interface R2Token {
  readonly id: string
  readonly value: string
  readonly secretAccessKey: string
}

const createR2Token = Effect.fn("LiveKit.createR2Token")(function* (config: Configuration) {
  const request = buildR2TokenRequest(
    config.cloudflareAccountId,
    `praximo-livekit-maintenance-${new Date().toISOString()}`,
  )
  const result = yield* cloudflareResult(
    "create Cloudflare R2 account token",
    R2CreatedToken,
    yield* cloudflareRequest(
      "create Cloudflare R2 account token",
      config.cloudflareAccountTokenBootstrap,
      `/accounts/${config.cloudflareAccountId}/tokens`,
      { method: "POST", body: JSON.stringify(request) },
    ),
  )
  return {
    id: result.id,
    value: result.value,
    secretAccessKey: deriveR2SecretAccessKey(result.value),
  } satisfies R2Token
})

const revokeR2Token = Effect.fn("LiveKit.revokeR2Token")(function* (
  config: Configuration,
  tokenId: string,
) {
  yield* cloudflareRequest(
    "revoke Cloudflare R2 account token",
    config.cloudflareAccountTokenBootstrap,
    `/accounts/${config.cloudflareAccountId}/tokens/${tokenId}`,
    { method: "DELETE" },
  )
})

const createR2Credential = Effect.fn("LiveKit.createR2Credential")(function* (outputPath: string) {
  if (outputPath.length === 0) {
    return yield* Effect.fail(
      new ProviderFailure({ operation: "create R2 credential", detail: "output path is required" }),
    )
  }
  yield* ensureSecretPathAvailable(outputPath)
  const config = yield* configuration
  yield* Effect.acquireUseRelease(
    createR2Token(config),
    (token) =>
      writeSecretFile(
        outputPath,
        [
          `CLOUDFLARE_R2_TOKEN_ID=${token.id}`,
          `CLOUDFLARE_R2_API_TOKEN=${token.value}`,
          `R2_ACCESS_KEY_ID=${token.id}`,
          `R2_SECRET_ACCESS_KEY=${token.secretAccessKey}`,
          "",
        ].join("\n"),
      ),
    (token, exit) =>
      Exit.isFailure(exit) ? releaseWithExit(exit, revokeR2Token(config, token.id)) : Effect.void,
  )
  yield* Effect.logInfo(`New R2 credential written mode 0600 to ${outputPath}`)
})

const revokeR2Credential = Effect.fn("LiveKit.revokeR2Credential")(function* (
  tokenId: string,
  confirmation: string,
) {
  if (!/^[a-f0-9]{32}$/.test(tokenId) || !matchesConfirmation(tokenId, confirmation, "token")) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "revoke R2 credential",
        detail: "pass TOKEN_ID and --confirm-token=TOKEN_ID",
      }),
    )
  }
  const config = yield* configuration
  yield* revokeR2Token(config, tokenId)
  yield* Effect.logInfo(`Cloudflare R2 account token ${tokenId} revoked`)
})

const runR2AuthorityCanary = Effect.fn("LiveKit.runR2AuthorityCanary")(function* () {
  yield* Effect.sync(() => console.log("R2 control-plane authority canary starting"))
  const config = yield* configuration
  yield* Effect.acquireUseRelease(
    createR2Token(config).pipe(
      Effect.map((token) => ({
        token,
        objectKey: `recordings/maintenance-canary/control-plane-${randomUUID()}`,
        client: new S3Client({
          endpoint: cloudflareR2Endpoint,
          region: "auto",
          forcePathStyle: true,
          credentials: { accessKeyId: token.id, secretAccessKey: token.secretAccessKey },
        }),
      })),
    ),
    ({ client, objectKey }) =>
      Effect.gen(function* () {
        yield* tryOperation("write R2 control-plane canary", () =>
          client.send(
            new PutObjectCommand({
              Bucket: cloudflareBucket,
              Key: objectKey,
              Body: "praximo-livekit-control-plane",
              ContentType: "text/plain",
            }),
          ),
        ).pipe(Effect.retry({ schedule: Schedule.exponential("1 second"), times: 5 }))
        const head = yield* tryOperation("read R2 control-plane canary", () =>
          client.send(new HeadObjectCommand({ Bucket: cloudflareBucket, Key: objectKey })),
        )
        if (head.ContentLength !== 29 || head.ContentType !== "text/plain") {
          return yield* Effect.fail(
            new ProviderFailure({
              operation: "validate R2 control-plane canary",
              detail: "unexpected object metadata",
            }),
          )
        }
      }),
    ({ client, objectKey, token }, exit) =>
      releaseWithExit(
        exit,
        withCleanup(
          tryOperation("delete R2 control-plane canary object", () =>
            client.send(new DeleteObjectCommand({ Bucket: cloudflareBucket, Key: objectKey })),
          ),
          revokeR2Token(config, token.id),
        ).pipe(Effect.ensuring(Effect.sync(() => client.destroy()))),
      ),
  )
  yield* Effect.sync(() =>
    console.log(
      "R2 control-plane canary passed: create token, write/read/delete object, revoke token",
    ),
  )
})

const listOvhImages = Effect.fn("LiveKit.listOvhImages")(function* () {
  const config = yield* configuration
  const imageIds = yield* ovhRequest(
    config,
    "GET",
    `/vps/${config.ovhServiceName}/images/available`,
  )
  const stringImageIds = yield* decodeProvider("list OVH VPS images", StringArray, imageIds)
  const images = yield* Effect.forEach(
    stringImageIds,
    (id) => ovhRequest(config, "GET", `/vps/${config.ovhServiceName}/images/available/${id}`),
    { concurrency: 5 },
  )
  for (const image of images) {
    const record = yield* decodeProvider("read OVH VPS image", OvhImage, image)
    console.log(`${record.id}\t${record.name}`)
  }
})

const reinstallOvhVps = Effect.fn("LiveKit.reinstallOvhVps")(function* (
  templateIdText: string,
  confirmation: string,
) {
  const config = yield* configuration
  const reinstallTarget = `${config.ovhServiceName}:${templateIdText}`
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(templateIdText) ||
    !matchesConfirmation(reinstallTarget, confirmation, "reinstall")
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "reinstall OVH VPS",
        detail: `pass TEMPLATE_ID and --confirm-reinstall=${reinstallTarget}`,
      }),
    )
  }
  const image = yield* decodeProvider(
    "read selected OVH VPS image",
    OvhImage,
    yield* ovhRequest(
      config,
      "GET",
      `/vps/${config.ovhServiceName}/images/available/${templateIdText}`,
    ),
  )
  if (!isSupportedOvhImage(templateIdText, image)) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "validate selected OVH VPS image",
        detail: "the selected image is not the locked Ubuntu 26.04 rebuild image",
      }),
    )
  }
  const publicSshKey = yield* tryOperation("read committed owner SSH public key", () =>
    readFile(new URL("./owner-authorized-key.pub", import.meta.url), "utf8"),
  )
  const result = yield* ovhRequest(
    config,
    "POST",
    `/vps/${config.ovhServiceName}/reinstall`,
    JSON.stringify({
      templateId: templateIdText,
      publicSshKey: publicSshKey.trim(),
      doNotSendPassword: true,
      language: "en",
    }),
  )
  const task = yield* decodeProvider("reinstall OVH VPS", OvhTask, result)
  yield* Effect.logInfo(`OVH VPS reinstall accepted; task=${task.id}`)
})

const inspectOvhFirewall = Effect.fn("LiveKit.inspectOvhFirewall")(function* () {
  const config = yield* configuration
  const firewalls = yield* ovhRequest(config, "GET", `/ip/${config.ovhIpv4}/firewall`)
  console.log(JSON.stringify(firewalls, null, 2))
  if (Array.isArray(firewalls) && firewalls.includes(config.ovhIpv4)) {
    const firewall = yield* ovhRequest(
      config,
      "GET",
      `/ip/${config.ovhIpv4}/firewall/${config.ovhIpv4}`,
    )
    const rules = yield* ovhRequest(
      config,
      "GET",
      `/ip/${config.ovhIpv4}/firewall/${config.ovhIpv4}/rule`,
    )
    console.log(JSON.stringify({ firewall, rules }, null, 2))
  }
})

const openOvhSsh = Effect.fn("LiveKit.openOvhSsh")(function* (
  sourceCidr: string,
  confirmation: string,
) {
  const config = yield* configuration
  if (
    !/^([0-9]{1,3}\.){3}[0-9]{1,3}\/32$/.test(sourceCidr) ||
    !matchesConfirmation(config.ovhIpv4, confirmation, "ip")
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "open temporary OVH SSH rule",
        detail: `pass SOURCE_IPV4/32 and --confirm-ip=${config.ovhIpv4}`,
      }),
    )
  }
  const rulePath = `/ip/${config.ovhIpv4}/firewall/${config.ovhIpv4}/rule`
  const sequences = yield* decodeProvider(
    "open temporary OVH SSH rule",
    NumberArray,
    yield* ovhRequest(config, "GET", rulePath),
  )
  if (sequences.includes(18)) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "open temporary OVH SSH rule",
        detail: "reserved firewall sequence 18 is already occupied",
      }),
    )
  }
  yield* ovhRequest(
    config,
    "POST",
    rulePath,
    JSON.stringify({
      sequence: 18,
      action: "permit",
      protocol: "tcp",
      destinationPort: 22,
      source: sourceCidr,
    }),
  )
  yield* Effect.logInfo(`Temporary OVH SSH rule opened from ${sourceCidr} at sequence 18`)
})

const closeOvhSsh = Effect.fn("LiveKit.closeOvhSsh")(function* (
  sourceCidr: string,
  confirmation: string,
) {
  const config = yield* configuration
  if (
    !/^([0-9]{1,3}\.){3}[0-9]{1,3}\/32$/.test(sourceCidr) ||
    !matchesConfirmation(config.ovhIpv4, confirmation, "ip")
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "close temporary OVH SSH rule",
        detail: `pass SOURCE_IPV4/32 and --confirm-ip=${config.ovhIpv4}`,
      }),
    )
  }
  const rulePath = `/ip/${config.ovhIpv4}/firewall/${config.ovhIpv4}/rule/18`
  const rule = yield* decodeProvider(
    "read temporary OVH SSH rule",
    OvhFirewallRule,
    yield* ovhRequest(config, "GET", rulePath),
  )
  if (
    rule.protocol !== "tcp" ||
    rule.destinationPort !== "eq 22" ||
    rule.source !== sourceCidr ||
    rule.action !== "permit"
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "close temporary OVH SSH rule",
        detail: "sequence 18 does not match the expected temporary SSH rule",
      }),
    )
  }
  yield* ovhRequest(config, "DELETE", rulePath)
  yield* Effect.logInfo(`Temporary OVH SSH rule from ${sourceCidr} removed`)
})

const awaitOvhFirewallRuleReady = Effect.fn("LiveKit.awaitOvhFirewallRuleReady")(function* (
  config: Configuration,
  path: string,
) {
  return yield* Effect.gen(function* () {
    const rule = yield* decodeProvider(
      "verify OVH firewall rule",
      OvhFirewallRule,
      yield* ovhRequest(config, "GET", path),
    )
    if (rule.state !== "ok") {
      return yield* Effect.fail(
        new ProviderFailure({
          operation: "verify OVH firewall rule",
          detail: `rule state is ${rule.state}`,
        }),
      )
    }
    return rule
  }).pipe(Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 30 }))
})

const awaitOvhFirewallRuleAbsent = Effect.fn("LiveKit.awaitOvhFirewallRuleAbsent")(function* (
  config: Configuration,
  path: string,
) {
  yield* ovhRequest(config, "GET", path).pipe(
    Effect.flatMap(() =>
      Effect.fail(
        new ProviderFailure({
          operation: "wait for OVH firewall rule cleanup",
          detail: "rule is still present",
        }),
      ),
    ),
    Effect.catchIf(
      (error) => error.detail.includes("HTTP 404"),
      () => Effect.void,
    ),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 90 }),
  )
})

const proveOvhRebuildAuthority = Effect.fn("LiveKit.proveOvhRebuildAuthority")(function* (
  config: Configuration,
) {
  const credential = yield* decodeProvider(
    "read OVH credential rights",
    OvhCredential,
    yield* ovhRequest(config, "GET", "/auth/currentCredential"),
  )
  const reinstallPath = `/vps/${config.ovhServiceName}/reinstall`
  const ruleCollection = `/ip/${config.ovhIpv4}/firewall/${config.ovhIpv4}/rule`
  const requiredRights = [
    { method: "POST", path: reinstallPath },
    { method: "POST", path: ruleCollection },
    { method: "GET", path: `${ruleCollection}/*` },
    { method: "DELETE", path: `${ruleCollection}/17` },
    { method: "DELETE", path: `${ruleCollection}/18` },
  ]
  const missingRight = requiredRights.find(
    (required) =>
      !credential.rules.some(
        ({ method, path }) => method === required.method && path === required.path,
      ),
  )
  if (missingRight !== undefined) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "verify OVH rebuild authority",
        detail: `credential does not grant ${missingRight.method} ${missingRight.path}`,
      }),
    )
  }

  const sequences = yield* decodeProvider(
    "read OVH firewall rules for authority canary",
    NumberArray,
    yield* ovhRequest(config, "GET", ruleCollection),
  )
  if (sequences.includes(17)) {
    const existing = yield* ovhRequest(config, "GET", `${ruleCollection}/17`).pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error) => error.detail.includes("HTTP 404"),
        () => Effect.succeed(Option.none()),
      ),
    )
    if (Option.isSome(existing)) {
      return yield* Effect.fail(
        new ProviderFailure({
          operation: "prove OVH firewall mutation authority",
          detail: "reserved authority-canary sequence 17 is occupied",
        }),
      )
    }
  }
  const rulePath = `${ruleCollection}/17`
  const rule = yield* Effect.acquireUseRelease(
    ovhRequest(
      config,
      "POST",
      ruleCollection,
      JSON.stringify({
        sequence: 17,
        action: "permit",
        protocol: "tcp",
        destinationPort: 22,
        source: "192.0.2.1/32",
      }),
    ).pipe(Effect.as(rulePath)),
    (path) => awaitOvhFirewallRuleReady(config, path),
    (path, exit) =>
      releaseWithExit(
        exit,
        Effect.gen(function* () {
          yield* awaitOvhFirewallRuleReady(config, path)
          yield* ovhRequest(config, "DELETE", path)
          yield* awaitOvhFirewallRuleAbsent(config, path)
        }),
      ),
  )
  if (
    rule.protocol !== "tcp" ||
    rule.destinationPort !== "eq 22" ||
    rule.source !== "192.0.2.1/32" ||
    rule.action !== "permit"
  ) {
    return yield* Effect.fail(
      new ProviderFailure({
        operation: "prove OVH firewall mutation authority",
        detail: "provider returned an unexpected authority-canary rule",
      }),
    )
  }
  yield* verifyOvhFirewallContract(config)
})

const runRebuildPreflight = Effect.fn("LiveKit.runRebuildPreflight")(function* () {
  yield* verifyControlPlane()
  const config = yield* configuration
  yield* proveCloudflareDnsAuthority(config)
  yield* runR2AuthorityCanary()
  yield* proveTailscaleKeyAuthority(config)
  yield* proveOvhRebuildAuthority(config)
  yield* Effect.logInfo(
    "Rebuild preflight passed: DNS token create/write/revoke, R2 token create/object/revoke, Tailscale key create/revoke, OVH reinstall grant and firewall create/read/delete",
  )
})

if (import.meta.main) {
  const command = process.argv[2]
  const first = process.argv[3] ?? ""
  const second = process.argv[4] ?? ""

  const program =
    command === "verify"
      ? verifyControlPlane()
      : command === "rebuild-preflight"
        ? runRebuildPreflight()
        : command === "tailscale-key"
          ? createTailscaleKey(first)
          : command === "tailscale-key-revoke"
            ? revokeTailscaleKey(first, second)
            : command === "dns-create"
              ? createDnsCredential(first)
              : command === "dns-revoke"
                ? revokeDnsCredential(first, second)
                : command === "r2-create"
                  ? createR2Credential(first)
                  : command === "r2-authority-canary"
                    ? runR2AuthorityCanary()
                    : command === "r2-revoke"
                      ? revokeR2Credential(first, second)
                      : command === "ovh-images"
                        ? listOvhImages()
                        : command === "ovh-reinstall"
                          ? reinstallOvhVps(first, second)
                          : command === "ovh-firewall"
                            ? inspectOvhFirewall()
                            : command === "ovh-ssh-open"
                              ? openOvhSsh(first, second)
                              : command === "ovh-ssh-close"
                                ? closeOvhSsh(first, second)
                                : Effect.fail(
                                    new ProviderFailure({
                                      operation: "select control-plane command",
                                      detail:
                                        "expected verify, rebuild-preflight, tailscale-key, tailscale-key-revoke, dns-create, dns-revoke, r2-create, r2-authority-canary, r2-revoke, ovh-images, ovh-reinstall, ovh-firewall, ovh-ssh-open, or ovh-ssh-close",
                                    }),
                                  )

  Effect.runPromise(
    program.pipe(
      Effect.tapError((error) => Effect.sync(() => console.error(detailFromCause(error)))),
    ),
  ).catch((cause: unknown) => {
    console.error(detailFromCause(cause))
    process.exitCode = 1
  })
}
