// PROTOTYPE — assumptions surfaced while building the flow (wayfinder #28).
// The ticket's exit criterion: fact-check these and fold corrections into
// docs/spec/client-onboarding-auth.md.
import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"

export const Route = createFileRoute("/facts")({ component: Facts })

type Fact = {
  claim: string
  status: "verified" | "to-verify" | "design-question"
  note: string
}

const facts: Array<Fact> = [
  {
    claim:
      "Google OAuth c базовыми scopes (openid profile email) отдаёт name, picture, email и sub за один consent-экран",
    status: "to-verify",
    note: "Также: можно ли скачать picture-URL с сервера для сохранения в R2 (срок жизни googleusercontent-ссылок)",
  },
  {
    claim:
      "Редирект-флоу Google OAuth теряет несохранённое состояние формы (имя/аватар, введённые до клика)",
    status: "design-question",
    note: "Popup-режим GIS против redirect + черновик в sessionStorage; на мобильных попапы ограничены. Прототип кладёт Google-кнопку ПЕРЕД ручными полями, чтобы конфликт почти не возникал",
  },
  {
    claim:
      "Брендинг-гайдлайны Google обязательны для кнопки (текст «Continue with Google», логотип, отступы) при верификации OAuth-приложения",
    status: "to-verify",
    note: "Иначе ревью OAuth consent screen может не пройти",
  },
  {
    claim:
      "Аватар, загруженный до нажатия «Согласен», не должен попадать в постоянное хранилище (атомарность акцепта)",
    status: "design-question",
    note: "Вариант: держать файл в памяти браузера и грузить вместе с commit-запросом (один POST). Прототип так и делает (objectURL)",
  },
  {
    claim:
      "React Email рендерится в Worker'e, отправка через Cloudflare Email Service с mail.praximo.io",
    status: "verified",
    note: "Исследование #26 (docs/research/email-provider.md)",
  },
  {
    claim:
      "Кнопка «Скопировать текст» под forward-сообщением в боте — нативная: InlineKeyboardButton.copy_text (CopyTextButton), лимит 1–256 символов",
    status: "verified",
    note: "Bot API 8.0; проверено по core.telegram.org/bots/api. Наш forward-текст — 196 символов, влезает; при длинных именах/URL держать ≤256 (иначе кнопка не создастся)",
  },
  {
    claim:
      "navigator.share доступен только в iOS-вебвью Telegram; гейт по Telegram.WebApp.platform === 'ios'",
    status: "verified",
    note: "Fact-check в #27",
  },
  {
    claim:
      "history.replaceState + sessionStorage достаточно для вычистки join-токена из URL (переживает reload в той же вкладке)",
    status: "verified",
    note: "Спека web-room (#25); прототип реализует это по-настоящему на pre-join",
  },
  {
    claim:
      "Подстановка имени коуча в шаблоны uk/ru требует падежей («сесія з Анною», не «з Анна Коваленко»)",
    status: "design-question",
    note: "Всплыло в этом прототипе: subject/тело писем склоняют имя. Варианты: перестроить фразы, чтобы имя стояло в именительном («Ваш коуч Анна Коваленко: сесія завтра»), или склонять через LLM при онбординге коуча",
  },
  {
    claim:
      "Кнопка-CTA в письме (https-ссылка) корректно открывается из Gmail/Apple Mail/Outlook без промежуточных страниц",
    status: "to-verify",
    note: "Плюс проверка спам-скоринга writing-as-assistant копирайта",
  },
]

const statusMeta: Record<Fact["status"], { label: string; cls: string }> = {
  verified: { label: "проверено", cls: "bg-green-100 text-green-800" },
  "to-verify": { label: "проверить", cls: "bg-amber-100 text-amber-800" },
  "design-question": { label: "вопрос дизайна", cls: "bg-blue-100 text-blue-800" },
}

function Facts() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 pb-24">
      <h1 className="text-xl font-semibold">Допущения для fact-check</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        Exit-критерий #28: проверить и внести поправки в
        docs/spec/client-onboarding-auth.md (как в #19).
      </p>
      <div className="flex flex-col gap-4">
        {facts.map((f) => (
          <div key={f.claim} className="rounded-2xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium">{f.claim}</p>
              <Badge className={statusMeta[f.status].cls}>
                {statusMeta[f.status].label}
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{f.note}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
