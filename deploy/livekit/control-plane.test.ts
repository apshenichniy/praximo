import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  buildOvhSignature,
  buildR2TokenRequest,
  deriveR2SecretAccessKey,
  isSupportedOvhImage,
  matchesConfirmation,
} from "./control-plane.ts"

describe("LiveKit control-plane operations", () => {
  it.effect("derives the R2 S3 secret from a Cloudflare account-token value", () =>
    Effect.sync(() => {
      expect(deriveR2SecretAccessKey("token-value")).toBe(
        "e6c02a5742ea9d4de588eb9b9de7bed43dc17011552186bed3e98b2c5958ff4a",
      )
    }),
  )

  it.effect("scopes a new R2 token to the production EU bucket", () =>
    Effect.sync(() => {
      const request = buildR2TokenRequest("account-123", "maintenance-token")
      const policy = request.policies[0]

      expect(request.name).toBe("maintenance-token")
      expect(policy?.resources).toEqual({
        "com.cloudflare.edge.r2.bucket.account-123_eu_praximo-prod-r2": "*",
      })
      expect(policy?.permission_groups.map(({ id }) => id)).toEqual([
        "6a018a9f2fc74eb6b293b0c548f38b39",
        "2efd5506f9c8494dacb1fa10a3e7d5b6",
      ])
    }),
  )

  it.effect("signs OVH requests with the documented v1 signature input", () =>
    Effect.sync(() => {
      expect(
        buildOvhSignature(
          "application-secret",
          "consumer-key",
          "GET",
          "https://eu.api.ovh.com/1.0/vps/example",
          "",
          1_700_000_000,
        ),
      ).toBe("$1$4dfce939c9c43c70904a56ec713e9df280d40016")
    }),
  )

  it.effect("rejects destructive confirmation for a different resource", () =>
    Effect.sync(() => {
      expect(matchesConfirmation("production-id", "--confirm-token=other-id", "token")).toBe(false)
      expect(matchesConfirmation("production-id", "--confirm-token=production-id", "token")).toBe(
        true,
      )
    }),
  )

  it.effect("accepts only the selected Ubuntu 26.04 OVH image identity", () =>
    Effect.sync(() => {
      const templateId = "8850e5ea-d659-44c4-a664-54251a7270bc"
      expect(isSupportedOvhImage(templateId, { id: templateId, name: "Ubuntu 26.04" })).toBe(true)
      expect(isSupportedOvhImage(templateId, { id: templateId, name: "Ubuntu 24.04" })).toBe(false)
      expect(isSupportedOvhImage(templateId, { id: "another-id", name: "Ubuntu 26.04" })).toBe(
        false,
      )
    }),
  )
})
