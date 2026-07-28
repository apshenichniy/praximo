const requiredLocalBindings = [
  "DATABASE_URL",
  "MANAGER_BOT_USERNAME",
  "TELEGRAM_ENV",
  "CLIENT_APP_URL",
] as const

export const canUseLocalProcessEnvironment = (
  isDevelopment: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): boolean =>
  isDevelopment &&
  requiredLocalBindings.every((name) => {
    const value = environment[name]
    return value !== undefined && value.length > 0
  })
