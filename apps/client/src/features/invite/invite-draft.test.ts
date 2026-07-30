import { describe, expect, it } from "vitest"

import { clearDraft, readDraft, writeDraft } from "./invite-draft.ts"

/**
 * The draft that survives the Google redirect fallback (#59).
 *
 * Its whole reason to exist is one sentence from the ticket — an import must
 * never cost the client what they typed — so the cases worth holding are the two
 * ways it could: losing the draft on the way back, and handing one invitation's
 * draft to another.
 */

const TOKEN = "23456789ABCD"
const OTHER = "ABCDEFGH2345"

/** A `Storage` with nothing of the DOM in it, so this runs in Node. */
const memoryStorage = (): Storage => {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, value),
  } as Storage
}

/** Safari in private browsing throws rather than returning null. */
const hostileStorage = (): Storage =>
  ({
    getItem: () => {
      throw new Error("denied")
    },
    setItem: () => {
      throw new Error("denied")
    },
    removeItem: () => {
      throw new Error("denied")
    },
  }) as unknown as Storage

describe("the invitation draft", () => {
  it("comes back exactly as it went in", () => {
    const storage = memoryStorage()
    writeDraft(storage, TOKEN, { name: "Олена", email: "olena@example.com" })
    expect(readDraft(storage, TOKEN)).toEqual({ name: "Олена", email: "olena@example.com" })
  })

  it("is scoped to its own invitation", () => {
    const storage = memoryStorage()
    writeDraft(storage, TOKEN, { name: "Олена", email: "olena@example.com" })
    expect(readDraft(storage, OTHER)).toBeUndefined()
  })

  it("is gone once it is cleared", () => {
    const storage = memoryStorage()
    writeDraft(storage, TOKEN, { name: "Олена", email: "" })
    clearDraft(storage, TOKEN)
    expect(readDraft(storage, TOKEN)).toBeUndefined()
  })

  /** Restoring it would only mean overwriting a pre-filled address with nothing. */
  it("treats two empty fields as no draft at all", () => {
    const storage = memoryStorage()
    writeDraft(storage, TOKEN, { name: "", email: "" })
    expect(readDraft(storage, TOKEN)).toBeUndefined()
  })

  it("keeps a half-filled one", () => {
    const storage = memoryStorage()
    writeDraft(storage, TOKEN, { name: "Олена", email: "" })
    expect(readDraft(storage, TOKEN)).toEqual({ name: "Олена", email: "" })
  })

  it("answers for a browser that will not store, rather than raising at one", () => {
    const hostile = hostileStorage()
    expect(() => writeDraft(hostile, TOKEN, { name: "a", email: "b" })).not.toThrow()
    expect(readDraft(hostile, TOKEN)).toBeUndefined()
    expect(() => clearDraft(hostile, TOKEN)).not.toThrow()
  })

  it("answers for a render that has no browser at all", () => {
    expect(readDraft(undefined, TOKEN)).toBeUndefined()
    expect(() => writeDraft(undefined, TOKEN, { name: "a", email: "b" })).not.toThrow()
  })

  it("ignores stored nonsense rather than trusting it", () => {
    const storage = memoryStorage()
    storage.setItem(`praximo.invite-draft.${TOKEN}`, "not json")
    expect(readDraft(storage, TOKEN)).toBeUndefined()
    storage.setItem(`praximo.invite-draft.${TOKEN}`, '["a"]')
    expect(readDraft(storage, TOKEN)).toBeUndefined()
  })
})
