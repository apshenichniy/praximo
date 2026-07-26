import { describe, expect, it } from "@effect/vitest"
import {
  DefaultMemberSettings,
  isSupportedTimeZone,
  readMemberSettings,
} from "./member-settings.ts"

describe("readMemberSettings", () => {
  // The column is jsonb and arrives from a row that may predate every key in it.
  // A settings blob is never worth failing a launch over, so anything unreadable
  // is read as "nothing has been chosen".
  it("reads a missing or malformed value as the defaults", () => {
    expect(readMemberSettings(null)).toEqual(DefaultMemberSettings)
    expect(readMemberSettings(undefined)).toEqual(DefaultMemberSettings)
    expect(readMemberSettings("mainMiniAppHintDismissed")).toEqual(DefaultMemberSettings)
    expect(readMemberSettings({ mainMiniAppHintDismissed: "yes" })).toEqual(DefaultMemberSettings)
  })

  it("reads the one key this slice writes", () => {
    expect(readMemberSettings({ mainMiniAppHintDismissed: true })).toEqual({
      mainMiniAppHintDismissed: true,
    })
  })

  // Unknown keys survive a read so a client on an older deploy cannot erase a
  // setting written by a newer one when it writes its own.
  it("keeps a key it does not know about", () => {
    expect(readMemberSettings({ mainMiniAppHintDismissed: true, somethingLater: 3 })).toEqual({
      mainMiniAppHintDismissed: true,
      somethingLater: 3,
    })
  })
})

describe("isSupportedTimeZone", () => {
  it("accepts an IANA zone the runtime can resolve", () => {
    expect(isSupportedTimeZone("Europe/Kyiv")).toBe(true)
    expect(isSupportedTimeZone("UTC")).toBe(true)
  })

  it("refuses anything the runtime cannot", () => {
    expect(isSupportedTimeZone("")).toBe(false)
    expect(isSupportedTimeZone("Mars/Olympus_Mons")).toBe(false)
    expect(isSupportedTimeZone("+03:00")).toBe(false)
  })
})
