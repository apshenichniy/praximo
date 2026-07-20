// PROTOTYPE — throwaway mock data for wayfinder ticket #28. No persistence.

export const coach = {
  name: "Анна Коваленко",
  shortName: "Анна",
  botUsername: "anna_coach_assistant_bot",
  avatarUrl: null as string | null,
  initials: "АК",
  language: "ru" as const,
}

export const client = {
  name: "Марія Петренко",
  firstName: "Марія",
  email: "maria.petrenko@gmail.com",
  initials: "МП",
}

export const session = {
  kind: "intake" as const,
  // fixed demo instant: Thu 2026-07-23 10:00 Europe/Kyiv
  startsAtISO: "2026-07-23T10:00:00+03:00",
  durationMin: 60,
}

// Two demo invites: one delivered to an email address, one as a bare link
// (manual forwarding). Same token model, different acceptance-page behavior.
export const invites = {
  inv_email_demo: { delivery: "email" as const, language: "uk" as const },
  inv_link_demo: { delivery: "link" as const, language: "ru" as const },
}
export type InviteToken = keyof typeof invites

export const joinTokens = {
  client: "jn_c_M9rT2xKfVb81uQzL",
  coach: "jn_k_Zq4W7pNcRd35yHsA",
}

export const urls = {
  invite: (token: string) => `https://app.praximo.io/invite/${token}`,
  join: (token: string) => `https://app.praximo.io/join/${token}`,
}
