import { WorkspaceDescriptionMaxLength, WorkspaceShortDescriptionMaxLength } from "@praximo/domain"
import { encode } from "jpeg-js"

/**
 * Every coach bot is born Praximo-branded (#108). The admin no longer sets a
 * description or an avatar — the coach owns their bot's identity and rebrands
 * it from their side — so provisioning has to hand them something deliberate to
 * start from rather than an empty profile or one shared stock image.
 *
 * Both halves are pure functions of the coach's name: no network, no R2 round
 * trip, and the same input always produces the same bot. That matters because
 * provisioning may be retried, and a retry must not quietly re-skin a bot the
 * coach has since made their own.
 */

const clamp = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`

/** "Coaching with Ada · powered by Praximo" — the templated bot description. */
export const defaultBotDescription = (coachName: string): string => {
  const name = coachName.trim()
  const text =
    name.length === 0
      ? "Coaching, powered by Praximo."
      : `Coaching with ${name} · powered by Praximo.`
  return clamp(text, WorkspaceDescriptionMaxLength)
}

/** The one-liner Telegram shows above the chat before the first message. */
export const defaultBotShortDescription = (coachName: string): string => {
  const name = coachName.trim()
  const text = name.length === 0 ? "Coaching, powered by Praximo" : `Coaching with ${name}`
  return clamp(text, WorkspaceShortDescriptionMaxLength)
}

export const AvatarSide = 512

/**
 * The brand's own violet-to-indigo ramp, plus neighbours around it. Which pair
 * a bot gets is decided by a hash of its seed, so two coaches rarely collide
 * and any one coach's avatar never changes between provisioning attempts.
 */
const gradients = [
  { from: [124, 58, 237], to: [30, 27, 75] },
  { from: [99, 102, 241], to: [23, 37, 84] },
  { from: [168, 85, 247], to: [46, 16, 101] },
  { from: [59, 130, 246], to: [23, 37, 84] },
  { from: [217, 70, 239], to: [59, 7, 100] },
  { from: [56, 189, 248], to: [12, 74, 110] },
] as const satisfies ReadonlyArray<{
  from: readonly [number, number, number]
  to: readonly [number, number, number]
}>

/** FNV-1a over the seed's code units — stable across runtimes, unlike hashing bytes. */
const hash = (seed: string): number => {
  let value = 0x811c9dc5
  for (const byte of new TextEncoder().encode(seed)) {
    value ^= byte
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/**
 * A 512×512 diagonal-gradient JPEG, generated in the Worker (workerd has no
 * canvas, so the pixels are written by hand and JPEG-encoded in pure JS).
 *
 * The gradient runs corner to corner and carries a soft radial highlight near
 * the top-left, which is what keeps it from reading as a flat colour swatch at
 * the size Telegram actually renders an avatar.
 */
export const generateDefaultAvatar = (seed: string): Uint8Array => {
  const gradient = gradients[hash(seed) % gradients.length] ?? gradients[0]
  const data = new Uint8Array(AvatarSide * AvatarSide * 4)

  for (let y = 0; y < AvatarSide; y += 1) {
    for (let x = 0; x < AvatarSide; x += 1) {
      // 0 at the top-left corner, 1 at the bottom-right one.
      const ramp = (x + y) / (2 * (AvatarSide - 1))
      const dx = (x - AvatarSide * 0.3) / AvatarSide
      const dy = (y - AvatarSide * 0.25) / AvatarSide
      const highlight = Math.max(0, 0.18 - Math.sqrt(dx * dx + dy * dy) * 0.28)
      const offset = (y * AvatarSide + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const from = gradient.from[channel] ?? 0
        const to = gradient.to[channel] ?? 0
        const value = from + (to - from) * ramp + highlight * 255
        data[offset + channel] = Math.min(255, Math.max(0, Math.round(value)))
      }
      data[offset + 3] = 255
    }
  }

  return new Uint8Array(encode({ data, width: AvatarSide, height: AvatarSide }, 90).data)
}
