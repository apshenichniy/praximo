import { launchCredentialHeaders } from "@praximo/mini-app"
import { useEffect, useState } from "react"

import { resolveLaunchCredential } from "@/launch-credential.ts"

/**
 * A client's photo, as something an `<img>` can point at (#231).
 *
 * **Why this is a `fetch` and not a `src`.** The avatar route authorises the way
 * every read in this Worker does — by the `x-praximo-init-data` header the launch
 * carries — and an `<img>` cannot send a header. So the bytes are fetched with the
 * credential the app already attaches to every server call, and the browser is handed
 * an object URL for them. The two alternatives were both bigger decisions than a
 * disc: a signed URL is the capability-URL question the entity keying exists to
 * avoid, and an ambient credential cookie is ADR 0006's to make.
 *
 * The HTTP cache still does its work. The request is an ordinary `GET` at an
 * entity-keyed URL with a strong `ETag` and `private` freshness, so a reload
 * revalidates and gets a `304` the route answers without touching R2.
 */

/**
 * One object URL per client, for the page's lifetime.
 *
 * The roster and a client's own route show the same faces, and a coach walks between
 * them constantly — without this, every visit would re-fetch and mint a new URL. The
 * URLs are deliberately **not** revoked: they are a few tens of kilobytes each and
 * bounded by the clients whose photos the coach has actually looked at, where revoking
 * on unmount would mean re-downloading a face to go back one screen.
 *
 * Keyed by client id, and a promise rather than a value so two rows mounting in the
 * same tick share one request. A request that came back with nothing is **dropped
 * from the map**: a 503 from a bucket having a bad minute must not mean initials
 * until the coach reloads the whole app.
 */
const photos = new Map<string, Promise<string | undefined>>()

const fetchPhoto = async (clientId: string): Promise<string | undefined> => {
  try {
    const credential = await resolveLaunchCredential()
    const response = await fetch(`/clients/${encodeURIComponent(clientId)}/avatar`, {
      headers: launchCredentialHeaders(credential),
    })
    // Every refusal means the same thing to a disc — 404 for no photo, 401 for a
    // credential this route would not take, 503 for a bucket that did not answer.
    // Initials are the fallback for all of them, and they are the design anyway.
    if (!response.ok) return undefined
    return URL.createObjectURL(await response.blob())
  } catch {
    return undefined
  }
}

/**
 * The photo's URL once it has arrived, or `undefined` — which is every other
 * moment, including the first paint.
 *
 * That is deliberate rather than a loading state: the fallback renders immediately,
 * so a coach sees initials and then a face, never an empty disc. `hasAvatar` is what
 * keeps the request from being made at all for the many clients who have no photo.
 */
export const useClientPhoto = (clientId: string, hasAvatar: boolean): string | undefined => {
  const [url, setUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!hasAvatar) {
      setUrl(undefined)
      return
    }
    let live = true
    const pending =
      photos.get(clientId) ??
      fetchPhoto(clientId).then((resolved) => {
        // Only a photo is worth remembering. Forgetting the failures is what lets a
        // return to this screen try again.
        if (resolved === undefined) photos.delete(clientId)
        return resolved
      })
    photos.set(clientId, pending)
    void pending.then((resolved) => {
      if (live) setUrl(resolved)
    })
    return () => {
      live = false
    }
  }, [clientId, hasAvatar])

  return url
}
