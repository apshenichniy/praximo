import { describe, expect, it } from "vitest"
import { defaultBotDescription, defaultBotShortDescription } from "./default-branding.ts"

describe("default coach-bot branding", () => {
  it("templates the description around the coach's name", () => {
    expect(defaultBotDescription("Ada Lovelace")).toBe(
      "Coaching with Ada Lovelace · powered by Praximo",
    )
    expect(defaultBotShortDescription("Ada Lovelace")).toBe("Coaching with Ada Lovelace")
  })

  it("still says something when there is no name to say it about", () => {
    expect(defaultBotDescription("   ")).toBe("Coaching, powered by Praximo")
    expect(defaultBotShortDescription("")).toBe("Coaching, powered by Praximo")
  })

  it("keeps both fields inside Telegram's limits for an absurdly long name", () => {
    const description = defaultBotDescription("Ada".repeat(400))
    const shortDescription = defaultBotShortDescription("Ada".repeat(400))

    expect(description.length).toBeLessThanOrEqual(512)
    expect(shortDescription.length).toBeLessThanOrEqual(120)
    expect(description.endsWith("…")).toBe(true)
  })
})
