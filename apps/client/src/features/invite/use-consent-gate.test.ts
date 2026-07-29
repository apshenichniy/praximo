import { describe, expect, it } from "vitest"

import { type GateObserverFactory, watchConsentGate } from "./use-consent-gate.ts"

const sentinel = {} as Element

type Callback = (entries: ReadonlyArray<{ readonly isIntersecting: boolean }>) => void

const noop: Callback = () => {}

const fakeObserver = () => {
  const state = { observed: [] as Array<Element>, disconnects: 0, callback: noop }
  const factory: GateObserverFactory = (callback) => {
    state.callback = callback
    return {
      observe: (target) => state.observed.push(target),
      disconnect: () => {
        state.disconnects += 1
      },
    }
  }
  return {
    state,
    factory,
    emit: (visible: boolean) => state.callback([{ isIntersecting: visible }]),
  }
}

describe("consent gate", () => {
  /**
   * The case the ticket calls out by name. At 1280 × 900 the consent pane fits
   * entirely, so the sentinel after the last point is on screen from the start
   * and the observer's first callback reports it — the commit is live on arrival.
   * That is the rule working, not the rule failing.
   */
  it("unlocks on the first callback when the pane already fits", () => {
    const { state, factory, emit } = fakeObserver()
    let unlocked = false

    watchConsentGate(sentinel, () => (unlocked = true), factory)
    expect(state.observed).toEqual([sentinel])
    expect(unlocked).toBe(false)

    emit(true)
    expect(unlocked).toBe(true)
  })

  it("stays locked while the last point is still below the fold", () => {
    const { factory, emit } = fakeObserver()
    let unlocked = false

    watchConsentGate(sentinel, () => (unlocked = true), factory)
    emit(false)
    expect(unlocked).toBe(false)
  })

  /** One-way: the observer stops watching, so scrolling back up cannot re-lock. */
  it("stops watching once it has unlocked", () => {
    const { state, factory, emit } = fakeObserver()
    let unlocks = 0

    watchConsentGate(sentinel, () => (unlocks += 1), factory)
    emit(true)
    emit(true)

    expect(unlocks).toBe(1)
    expect(state.disconnects).toBe(1)
  })

  /**
   * A browser without `IntersectionObserver` gets an active commit, not a dead
   * one. The gate is a reading aid; refusing here would deny somebody their
   * coach over a missing API, and the consent text is on the page regardless.
   */
  it("unlocks when the browser cannot observe at all", () => {
    let unlocked = false
    watchConsentGate(sentinel, () => (unlocked = true), undefined)
    expect(unlocked).toBe(true)
  })

  it("unlocks when the sentinel never mounted", () => {
    const { factory } = fakeObserver()
    let unlocked = false
    watchConsentGate(null, () => (unlocked = true), factory)
    expect(unlocked).toBe(true)
  })

  it("disconnects on cleanup even if it never unlocked", () => {
    const { state, factory } = fakeObserver()
    const stop = watchConsentGate(sentinel, () => {}, factory)
    stop()
    expect(state.disconnects).toBe(1)
  })
})
