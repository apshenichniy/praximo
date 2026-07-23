import { describe, expect, it } from "vitest"
import { parseBrandingAvatarArgs, selectStageBucket } from "./set-branding-avatar.ts"

describe("branding avatar command", () => {
  it("requires an explicit valid stage and source file", () => {
    expect(
      parseBrandingAvatarArgs([
        "--stage",
        "dev_apshenichniy",
        "--file",
        "./avatar.png",
        "--key",
        "branding/default-coach-avatar.jpg",
      ]),
    ).toMatchObject({
      stage: "dev_apshenichniy",
      key: "branding/default-coach-avatar.jpg",
    })
    expect(() =>
      parseBrandingAvatarArgs([
        "--stage",
        "staging",
        "--file",
        "./avatar.png",
        "--key",
        "branding/default-coach-avatar.jpg",
      ]),
    ).toThrow()
    expect(() => parseBrandingAvatarArgs(["--stage", "prod"])).toThrow()
  })

  it("selects exactly one stage-isolated Uploads bucket", () => {
    expect(
      selectStageBucket("dev_apshenichniy", [
        "praximo-dev-apshenichniy-uploads-abc",
        "praximo-prod-uploads-def",
      ]),
    ).toBe("praximo-dev-apshenichniy-uploads-abc")
    expect(() =>
      selectStageBucket("prod", ["praximo-prod-uploads-one", "praximo-prod-uploads-two"]),
    ).toThrow()
  })
})
