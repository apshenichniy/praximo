import { describe, expect, it, vi } from "vitest"

import {
  BOT_ID_HEADER,
  createLaunchCredentialResolver,
  INIT_DATA_HEADER,
  launchCredentialFromHeaders,
  launchCredentialHeaders,
} from "./launch-credential.ts"

describe("launch credential client", () => {
  it("reads the launch once and keeps the bot selector beside the signed data", async () => {
    const readInitData = vi.fn(async () => "signed")
    const resolve = createLaunchCredentialResolver({
      isDevelopment: false,
      readBotId: () => "9100777",
      readInitData,
    })

    await expect(resolve()).resolves.toEqual({ botId: "9100777", initData: "signed" })
    await expect(resolve()).resolves.toEqual({ botId: "9100777", initData: "signed" })
    expect(readInitData).toHaveBeenCalledOnce()
  })

  it("uses the development minter only when the host has no credential", async () => {
    const loadDevelopmentInitData = vi.fn(async (botId: string) => `local:${botId}`)
    const resolve = createLaunchCredentialResolver({
      isDevelopment: true,
      loadDevelopmentInitData,
      readBotId: () => "9100777",
      readInitData: async () => undefined,
    })

    await expect(resolve()).resolves.toEqual({
      botId: "9100777",
      initData: "local:9100777",
    })
    expect(loadDevelopmentInitData).toHaveBeenCalledWith("9100777")
  })

  it("keeps an unavailable or failed credential empty", async () => {
    const resolve = createLaunchCredentialResolver({
      isDevelopment: true,
      loadDevelopmentInitData: async () => {
        throw new Error("development minter unavailable")
      },
      readInitData: async () => undefined,
    })

    await expect(resolve()).resolves.toEqual({ botId: "", initData: "" })
  })

  it("round-trips the two request headers without putting the credential in arguments", () => {
    const credential = { botId: "9100777", initData: "signed" }
    expect(launchCredentialHeaders(credential)).toEqual({
      [BOT_ID_HEADER]: "9100777",
      [INIT_DATA_HEADER]: "signed",
    })

    const headers = new Map(Object.entries(launchCredentialHeaders(credential)))
    expect(launchCredentialFromHeaders((name) => headers.get(name))).toEqual(credential)
  })
})
