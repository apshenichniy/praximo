import { describe, expect, it } from "vitest"
import { decode } from "jpeg-js"
import {
  AvatarSide,
  defaultBotDescription,
  defaultBotShortDescription,
  generateDefaultAvatar,
} from "./default-branding.ts"

describe("default coach-bot branding", () => {
  it("templates the description around the coach's name", () => {
    expect(defaultBotDescription("Ada Lovelace")).toBe(
      "Coaching with Ada Lovelace · powered by Praximo.",
    )
    expect(defaultBotShortDescription("Ada Lovelace")).toBe("Coaching with Ada Lovelace")
  })

  it("still says something when there is no name to say it about", () => {
    expect(defaultBotDescription("   ")).toBe("Coaching, powered by Praximo.")
    expect(defaultBotShortDescription("")).toBe("Coaching, powered by Praximo")
  })

  it("keeps both fields inside Telegram's limits for an absurdly long name", () => {
    const description = defaultBotDescription("Ada".repeat(400))
    const shortDescription = defaultBotShortDescription("Ada".repeat(400))

    expect(description.length).toBeLessThanOrEqual(512)
    expect(shortDescription.length).toBeLessThanOrEqual(120)
    expect(description.endsWith("…")).toBe(true)
  })

  it("generates a square JPEG Telegram will accept as a profile photo", () => {
    const avatar = generateDefaultAvatar("7000000042")
    const decoded = decode(avatar, { useTArray: true })

    expect(decoded.width).toBe(AvatarSide)
    expect(decoded.height).toBe(AvatarSide)
    expect(avatar.byteLength).toBeGreaterThan(1_000)
  })

  it("is deterministic per seed, so a re-provisioning never re-skins the bot", () => {
    expect(generateDefaultAvatar("7000000042")).toEqual(generateDefaultAvatar("7000000042"))
  })

  it("actually varies across coaches rather than shipping one stock image", () => {
    const seeds = ["1", "2", "3", "4", "5", "6", "7", "8"]
    const rendered = new Set(seeds.map((seed) => generateDefaultAvatar(seed).join(",")))

    expect(rendered.size).toBeGreaterThan(1)
  })
})
