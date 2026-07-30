import { describe, expect, it } from "@effect/vitest"
import { avatarKey } from "./avatar-key.ts"

const coach = {
  subject: "coach",
  subjectId: "ws_019f92510000700080000000",
  contentType: "image/jpeg",
} as const

describe("avatarKey", () => {
  it("names the subject, the row it hangs off, and the source image", () => {
    const key = avatarKey({ ...coach, sourceId: "AQADBAADq6cxG4AB" })

    expect(key).toMatch(
      /^avatars\/coach\/ws_019f92510000700080000000\/AQADBAADq6cxG4AB-[a-z0-9]+\.jpg$/,
    )
  })

  it("is the same key for the same source, which is what makes a refresh a no-op", () => {
    const first = avatarKey({ ...coach, sourceId: "AQADBAADq6cxG4AB" })
    const second = avatarKey({ ...coach, sourceId: "AQADBAADq6cxG4AB" })

    expect(first).toBe(second)
  })

  it("changes when the source image changes, which is what makes a refresh happen", () => {
    const before = avatarKey({ ...coach, sourceId: "AQADBAADq6cxG4AB" })
    const after = avatarKey({ ...coach, sourceId: "AQADBAADq6cxG4AC" })

    expect(after).not.toBe(before)
  })

  it("keeps two subjects apart even when they share a source", () => {
    const first = avatarKey({ ...coach, sourceId: "AQADBAADq6cxG4AB" })
    const second = avatarKey({ ...coach, subjectId: "ws_other", sourceId: "AQADBAADq6cxG4AB" })

    expect(first).not.toBe(second)
  })

  it("takes the extension from the content type", () => {
    const png = avatarKey({ ...coach, contentType: "image/png", sourceId: "abc" })
    const webp = avatarKey({ ...coach, contentType: "image/webp", sourceId: "abc" })

    expect(png).toMatch(/\.png$/)
    expect(webp).toMatch(/\.webp$/)
  })

  it("reads a content type off the wire, parameters and casing included", () => {
    const key = avatarKey({ ...coach, contentType: "IMAGE/JPEG; charset=binary", sourceId: "abc" })

    expect(key).toMatch(/\.jpg$/)
  })

  it("refuses a content type outside the three shapes an avatar may be", () => {
    expect(avatarKey({ ...coach, contentType: "image/svg+xml", sourceId: "abc" })).toBeUndefined()
    expect(avatarKey({ ...coach, contentType: "text/html", sourceId: "abc" })).toBeUndefined()
    expect(avatarKey({ ...coach, contentType: "", sourceId: "abc" })).toBeUndefined()
  })

  it("refuses a subject or a source it has no name for", () => {
    expect(avatarKey({ ...coach, sourceId: "" })).toBeUndefined()
    expect(avatarKey({ ...coach, subjectId: "", sourceId: "abc" })).toBeUndefined()
    // Nothing survives the sanitiser, so there is no subject to file this under.
    expect(avatarKey({ ...coach, subjectId: "../..", sourceId: "abc" })).toBeUndefined()
  })

  it("keeps a source id out of the key's structure", () => {
    const key = avatarKey({
      ...coach,
      sourceId: "https://lh3.googleusercontent.com/a/../../secret?sz=96",
    })

    // No traversal, no query, no second slash below the subject: whatever a
    // caller names its source, the key stays one flat object under one prefix.
    expect(key).toBeDefined()
    expect(key?.startsWith("avatars/coach/ws_019f92510000700080000000/")).toBe(true)
    expect(key?.slice("avatars/coach/ws_019f92510000700080000000/".length)).not.toContain("/")
    expect(key).not.toContain("..")
    expect(key).not.toContain("?")
  })

  it("distinguishes two long sources that sanitise to the same readable stem", () => {
    // The truncation is what makes this possible at all, and the checksum over
    // the *raw* source is what keeps it from reading as "unchanged".
    const first = avatarKey({ ...coach, sourceId: `${"a".repeat(40)}/one` })
    const second = avatarKey({ ...coach, sourceId: `${"a".repeat(40)}/two` })

    expect(first).not.toBe(second)
  })
})
