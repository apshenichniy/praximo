import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  buildCanaryPaths,
  canDeleteCanaryObjects,
  createSineSamples,
  transportEvidenceMatches,
} from "./ops.ts"

describe("LiveKit maintenance operations", () => {
  it.effect("keeps Egress file paths relative while checking the configured R2 prefix", () =>
    Effect.sync(() => {
      const [direct, relay] = buildCanaryPaths("run-123")

      expect(direct.filepath).toBe("maintenance-canary/run-123/direct.ogg")
      expect(direct.objectKey).toBe("recordings/maintenance-canary/run-123/direct.ogg")
      expect(direct.transport).toBe("direct")
      expect(relay.filepath).toBe("maintenance-canary/run-123/relay.ogg")
      expect(relay.objectKey).toBe("recordings/maintenance-canary/run-123/relay.ogg")
      expect(relay.transport).toBe("relay")
    }),
  )

  it.effect("creates a bounded, non-silent PCM frame", () =>
    Effect.sync(() => {
      const samples = createSineSamples(440, 48_000, 480, 0)

      expect(samples).toHaveLength(480)
      expect(samples.some((sample) => sample !== 0)).toBe(true)
      expect(Math.max(...samples)).toBeLessThanOrEqual(4_000)
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(-4_000)
    }),
  )

  it.effect("preserves objects when failed Egress cleanup cannot prove a terminal state", () =>
    Effect.sync(() => {
      expect(canDeleteCanaryObjects(true, false)).toBe(true)
      expect(canDeleteCanaryObjects(false, true)).toBe(true)
      expect(canDeleteCanaryObjects(false, false)).toBe(false)
    }),
  )

  it.effect("requires selected candidate evidence to match direct and relay paths", () =>
    Effect.sync(() => {
      expect(
        transportEvidenceMatches("direct", {
          candidateType: 1,
          protocol: "udp",
          relayProtocol: undefined,
          remoteAddress: "135.125.175.57",
          remotePort: 50_123,
          url: "",
        }),
      ).toBe(true)
      expect(
        transportEvidenceMatches("relay", {
          candidateType: 3,
          protocol: "tcp",
          relayProtocol: 2,
          remoteAddress: "135.125.175.57",
          remotePort: 443,
          url: "turns:turn.praximo.io:443?transport=tcp",
        }),
      ).toBe(true)
      expect(
        transportEvidenceMatches("relay", {
          candidateType: 3,
          protocol: "udp",
          relayProtocol: 0,
          remoteAddress: "135.125.175.57",
          remotePort: 50_123,
          url: "turn:135.125.175.57:3478?transport=udp",
        }),
      ).toBe(true)
      expect(
        transportEvidenceMatches("relay", {
          candidateType: 1,
          protocol: "udp",
          relayProtocol: undefined,
          remoteAddress: "135.125.175.57",
          remotePort: 50_123,
          url: "",
        }),
      ).toBe(false)
      expect(
        transportEvidenceMatches("direct", {
          candidateType: -1,
          protocol: "udp",
          relayProtocol: undefined,
          remoteAddress: "135.125.175.57",
          remotePort: 50_123,
          url: "",
        }),
      ).toBe(false)
      expect(
        transportEvidenceMatches("direct", {
          candidateType: 1,
          protocol: "tcp",
          relayProtocol: undefined,
          remoteAddress: "135.125.175.57",
          remotePort: 443,
          url: "",
        }),
      ).toBe(false)
    }),
  )
})
