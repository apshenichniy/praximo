import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import {
  AudioFrame,
  AudioSource,
  ContinualGatheringPolicy,
  dispose as disposeRtc,
  IceTransportType,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node"
import {
  AccessToken,
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  RoomServiceClient,
} from "livekit-server-sdk"
import { Cause, Config, Effect, Exit, Redacted, Schedule, Schema } from "effect"

import { releaseWithExit, runCleanupPhases, withCleanup } from "./cleanup.ts"

const liveKitApiUrl = "https://room.praximo.io"
const liveKitWebSocketUrl = "wss://room.praximo.io"
const liveKitPublicIpv4 = "135.125.175.57"
const r2Endpoint = "https://27940cd0d92bb3f03943a5378ccf68d3.eu.r2.cloudflarestorage.com"
const r2Bucket = "praximo-prod-r2"
const r2Prefix = "recordings/"

export interface CanaryPath {
  readonly identity: string
  readonly filepath: string
  readonly objectKey: string
  readonly transport: "direct" | "relay"
}

export const buildCanaryPaths = (runId: string): readonly [CanaryPath, CanaryPath] => [
  {
    identity: `maintenance-${runId}-direct`,
    filepath: `maintenance-canary/${runId}/direct.ogg`,
    objectKey: `${r2Prefix}maintenance-canary/${runId}/direct.ogg`,
    transport: "direct",
  },
  {
    identity: `maintenance-${runId}-relay`,
    filepath: `maintenance-canary/${runId}/relay.ogg`,
    objectKey: `${r2Prefix}maintenance-canary/${runId}/relay.ogg`,
    transport: "relay",
  },
]

export const createSineSamples = (
  frequency: number,
  sampleRate: number,
  samplesPerChannel: number,
  offset: number,
): Int16Array => {
  const samples = new Int16Array(samplesPerChannel)
  for (let index = 0; index < samplesPerChannel; index += 1) {
    samples[index] = Math.round(
      Math.sin((2 * Math.PI * frequency * (offset + index)) / sampleRate) * 4_000,
    )
  }
  return samples
}

export const canDeleteCanaryObjects = (
  canarySucceeded: boolean,
  terminalCleanupSucceeded: boolean,
): boolean => canarySucceeded || terminalCleanupSucceeded

export interface TransportEvidence {
  readonly candidateType: number
  readonly protocol: string
  readonly relayProtocol: number | undefined
  readonly remoteAddress: string
  readonly remotePort: number
  readonly url: string
}

export const transportEvidenceMatches = (
  expected: CanaryPath["transport"],
  evidence: TransportEvidence,
): boolean =>
  expected === "relay"
    ? evidence.candidateType === 3 &&
      evidence.remoteAddress === liveKitPublicIpv4 &&
      ((evidence.protocol === "udp" &&
        evidence.relayProtocol === 0 &&
        evidence.url === `turn:${liveKitPublicIpv4}:3478?transport=udp`) ||
        (evidence.protocol === "tcp" &&
          evidence.relayProtocol === 2 &&
          evidence.url === "turns:turn.praximo.io:443?transport=tcp"))
    : [0, 1, 2].includes(evidence.candidateType) &&
      evidence.remoteAddress === liveKitPublicIpv4 &&
      ((evidence.protocol === "tcp" && evidence.remotePort === 7881) ||
        (evidence.protocol === "udp" &&
          evidence.remotePort >= 50_000 &&
          evidence.remotePort <= 60_000))

export class MaintenanceFailure extends Schema.TaggedErrorClass<MaintenanceFailure>()(
  "LiveKit.MaintenanceFailure",
  {
    operation: Schema.String,
    detail: Schema.String,
  },
) {}

class EgressPending extends Schema.TaggedErrorClass<EgressPending>()("LiveKit.EgressPending", {
  egressId: Schema.String,
}) {}

interface Configuration {
  readonly liveKitApiKey: Redacted.Redacted<string>
  readonly liveKitApiSecret: Redacted.Redacted<string>
  readonly r2AccessKeyId: Redacted.Redacted<string>
  readonly r2SecretAccessKey: Redacted.Redacted<string>
}

const configuration = Effect.gen(function* () {
  return {
    liveKitApiKey: yield* Config.redacted("LIVEKIT_API_KEY"),
    liveKitApiSecret: yield* Config.redacted("LIVEKIT_API_SECRET"),
    r2AccessKeyId: yield* Config.redacted("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: yield* Config.redacted("R2_SECRET_ACCESS_KEY"),
  } satisfies Configuration
})

const messageFromCause = (cause: unknown): string => {
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
    catch: (cause) =>
      new MaintenanceFailure({
        operation,
        detail: messageFromCause(cause),
      }),
  })

const runMaintenanceCleanups = (
  operation: string,
  cleanups: ReadonlyArray<Effect.Effect<unknown, MaintenanceFailure>>,
) =>
  Effect.gen(function* () {
    const exits = yield* Effect.all(cleanups.map(Effect.exit), { concurrency: "unbounded" })
    const failures = exits.filter(Exit.isFailure)
    if (failures.length > 0) {
      return yield* Effect.fail(
        new MaintenanceFailure({
          operation,
          detail: failures.map(({ cause }) => Cause.pretty(cause)).join("; "),
        }),
      )
    }
  })

const makeClients = (config: Configuration) => {
  const apiKey = Redacted.value(config.liveKitApiKey)
  const apiSecret = Redacted.value(config.liveKitApiSecret)
  return {
    room: new RoomServiceClient(liveKitApiUrl, apiKey, apiSecret),
    egress: new EgressClient(liveKitApiUrl, apiKey, apiSecret),
    r2: new S3Client({
      endpoint: r2Endpoint,
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: Redacted.value(config.r2AccessKeyId),
        secretAccessKey: Redacted.value(config.r2SecretAccessKey),
      },
    }),
  }
}

const verifyR2Authority = Effect.fn("LiveKit.verifyR2Authority")(function* (client: S3Client) {
  const objectKey = `${r2Prefix}maintenance-canary/authority-probe`
  const probe = Effect.gen(function* () {
    yield* tryOperation("write R2 authority probe", () =>
      client.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: objectKey,
          Body: "praximo-livekit-authority-probe",
          ContentType: "text/plain",
        }),
      ),
    )
    const head = yield* tryOperation("read R2 authority probe metadata", () =>
      client.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: objectKey })),
    )
    if (head.ContentLength !== 31 || head.ContentType !== "text/plain") {
      return yield* Effect.fail(
        new MaintenanceFailure({
          operation: "validate R2 authority probe",
          detail: "unexpected size or Content-Type metadata",
        }),
      )
    }
    yield* tryOperation("delete R2 authority probe", () =>
      client.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: objectKey })),
    )
  })
  const cleanup = tryOperation("clean up R2 authority probe", () =>
    client.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: objectKey })),
  )
  yield* withCleanup(probe, cleanup)
})

const verifyAuthorities = Effect.fn("LiveKit.verifyAuthorities")(function* () {
  const config = yield* configuration
  const clients = makeClients(config)
  yield* tryOperation("authenticate LiveKit API", () => clients.room.listRooms())
  yield* verifyR2Authority(clients.r2)
  clients.r2.destroy()
  yield* Effect.logInfo("LiveKit API and R2 object write/read/delete credentials authenticated")
})

const makeToken = Effect.fn("LiveKit.makeToken")(function* (
  config: Configuration,
  roomName: string,
  identity: string,
) {
  const token = new AccessToken(
    Redacted.value(config.liveKitApiKey),
    Redacted.value(config.liveKitApiSecret),
    { identity, ttl: "10m" },
  )
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: false })
  return yield* tryOperation("mint participant token", () => token.toJwt())
})

interface Publisher {
  readonly room: Room
  readonly source: AudioSource
  readonly track: LocalAudioTrack
  readonly trackSid: string
}

const connectPublisher = Effect.fn("LiveKit.connectPublisher")(function* (
  config: Configuration,
  roomName: string,
  path: CanaryPath,
) {
  const token = yield* makeToken(config, roomName, path.identity)
  return yield* tryOperation(
    `connect ${path.transport} publisher`,
    async (): Promise<Publisher> => {
      const room = new Room()
      const source = new AudioSource(48_000, 1)
      const track = LocalAudioTrack.createAudioTrack(`${path.transport}-microphone`, source)
      try {
        await room.connect(liveKitWebSocketUrl, token, {
          autoSubscribe: false,
          dynacast: false,
          rtcConfig: {
            iceTransportType:
              path.transport === "relay"
                ? IceTransportType.TRANSPORT_RELAY
                : IceTransportType.TRANSPORT_ALL,
            continualGatheringPolicy: ContinualGatheringPolicy.GATHER_CONTINUALLY,
            iceServers: [],
          },
        })
        const publication = await room.localParticipant?.publishTrack(
          track,
          new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE, dtx: false }),
        )
        if (publication?.sid === undefined) {
          throw new Error("publisher did not receive a track SID")
        }
        return { room, source, track, trackSid: publication.sid }
      } catch (cause) {
        await track.close(true).catch(() => undefined)
        await room.disconnect().catch(() => undefined)
        throw cause
      }
    },
  )
})

const captureTone = Effect.fn("LiveKit.captureTone")(function* (publisher: Publisher) {
  yield* tryOperation("publish synthetic microphone audio", async () => {
    const sampleRate = 48_000
    const samplesPerFrame = 480
    for (let frameIndex = 0; frameIndex < 800; frameIndex += 1) {
      const samples = createSineSamples(
        440,
        sampleRate,
        samplesPerFrame,
        frameIndex * samplesPerFrame,
      )
      await publisher.source.captureFrame(new AudioFrame(samples, sampleRate, 1, samplesPerFrame))
    }
    await publisher.source.waitForPlayout()
  })
})

const readSelectedTransport = Effect.fn("LiveKit.readSelectedTransport")(function* (
  publisher: Publisher,
  expected: CanaryPath["transport"],
) {
  const result = yield* tryOperation(`read ${expected} RTC transport stats`, () =>
    publisher.room.getRtcStats(),
  )
  const stats = result.publisherStats.map(({ stats }) => stats)
  const transport = stats.find(({ case: statsCase }) => statsCase === "transport")
  if (transport?.case !== "transport") {
    return yield* Effect.fail(
      new MaintenanceFailure({
        operation: `validate ${expected} RTC transport`,
        detail: "publisher stats omitted transport",
      }),
    )
  }
  const pairId = transport.value.transport?.selectedCandidatePairId
  const pair = stats.find(
    ({ case: statsCase, value }) => statsCase === "candidatePair" && value.rtc?.id === pairId,
  )
  if (pair?.case !== "candidatePair") {
    return yield* Effect.fail(
      new MaintenanceFailure({
        operation: `validate ${expected} RTC transport`,
        detail: "selected candidate pair is missing",
      }),
    )
  }
  const localCandidateId = pair.value.candidatePair?.localCandidateId
  const remoteCandidateId = pair.value.candidatePair?.remoteCandidateId
  const local = stats.find(
    ({ case: statsCase, value }) =>
      statsCase === "localCandidate" && value.rtc?.id === localCandidateId,
  )
  const remote = stats.find(
    ({ case: statsCase, value }) =>
      statsCase === "remoteCandidate" && value.rtc?.id === remoteCandidateId,
  )
  if (local?.case !== "localCandidate" || remote?.case !== "remoteCandidate") {
    return yield* Effect.fail(
      new MaintenanceFailure({
        operation: `validate ${expected} RTC transport`,
        detail: "selected local or remote candidate is missing",
      }),
    )
  }
  const evidence: TransportEvidence = {
    candidateType: local.value.candidate?.candidateType ?? -1,
    protocol: local.value.candidate?.protocol ?? "",
    relayProtocol: local.value.candidate?.relayProtocol,
    remoteAddress: remote.value.candidate?.address ?? "",
    remotePort: remote.value.candidate?.port ?? -1,
    url: local.value.candidate?.url ?? "",
  }
  if (!transportEvidenceMatches(expected, evidence)) {
    return yield* Effect.fail(
      new MaintenanceFailure({
        operation: `validate ${expected} RTC transport`,
        detail: `selected candidate does not match the requested direct/relay path; observed=${evidence.candidateType}/${evidence.protocol}/${evidence.relayProtocol ?? "none"}/${evidence.remoteAddress}:${evidence.remotePort}/${evidence.url || "url-omitted"}`,
      }),
    )
  }
  return evidence
})

const awaitCompletedEgress = Effect.fn("LiveKit.awaitCompletedEgress")(function* (
  client: EgressClient,
  egressId: string,
) {
  const poll = Effect.gen(function* () {
    const items = yield* tryOperation("poll Track Egress", () => client.listEgress({ egressId }))
    const info = items[0]
    if (info === undefined) {
      return yield* Effect.fail(
        new MaintenanceFailure({ operation: "poll Track Egress", detail: "egress disappeared" }),
      )
    }
    if (info.status === EgressStatus.EGRESS_FAILED) {
      return yield* Effect.fail(
        new MaintenanceFailure({
          operation: "complete Track Egress",
          detail: info.error || "egress failed without an error message",
        }),
      )
    }
    if (info.status !== EgressStatus.EGRESS_COMPLETE) {
      return yield* Effect.fail(new EgressPending({ egressId }))
    }
    const result = info.fileResults[0]
    if (result === undefined || result.size <= 0n || result.filename.length === 0) {
      return yield* Effect.fail(
        new MaintenanceFailure({
          operation: "validate Track Egress result",
          detail: "completed egress did not report a non-empty file",
        }),
      )
    }
    return info
  })

  return yield* poll.pipe(
    Effect.retry({
      schedule: Schedule.spaced("2 seconds"),
      times: 90,
      while: (error: MaintenanceFailure | EgressPending) => error._tag === "LiveKit.EgressPending",
    }),
    Effect.catchIf(
      (error): error is EgressPending => error._tag === "LiveKit.EgressPending",
      () =>
        Effect.fail(
          new MaintenanceFailure({
            operation: "complete Track Egress",
            detail: `timed out waiting for ${egressId}`,
          }),
        ),
    ),
  )
})

const awaitTerminalEgress = Effect.fn("LiveKit.awaitTerminalEgress")(function* (
  client: EgressClient,
  egressId: string,
) {
  const poll = Effect.gen(function* () {
    const items = yield* tryOperation("wait for terminal Track Egress cleanup", () =>
      client.listEgress({ egressId }),
    )
    const status = items[0]?.status
    if (
      status === undefined ||
      [
        EgressStatus.EGRESS_COMPLETE,
        EgressStatus.EGRESS_FAILED,
        EgressStatus.EGRESS_ABORTED,
        EgressStatus.EGRESS_LIMIT_REACHED,
      ].includes(status)
    ) {
      return
    }
    return yield* Effect.fail(new EgressPending({ egressId }))
  })
  yield* poll.pipe(
    Effect.retry({
      schedule: Schedule.spaced("2 seconds"),
      times: 90,
      while: (error: MaintenanceFailure | EgressPending) => error._tag === "LiveKit.EgressPending",
    }),
    Effect.catchIf(
      (error): error is EgressPending => error._tag === "LiveKit.EgressPending",
      () =>
        Effect.fail(
          new MaintenanceFailure({
            operation: "wait for terminal Track Egress cleanup",
            detail: `timed out waiting for ${egressId}`,
          }),
        ),
    ),
  )
})

const verifyR2Object = Effect.fn("LiveKit.verifyR2Object")(function* (
  client: S3Client,
  path: CanaryPath,
) {
  const head = yield* tryOperation(`verify R2 object ${path.transport}`, () =>
    client.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: path.objectKey })),
  )
  if (
    head.ContentLength === undefined ||
    head.ContentLength <= 0 ||
    head.ETag === undefined ||
    head.LastModified === undefined ||
    head.ContentType === undefined
  ) {
    return yield* Effect.fail(
      new MaintenanceFailure({
        operation: `validate R2 object ${path.transport}`,
        detail: "object is missing size, ETag, Last-Modified, or Content-Type metadata",
      }),
    )
  }
  return { bytes: head.ContentLength, contentType: head.ContentType }
})

const cleanupPublisher = (publisher: Publisher) =>
  tryOperation("clean up canary publisher", async () => {
    if (publisher.room.localParticipant?.trackPublications.has(publisher.trackSid) === true) {
      await publisher.room.localParticipant.unpublishTrack(publisher.trackSid, true)
    }
    await publisher.track.close(true)
    if (publisher.room.isConnected) {
      await publisher.room.disconnect()
    }
  })

const runTrackCanary = Effect.fn("LiveKit.runTrackCanary")(function* () {
  const config = yield* configuration
  const clients = makeClients(config)
  const runId = crypto.randomUUID()
  const roomName = `maintenance-canary-${runId}`
  const paths = buildCanaryPaths(runId)
  const publishers: Publisher[] = []
  const egressIds: string[] = []
  const transportEvidence: TransportEvidence[] = []
  let publishersCleaned = false

  const canary = Effect.gen(function* () {
    yield* tryOperation("authenticate LiveKit API", () => clients.room.listRooms())
    yield* verifyR2Authority(clients.r2)

    for (const path of paths) {
      publishers.push(yield* connectPublisher(config, roomName, path))
    }

    for (const [index, path] of paths.entries()) {
      const publisher = publishers[index]
      if (publisher === undefined) {
        return yield* Effect.fail(
          new MaintenanceFailure({ operation: "start Track Egress", detail: "publisher missing" }),
        )
      }
      const info = yield* tryOperation(`start ${path.transport} Track Egress`, () =>
        clients.egress.startTrackEgress(
          roomName,
          new DirectFileOutput({ filepath: path.filepath, disableManifest: true }),
          publisher.trackSid,
        ),
      )
      egressIds.push(info.egressId)
    }

    yield* Effect.all(publishers.map(captureTone), { concurrency: "unbounded" })
    transportEvidence.push(
      ...(yield* Effect.all(
        publishers.map((publisher, index) => {
          const path = paths[index]
          return path === undefined
            ? Effect.fail(
                new MaintenanceFailure({
                  operation: "validate RTC transport",
                  detail: "publisher path is missing",
                }),
              )
            : readSelectedTransport(publisher, path.transport)
        }),
        { concurrency: "unbounded" },
      )),
    )
    yield* runMaintenanceCleanups("disconnect canary publishers", publishers.map(cleanupPublisher))
    publishersCleaned = true

    const completed = yield* Effect.all(
      egressIds.map((egressId) => awaitCompletedEgress(clients.egress, egressId)),
      { concurrency: "unbounded" },
    )
    if (completed.length !== 2) {
      return yield* Effect.fail(
        new MaintenanceFailure({ operation: "complete Track Egress", detail: "expected two jobs" }),
      )
    }

    const objects = yield* Effect.all(
      paths.map((path) => verifyR2Object(clients.r2, path)),
      {
        concurrency: "unbounded",
      },
    )
    const directObject = objects[0]
    const relayObject = objects[1]
    if (directObject === undefined || relayObject === undefined) {
      return yield* Effect.fail(
        new MaintenanceFailure({ operation: "verify R2 objects", detail: "expected two objects" }),
      )
    }
    yield* Effect.logInfo(
      `Track Egress canary passed: direct=${directObject.bytes}B/${directObject.contentType}, relay=${relayObject.bytes}B/${relayObject.contentType}; selected transports=${transportEvidence.map(({ candidateType, protocol, relayProtocol, remotePort }) => `${candidateType}/${protocol}/${relayProtocol ?? "none"}/${remotePort}`).join(",")}`,
    )
  })

  yield* Effect.acquireUseRelease(
    Effect.void,
    () => canary,
    (_, exit) => {
      let terminalCleanupSucceeded = false
      const terminalCleanup = runMaintenanceCleanups(
        "wait for terminal Track Egress cleanup",
        Exit.isFailure(exit)
          ? egressIds.map((egressId) => awaitTerminalEgress(clients.egress, egressId))
          : [],
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            terminalCleanupSucceeded = true
          }),
        ),
      )
      const objectCleanup = Effect.suspend(() =>
        canDeleteCanaryObjects(Exit.isSuccess(exit), terminalCleanupSucceeded)
          ? runMaintenanceCleanups(
              "remove canary R2 objects",
              paths.map((path) =>
                tryOperation("remove canary R2 object", () =>
                  clients.r2.send(
                    new DeleteObjectCommand({ Bucket: r2Bucket, Key: path.objectKey }),
                  ),
                ),
              ),
            )
          : Effect.logWarning(
              `Preserving canary R2 objects because Egress terminal state is unknown: ${paths.map(({ objectKey }) => objectKey).join(",")}`,
            ),
      )
      return releaseWithExit(
        exit,
        runCleanupPhases([
          runMaintenanceCleanups(
            "disconnect canary publishers",
            !publishersCleaned ? publishers.map(cleanupPublisher) : [],
          ),
          runMaintenanceCleanups(
            "stop unfinished Track Egress",
            Exit.isFailure(exit)
              ? egressIds.map((egressId) =>
                  tryOperation("stop unfinished Track Egress", () =>
                    clients.egress.stopEgress(egressId),
                  ),
                )
              : [],
          ),
          terminalCleanup,
          objectCleanup,
          tryOperation("delete canary room", async () => {
            const rooms = await clients.room.listRooms([roomName])
            if (rooms.length > 0) await clients.room.deleteRoom(roomName)
          }),
        ]).pipe(Effect.ensuring(Effect.sync(() => clients.r2.destroy()))),
      )
    },
  )
})

if (import.meta.main) {
  const command = process.argv[2]
  const program =
    command === "verify"
      ? verifyAuthorities()
      : command === "track-canary"
        ? runTrackCanary()
        : Effect.fail(
            new MaintenanceFailure({
              operation: "select command",
              detail: "expected verify or track-canary",
            }),
          )

  const runnable =
    command === "track-canary"
      ? Effect.acquireUseRelease(
          Effect.void,
          () => program,
          (_, exit) =>
            releaseWithExit(
              exit,
              tryOperation("shut down LiveKit RTC FFI", () => disposeRtc()),
            ),
        )
      : program

  Effect.runPromise(
    runnable.pipe(
      Effect.tapError((error) => Effect.sync(() => console.error(messageFromCause(error)))),
    ),
  ).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error(message)
    process.exitCode = 1
  })
}
