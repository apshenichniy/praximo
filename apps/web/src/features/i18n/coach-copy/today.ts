import type { CoachLanguage } from "@praximo/domain"
import { plural } from "@praximo/i18n"

/**
 * Today — the coach's entry screen (#61).
 *
 * Two shapes of string live here that the rest of the catalogue does not have.
 *
 * **Counts are functions.** A number is the same token in all three languages,
 * so it goes inside the sentence rather than beside it — and the sentence it
 * goes inside has three forms in `uk` and `ru`. A field holding the forms as an
 * object would be walked key-by-key by `fillGaps` against the English one, which
 * has two, and `few` / `many` would be dropped on the way. A function leaf is
 * present by definition and passes through untouched.
 *
 * **There is no greeting word.** The heading is the coach's own name, because
 * «Вітаю, Олена» wants the vocative in Ukrainian and no column here holds a
 * declined form — and a greeting that misinflects somebody's name every single
 * launch is worse than no greeting at all. The factual line under it does the
 * work a greeting would have done.
 */
export interface TodayCopy {
  /** «Two sessions today» / «No sessions today» — the zero is spoken. */
  readonly sessionsToday: (count: number) => string

  readonly attentionTitle: string
  readonly attentionExpired: string
  /** "Invitation expires " · "in 2 days" — the relative moment is the formatter's. */
  readonly attentionExpiringPrefix: string

  /** name · " cannot get a link yet" — the consequence, never the word alone. */
  readonly unacceptedLead: string
  readonly unacceptedTail: string
  readonly resend: string
  readonly resendAccepted: string

  readonly checklistTitle: string
  readonly checklistBot: string
  readonly checklistBotBody: string
  readonly checklistClient: string
  readonly checklistClientBody: string
  readonly checklistSession: string
  readonly checklistSessionBody: string

  readonly allSessions: string
  readonly clients: string
  readonly newSession: string
  readonly newClient: string
}

const en: TodayCopy = {
  sessionsToday: (count) =>
    count === 0
      ? "No sessions today"
      : plural("en", count, { one: "{count} session today", other: "{count} sessions today" }),

  attentionTitle: "Needs attention",
  attentionExpired: "Invitation expired",
  attentionExpiringPrefix: "Invitation expires ",

  unacceptedLead: "Invitation not accepted — ",
  unacceptedTail: " cannot get a link yet",
  resend: "Send the invitation again",
  resendAccepted: "They have accepted already.",

  checklistTitle: "Three steps to your first session",
  checklistBot: "Your bot is live",
  checklistBotBody: "Done — this app is running on it.",
  checklistClient: "Add your first client",
  checklistClientBody: "A name is enough. You send an invitation, they accept it in your bot.",
  checklistSession: "Schedule the intake",
  checklistSessionBody:
    "You can book it before they accept — they just cannot join until they have.",

  allSessions: "All sessions",
  clients: "Clients",
  newSession: "New session",
  newClient: "New client",
}

const uk: TodayCopy = {
  sessionsToday: (count) =>
    count === 0
      ? "Сьогодні сесій немає"
      : plural("uk", count, {
          one: "Сьогодні {count} сесія",
          few: "Сьогодні {count} сесії",
          many: "Сьогодні {count} сесій",
          other: "Сьогодні {count} сесії",
        }),

  attentionTitle: "Потребує уваги",
  attentionExpired: "Запрошення прострочене",
  attentionExpiringPrefix: "Запрошення діє ще ",

  unacceptedLead: "Запрошення не прийнято — ",
  unacceptedTail: " поки не отримає посилання",
  resend: "Надіслати запрошення ще раз",
  resendAccepted: "Запрошення вже прийнято.",

  checklistTitle: "Три кроки до першої сесії",
  checklistBot: "Ваш бот працює",
  checklistBotBody: "Готово — цей застосунок відкрито саме в ньому.",
  checklistClient: "Додайте першого клієнта",
  checklistClientBody: "Досить імені. Ви надсилаєте запрошення, клієнт приймає його у вашому боті.",
  checklistSession: "Заплануйте першу сесію",
  checklistSessionBody:
    "Можна запланувати ще до прийняття запрошення — приєднатися вийде лише після нього.",

  allSessions: "Усі сесії",
  clients: "Клієнти",
  newSession: "Нова сесія",
  newClient: "Новий клієнт",
}

const ru: TodayCopy = {
  sessionsToday: (count) =>
    count === 0
      ? "Сегодня сессий нет"
      : plural("ru", count, {
          one: "Сегодня {count} сессия",
          few: "Сегодня {count} сессии",
          many: "Сегодня {count} сессий",
          other: "Сегодня {count} сессии",
        }),

  attentionTitle: "Требует внимания",
  attentionExpired: "Приглашение истекло",
  attentionExpiringPrefix: "Приглашение действует ещё ",

  unacceptedLead: "Приглашение не принято — ",
  unacceptedTail: " пока не получит ссылку",
  resend: "Отправить приглашение ещё раз",
  resendAccepted: "Приглашение уже принято.",

  checklistTitle: "Три шага до первой сессии",
  checklistBot: "Ваш бот работает",
  checklistBotBody: "Готово — это приложение открыто именно в нём.",
  checklistClient: "Добавьте первого клиента",
  checklistClientBody:
    "Достаточно имени. Вы отправляете приглашение, клиент принимает его в вашем боте.",
  checklistSession: "Запланируйте первую сессию",
  checklistSessionBody:
    "Можно запланировать ещё до принятия приглашения — присоединиться выйдет только после него.",

  allSessions: "Все сессии",
  clients: "Клиенты",
  newSession: "Новая сессия",
  newClient: "Новый клиент",
}

export const today: Record<CoachLanguage, TodayCopy> = { en, uk, ru }
