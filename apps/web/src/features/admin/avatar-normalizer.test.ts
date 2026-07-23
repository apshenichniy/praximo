import { describe, expect, it } from "vitest"
import {
  AvatarProcessingError,
  normalizeAvatarFile,
  validateAvatarFile,
} from "./avatar-normalizer.ts"

describe("avatar normalizer", () => {
  it("accepts JPEG, PNG, and WebP up to 10 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() =>
        validateAvatarFile(new File([new Uint8Array(16)], "avatar", { type })),
      ).not.toThrow()
    }
  })

  it("rejects unsupported types and files over 10 MB", () => {
    expect(() =>
      validateAvatarFile(new File([new Uint8Array(16)], "avatar.gif", { type: "image/gif" })),
    ).toThrow(new AvatarProcessingError("type"))
    expect(() =>
      validateAvatarFile(
        new File([new Uint8Array(10 * 1_024 * 1_024 + 1)], "avatar.png", {
          type: "image/png",
        }),
      ),
    ).toThrow(new AvatarProcessingError("size"))
  })

  it("returns a normalized 512px JPEG file", async () => {
    const source = new File([new Uint8Array(16)], "source.png", { type: "image/png" })
    const normalized = await normalizeAvatarFile(source, async () => ({
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
      width: 512,
      height: 512,
    }))

    expect(normalized.file.type).toBe("image/jpeg")
    expect(normalized.file.name).toBe("avatar.jpg")
    expect(normalized.width).toBe(512)
    expect(normalized.height).toBe(512)
  })
})
