/**
 * `member.settings` — per-coach choices that are not worth a column each, and
 * `member.timezone`'s validation beside it.
 *
 * A column rather than Telegram's `CloudStorage`: a setting has to survive a
 * device change, and it is a fact about the coach rather than about the client
 * they happen to be launching from.
 */

/** The one key this slice writes: the manually hidden Main Mini App hint. */
export interface MemberSettings {
  readonly mainMiniAppHintDismissed?: boolean
  /** Keys written by a newer deploy, carried through untouched. */
  readonly [key: string]: unknown
}

export const DefaultMemberSettings: MemberSettings = {}

/**
 * Read the column tolerantly.
 *
 * Nothing here is worth failing a launch over — the blob predates most of its
 * keys and will outlive them — so an unreadable value is read as "nothing has
 * been chosen", and a key with the wrong type is dropped rather than trusted.
 * Unknown keys survive, so a client on an older deploy writing its own setting
 * cannot erase one a newer deploy wrote.
 */
export const readMemberSettings = (value: unknown): MemberSettings => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DefaultMemberSettings
  }
  const record = value as Record<string, unknown>
  const dismissed = record.mainMiniAppHintDismissed
  if (dismissed !== undefined && typeof dismissed !== "boolean") {
    const { mainMiniAppHintDismissed: _dropped, ...rest } = record
    return rest
  }
  return record as MemberSettings
}

/**
 * Whether the browser's own zone is one this runtime can resolve.
 *
 * The value arrives from `Intl.DateTimeFormat().resolvedOptions().timeZone` in
 * a client we do not control, and it is written silently with no UI — so the
 * only thing standing between a broken client and an unrenderable confirmation
 * message is this check. A fixed offset (`+03:00`) is refused on purpose: it
 * cannot answer what the offset will be on the session's own date, which is the
 * one question `member.timezone` exists to answer.
 */
export const isSupportedTimeZone = (zone: string): boolean => {
  if (zone.length === 0 || !zone.includes("/")) return zone === "UTC"
  try {
    return Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone.length > 0
  } catch {
    return false
  }
}
