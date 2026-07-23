const requiredLocalBindings = [
  "DATABASE_URL",
  "MANAGER_BOT_TOKEN",
  "MANAGER_BOT_USERNAME",
  "COACH_ONBOARDING_TOKEN_SECRET",
  "DEFAULT_COACH_BOT_AVATAR_R2_KEY",
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
