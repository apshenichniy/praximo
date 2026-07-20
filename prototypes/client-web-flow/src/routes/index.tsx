// PROTOTYPE — flow map: entry point for walking wayfinder ticket #28.
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/")({ component: FlowMap })

type Step = { to: string; title: string; desc: string; badge?: string }

const clientSteps: Array<Step> = [
  {
    to: "/email/invite",
    title: "Invite email",
    desc: "React Email, от имени ассистента коуча, EN/UK/RU, кнопка ведёт на acceptance page",
  },
  {
    to: "/invite/inv_email_demo",
    title: "Acceptance page — email-инвайт",
    desc: "Язык → профиль (имя, аватар, Google) → согласие → подтверждение. Email уже известен — поля нет",
  },
  {
    to: "/invite/inv_link_demo",
    title: "Acceptance page — ручная пересылка",
    desc: "Тот же флоу, но email неизвестен: опциональное поле (self-upgrade канала manual → email)",
    badge: "вариант",
  },
  {
    to: "/email/reminder",
    title: "Reminder email",
    desc: "Напоминание с join-ссылкой за день до сессии",
  },
  {
    to: "/join/jn_c_M9rT2xKfVb81uQzL",
    title: "Pre-join",
    desc: "Инфо о сессии, проверка камеры/микрофона, notice о записи; токен вычищается из URL",
  },
  {
    to: "/room",
    title: "Room",
    desc: "Мок комнаты: два участника, индикатор записи",
  },
]

const coachSteps: Array<Step> = [
  {
    to: "/coach/bot",
    title: "Бот-чат: напоминание для manual-клиента",
    desc: "Готовое к пересылке сообщение на языке клиента + join-ссылка",
  },
  {
    to: "/coach/miniapp",
    title: "Mini App: session card",
    desc: "Копировать ссылку + Share (только iOS), reissue links; переключатель платформы",
  },
]

function FlowMap() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 pb-24">
      <div className="mb-10">
        <Badge variant="secondary" className="mb-3">
          PROTOTYPE · wayfinder #28 · throwaway
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">
          Клиент вне Telegram: invite → acceptance → email → join
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Сквозной кликабельный путь по спеке{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            docs/spec/client-onboarding-auth.md
          </code>
          . Всё на моках, ничего не сохраняется. Плавающая панель внизу листает
          шаги; вопрос тикета — «похоже ли это на привычный sign-up и
          складываются ли куски».
        </p>
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Путь клиента (Мария, клиент Анны)
      </h2>
      <div className="mb-10 flex flex-col gap-3">
        {clientSteps.map((s, i) => (
          <StepCard key={s.to} step={s} n={i + 1} />
        ))}
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Сторона коуча (Telegram)
      </h2>
      <div className="mb-10 flex flex-col gap-3">
        {coachSteps.map((s, i) => (
          <StepCard key={s.to} step={s} n={i + 1} />
        ))}
      </div>

      <Link
        to="/facts"
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Таблица допущений для fact-check →
      </Link>
    </main>
  )
}

function StepCard({ step, n }: { step: Step; n: number }) {
  return (
    <Link to={step.to} className="group">
      <Card size="sm" className="transition-shadow group-hover:shadow-lg">
        <CardHeader className="flex flex-row items-center gap-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {n}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2">
              {step.title}
              {step.badge && <Badge variant="outline">{step.badge}</Badge>}
            </CardTitle>
            <CardDescription>{step.desc}</CardDescription>
          </div>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardHeader>
      </Card>
    </Link>
  )
}
