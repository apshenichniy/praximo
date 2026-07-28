import type { CoachLanguage } from "@praximo/domain"

/**
 * The sessions list, the session screen, and the client picker that precedes a
 * booking made from Today (#61).
 *
 * Kind and duration are deliberately **not** here: they are already in the
 * clients catalogue, said by the client route and by the scheduling sheet, and a
 * second «Intake» would be a second thing to keep in step for no reader's
 * benefit.
 */
export interface SessionsCopy {
  readonly listTitle: string
  readonly empty: string
  /** Relative day headings, where they help. Every other day is its own date. */
  readonly today: string
  readonly tomorrow: string
  /** The row's own warning — short, because the session screen says the rest. */
  readonly rowUnaccepted: string

  readonly detailTitle: string
  readonly detailClient: string
  readonly detailKind: string
  readonly detailInvitation: string
  readonly detailUnaccepted: string
  readonly notFound: string

  readonly pickTitle: string
  readonly pickLead: string
  readonly pickEmpty: string
}

const en: SessionsCopy = {
  listTitle: "Sessions",
  empty: "Nothing scheduled yet.",
  today: "Today",
  tomorrow: "Tomorrow",
  rowUnaccepted: "Invitation not accepted",

  detailTitle: "Session",
  detailClient: "Client",
  detailKind: "Kind",
  detailInvitation: "Invitation",
  detailUnaccepted: "Not accepted yet",
  notFound: "This session is no longer here.",

  pickTitle: "Who is it with?",
  pickLead: "Pick a client, then choose the day and the time.",
  pickEmpty: "No clients yet. The first one starts with an invitation.",
}

const uk: SessionsCopy = {
  listTitle: "Сесії",
  empty: "Поки нічого не заплановано.",
  today: "Сьогодні",
  tomorrow: "Завтра",
  rowUnaccepted: "Запрошення не прийнято",

  detailTitle: "Сесія",
  detailClient: "Клієнт",
  detailKind: "Тип",
  detailInvitation: "Запрошення",
  detailUnaccepted: "Ще не прийнято",
  notFound: "Цієї сесії більше немає.",

  pickTitle: "З ким сесія?",
  pickLead: "Оберіть клієнта, а тоді день і час.",
  pickEmpty: "Клієнтів ще немає. Перший починається із запрошення.",
}

const ru: SessionsCopy = {
  listTitle: "Сессии",
  empty: "Пока ничего не запланировано.",
  today: "Сегодня",
  tomorrow: "Завтра",
  rowUnaccepted: "Приглашение не принято",

  detailTitle: "Сессия",
  detailClient: "Клиент",
  detailKind: "Тип",
  detailInvitation: "Приглашение",
  detailUnaccepted: "Ещё не принято",
  notFound: "Этой сессии больше нет.",

  pickTitle: "С кем сессия?",
  pickLead: "Выберите клиента, а затем день и время.",
  pickEmpty: "Клиентов пока нет. Первый начинается с приглашения.",
}

export const sessions: Record<CoachLanguage, SessionsCopy> = { en, uk, ru }
