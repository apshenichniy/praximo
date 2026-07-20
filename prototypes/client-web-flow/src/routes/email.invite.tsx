// PROTOTYPE — invite-email preview (wayfinder #28).
import { createFileRoute } from "@tanstack/react-router"
import { EmailPreview } from "@/components/email-preview"
import { InviteEmail } from "@/emails/invite-email"
import { dict, type Locale } from "@/lib/i18n"
import { client, coach } from "@/lib/mock"

export const Route = createFileRoute("/email/invite")({
  validateSearch: (s): { lang: Locale } => ({
    lang: s.lang === "en" || s.lang === "ru" ? s.lang : "uk",
  }),
  component: Page,
})

function Page() {
  const { lang } = Route.useSearch()
  return (
    <main className="min-h-svh bg-zinc-100 px-4 py-10 pb-24">
      <EmailPreview
        email={<InviteEmail locale={lang} inviteToken="inv_email_demo" />}
        locale={lang}
        from={`${coach.name} · Praximo <no-reply@mail.praximo.io>`}
        to={`${client.name} <${client.email}>`}
        subject={dict[lang].inviteSubject(coach.name)}
      />
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-zinc-400">
        Отправляется сервисом при создании инвайта; язык выбирает коуч (клиент
        сможет сменить его на странице). Кнопка ведёт на acceptance page.
      </p>
    </main>
  )
}
