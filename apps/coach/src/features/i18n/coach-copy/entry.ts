import type { CoachLanguage } from "@praximo/domain"

/**
 * Screens shown *before* a member is resolved. Nothing has been read from the
 * database at that point, so these render in the language the sender's own
 * Telegram client reports — the same fallback the bot uses for updates that
 * never reach a workspace row.
 */
export interface EntryCopy {
  readonly notFromBotTitle: string
  readonly notFromBotBody: string
  readonly unavailableTitle: string
  readonly unavailableBody: string
}

const en: EntryCopy = {
  notFromBotTitle: "Open Praximo from your bot",
  notFromBotBody:
    "This app opens from the Praximo bot set up for your practice. Find it in Telegram and tap Open.",
  unavailableTitle: "We couldn't open Praximo",
  unavailableBody: "Something on our side is not answering. Try again in a moment.",
}

const uk: EntryCopy = {
  notFromBotTitle: "Відкрийте Praximo у своєму боті",
  notFromBotBody:
    "Цей застосунок відкривається з бота Praximo, налаштованого для вашої практики. Знайдіть його в Telegram і натисніть «Відкрити».",
  unavailableTitle: "Не вдається відкрити Praximo",
  unavailableBody: "Щось на нашому боці не відповідає. Спробуйте за хвилину.",
}

const ru: EntryCopy = {
  notFromBotTitle: "Откройте Praximo в своём боте",
  notFromBotBody:
    "Это приложение открывается из бота Praximo, настроенного для вашей практики. Найдите его в Telegram и нажмите «Открыть».",
  unavailableTitle: "Не получается открыть Praximo",
  unavailableBody: "Что-то на нашей стороне не отвечает. Попробуйте через минуту.",
}

export const entry: Record<CoachLanguage, EntryCopy> = { en, uk, ru }
