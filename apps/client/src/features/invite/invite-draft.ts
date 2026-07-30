/**
 * What the client typed, kept across a full-page Google redirect (#59).
 *
 * **Only the redirect fallback needs this.** The popup leaves the page standing,
 * so its state survives by doing nothing; the fallback navigates away, and a
 * client who typed their name before pressing the button would come back to an
 * empty field. An import must never cost somebody what they wrote — that is the
 * same rule that puts the button *above* the fields.
 *
 * `sessionStorage` rather than `localStorage`: this belongs to one tab and one
 * sitting, and a half-filled form for an invitation somebody abandoned last week
 * is not something to keep on their machine.
 *
 * Keyed by token, so two invitations open in two tabs cannot read each other's.
 * Nothing here is a record of anything — it is the same two fields the client is
 * looking at, on their own device, until they commit or close the tab.
 */

export interface InviteDraft {
  readonly name: string
  readonly email: string
}

const keyFor = (token: string): string => `praximo.invite-draft.${token}`

/**
 * Every operation is wrapped, and not out of caution.
 *
 * Safari in private browsing throws on `sessionStorage` access rather than
 * returning null, and a browser with storage disabled throws on write. This is a
 * convenience on top of a form that works without it, so a browser that will not
 * store must lose the draft rather than the acceptance.
 */
const attempt = <A>(operation: () => A): A | undefined => {
  try {
    return operation()
  } catch {
    return undefined
  }
}

export const writeDraft = (
  storage: Storage | undefined,
  token: string,
  draft: InviteDraft,
): void => {
  if (storage === undefined) return
  attempt(() => storage.setItem(keyFor(token), JSON.stringify(draft)))
}

export const readDraft = (storage: Storage | undefined, token: string): InviteDraft | undefined => {
  if (storage === undefined) return undefined
  const raw = attempt(() => storage.getItem(keyFor(token)))
  if (raw === null || raw === undefined) return undefined
  const parsed = attempt((): unknown => JSON.parse(raw))
  if (typeof parsed !== "object" || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const name = typeof record.name === "string" ? record.name : ""
  const email = typeof record.email === "string" ? record.email : ""
  // A draft of two empty strings is not a draft; restoring one would only mean
  // overwriting a pre-filled address with nothing.
  return name.length === 0 && email.length === 0 ? undefined : { name, email }
}

export const clearDraft = (storage: Storage | undefined, token: string): void => {
  if (storage === undefined) return
  attempt(() => storage.removeItem(keyFor(token)))
}

/** The browser's own, when there is one — `undefined` during server rendering. */
export const sessionDraftStorage = (): Storage | undefined =>
  typeof window === "undefined" ? undefined : attempt(() => window.sessionStorage)
