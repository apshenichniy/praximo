/**
 * One-shot notice handed to the workspace list across a navigation (success
 * toast per #103: no dedicated success screens). sessionStorage survives the
 * route change inside the Telegram webview and is cleared on first read.
 */
const key = "praximo.adminNotice"

export const setAdminNotice = (message: string): void => {
  sessionStorage.setItem(key, message)
}

export const takeAdminNotice = (): string | undefined => {
  const message = sessionStorage.getItem(key)
  if (message === null) return undefined
  sessionStorage.removeItem(key)
  return message
}
