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
  /**
   * What became of a session, said only when something did (#62).
   *
   * The row is absent while a session is `scheduled`, by the same rule the
   * invitation row follows: a line present on every session is a line the eye
   * learns to skip, and this one exists for the session that is not ordinary.
   */
  readonly detailState: string
  readonly stateCompleted: string
  /**
   * The three cancellations, as sentences rather than as an enum.
   *
   * Only the first has a writer before #42; the other two are the reconciler's
   * (ADR 0005), and they are written here rather than with it because they are
   * the same row saying the same kind of thing, and a coach meeting an automatic
   * cancellation should read *what happened* — never an error they caused, and
   * never `no_show`.
   */
  readonly stateCancelledByCoach: string
  readonly stateCancelledNoShow: string
  readonly stateCancelledRoom: string
  readonly notFound: string

  /** The two lifecycle actions, in a card of their own under the facts (#62). */
  readonly rescheduleAction: string
  readonly cancelAction: string
  readonly cancelTitle: string
  readonly cancelBody: string
  readonly cancelConfirm: string
  /** The slot the coach picked was taken between opening the screen and pressing. */
  readonly rescheduleOverlap: string

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
  detailState: "Status",
  stateCompleted: "Completed",
  stateCancelledByCoach: "Cancelled by you",
  stateCancelledNoShow: "Cancelled: the client did not come",
  stateCancelledRoom: "Cancelled: the room was unavailable",
  rescheduleAction: "Reschedule",
  cancelAction: "Cancel the session",
  cancelTitle: "Cancel this session?",
  cancelBody:
    "It leaves your calendar and cannot be brought back. Your client is not told — that is still yours to do.",
  cancelConfirm: "Cancel the session",
  rescheduleOverlap: "That time is taken now. Pick another.",
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
  detailState: "Стан",
  stateCompleted: "Проведена",
  stateCancelledByCoach: "Скасована вами",
  stateCancelledNoShow: "Скасована: клієнт не прийшов",
  stateCancelledRoom: "Скасована: кімната була недоступна",
  rescheduleAction: "Перенести",
  cancelAction: "Скасувати сесію",
  cancelTitle: "Скасувати цю сесію?",
  cancelBody:
    "Вона зникне з календаря, і повернути її не можна. Клієнту нічого не надійде — сказати йому досі вам.",
  cancelConfirm: "Скасувати сесію",
  rescheduleOverlap: "Цей час уже зайнятий. Оберіть інший.",
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
  detailState: "Состояние",
  stateCompleted: "Проведена",
  stateCancelledByCoach: "Отменена вами",
  stateCancelledNoShow: "Отменена: клиент не пришёл",
  stateCancelledRoom: "Отменена: комната была недоступна",
  rescheduleAction: "Перенести",
  cancelAction: "Отменить сессию",
  cancelTitle: "Отменить эту сессию?",
  cancelBody:
    "Она исчезнет из календаря, и вернуть её нельзя. Клиенту ничего не придёт — сказать ему по-прежнему вам.",
  cancelConfirm: "Отменить сессию",
  rescheduleOverlap: "Это время уже занято. Выберите другое.",
  notFound: "Этой сессии больше нет.",

  pickTitle: "С кем сессия?",
  pickLead: "Выберите клиента, а затем день и время.",
  pickEmpty: "Клиентов пока нет. Первый начинается с приглашения.",
}

export const sessions: Record<CoachLanguage, SessionsCopy> = { en, uk, ru }
