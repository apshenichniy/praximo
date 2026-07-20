// PROTOTYPE — coach's bot chat (wayfinder #28): the manual-client reminder as a
// ready-to-forward message. Telegram-style mock, coach UI language = ru.
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Check, Copy, Forward } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { client, coach, joinTokens, urls } from "@/lib/mock"

export const Route = createFileRoute("/coach/bot")({ component: BotChat })

// the forwardable message itself is in the CLIENT's language (uk)
const forwardText = `Вітаю, Маріє! Нагадую про вашу сесію з Анною Коваленко — завтра, 23 липня о 10:00 (за Києвом).

Приєднуйтесь із браузера — застосунок не потрібен:
${urls.join(joinTokens.client)}`

function BotChat() {
  const [copied, setCopied] = useState(false)
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col bg-[#0e1621] pb-24 text-white">
      {/* Telegram chat header */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-[#17212b] px-4 py-2.5">
        <Avatar className="size-9">
          <AvatarFallback className="bg-violet-600 text-sm text-white">
            {coach.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {coach.name} · ассистент
          </div>
          <div className="text-xs text-[#708499]">@{coach.botUsername}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-3 py-4">
        <div className="self-center rounded-full bg-black/20 px-3 py-1 text-xs text-[#708499]">
          22 июля
        </div>

        {/* service message to the coach, in the coach's language */}
        <Bubble>
          <p className="text-sm leading-relaxed">
            ⏰ Завтра в 10:00 — вводная сессия с{" "}
            <span className="font-semibold">{client.name}</span>.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#8fa5b8]">
            У Марии нет Telegram и email — перешлите ей сообщение ниже в любой
            мессенджер. Оно уже на её языке, ссылка внутри.
          </p>
        </Bubble>

        {/* the ready-to-forward message */}
        <Bubble>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#5eb5f7]">
            <Forward className="size-3.5" /> Переслать Марии
          </div>
          <div className="rounded-lg border-l-2 border-[#5eb5f7] bg-white/5 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
            {forwardText}
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(forwardText).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2b5278] py-2 text-sm font-medium hover:bg-[#36648f]"
          >
            {copied ? (
              <>
                <Check className="size-4" /> Скопировано
              </>
            ) : (
              <>
                <Copy className="size-4" /> Скопировать текст
              </>
            )}
          </button>
          <p className="mt-1.5 text-[11px] text-[#708499]">
            нативная кнопка Bot API: InlineKeyboardButton.copy_text (≤256
            символов; это сообщение — 196)
          </p>
        </Bubble>

        {/* the coach's own join reminder */}
        <Bubble>
          <p className="text-sm leading-relaxed">
            Ваша ссылка для входа в комнату:
          </p>
          <button
            type="button"
            className="mt-2 flex w-full items-center justify-center rounded-lg bg-[#2b5278] py-2 text-sm font-medium hover:bg-[#36648f]"
          >
            Войти в сессию
          </button>
          <p className="mt-1.5 text-[11px] text-[#708499]">
            web_app-трамплин → системный браузер (вебвью Telegram не
            поддерживается для звонка)
          </p>
        </Bubble>
      </div>

      <p className="px-4 pb-2 text-center text-xs text-[#4b5c6b]">
        мок Telegram-чата — напоминание manual-клиента маршрутизируется коучу
      </p>
    </main>
  )
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-[#182533] px-3.5 py-2.5 shadow">
      {children}
    </div>
  )
}
