import { describe, expect, it } from "@effect/vitest"
import { avatarContentTypeForKey, avatarETag, avatarKey } from "./avatar-key.ts"

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

describe("avatarContentTypeForKey", () => {
  it("reads back the type each extension was written under", () => {
    expect(avatarContentTypeForKey("avatars/coach/ws_1/a-1.jpg")).toBe("image/jpeg")
    expect(avatarContentTypeForKey("avatars/client/cl_1/a-1.png")).toBe("image/png")
    expect(avatarContentTypeForKey("avatars/client/cl_1/a-1.webp")).toBe("image/webp")
  })

  it("round-trips whatever avatarKey composed, for every type it accepts", () => {
    for (const contentType of ["image/jpeg", "image/png", "image/webp"] as const) {
      const key = avatarKey({ ...coach, contentType, sourceId: "AQADBAADq6cxG4AB" })

      expect(key).toBeDefined()
      expect(avatarContentTypeForKey(key ?? "")).toBe(contentType)
    }
  })

  it("names nothing for a key this package did not compose", () => {
    // Not a guess and not `octet-stream`: a reader that met one of these is
    // looking at a column written by something else.
    expect(avatarContentTypeForKey("avatars/coach/ws_1/a-1.gif")).toBeUndefined()
    expect(avatarContentTypeForKey("avatars/coach/ws_1/a-1")).toBeUndefined()
    expect(avatarContentTypeForKey("")).toBeUndefined()
    // A dot in the prefix must not be read as an extension.
    expect(avatarContentTypeForKey("avatars/coach/ws.1/photo")).toBeUndefined()
  })
})

describe("avatarETag", () => {
  const key = "avatars/client/cl_019f9251/AQADBAADq6cxG4AB-1a2b3c.jpg"

  it("names the object without naming the key", () => {
    const etag = avatarETag(key)

    // Quoted and strong: two responses carrying this tag are the same bytes.
    expect(etag).toMatch(/^"[a-z0-9]+"$/)
    // The whole reason it is a digest: an ETag is echoed by the browser and kept
    // in its cache, so the key must not be recoverable from one.
    expect(etag).not.toContain("avatars/")
    expect(etag).not.toContain("AQADBAADq6cxG4AB")
    expect(etag).not.toContain("cl_019f9251")
  })

  it("is stable for one key and different for another", () => {
    expect(avatarETag(key)).toBe(avatarETag(key))
    expect(avatarETag(key)).not.toBe(avatarETag(key.replace("G4AB", "G4AC")))
  })
})
