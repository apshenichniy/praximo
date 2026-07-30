/**
 * The two words the page and the server both have to know about a Google import
 * (#59), and nothing else at all.
 *
 * **A module with no dependencies, and that is its whole reason to exist.** The
 * page needs the flag the redirect fallback comes back with and the name on the
 * popup's message; both are minted by `server/google-return.ts`, which reaches
 * `server/google-import.ts` for cookie sealing and MAC derivation. Importing a
 * constant from there would pull that seal into the browser bundle — code that
 * belongs to the one place holding the client secret, shipped to the one place
 * that must never hold it.
 *
 * So the shared vocabulary lives here, where both sides can take it and neither
 * drags the other along.
 */

/**
 * The flag the full-page fallback carries back on the URL, and what its two
 * values mean: `1` an import is waiting to be read, `0` the client came back
 * empty-handed.
 *
 * **Both, not just the first.** The popup can say "that did not finish" by
 * posting it; a full-page return has nothing but the URL, and without this the
 * one sentence acknowledging a declined consent screen would render on one arm
 * of the flow and never on the other. `0` costs no request — the page has been
 * told there is nothing to fetch.
 *
 * One character, and it says nothing about anybody — the profile is in a cookie
 * the page cannot read, so a URL sitting in somebody's history names no one.
 */
export const ImportedFlag = "g"

/**
 * What the popup posts to the page that opened it.
 *
 * A name, and beside it a boolean — the message carries no name, no address and
 * above all no attestation, so a `postMessage` that somehow reached the wrong
 * window would hand it nothing.
 */
export const ImportSignal = "praximo.google-import"
