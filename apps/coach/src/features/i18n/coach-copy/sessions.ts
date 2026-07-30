import type { CoachLanguage } from "@praximo/domain"
import { plural } from "@praximo/i18n"

/**
 * The sessions list and its two views (#61, #232), the session screen, and the
 * client picker that precedes a booking made from Today.
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

  /**
   * The two views of the list (#232), as one word each.
   *
   * A segment, not a heading: it changes what the page below is showing and
   * writes nothing, so it stays short enough that both fit side by side on the
   * narrowest phone in all three languages.
   */
  readonly viewUpcoming: string
  readonly viewPast: string
  /** What the segment is choosing between, for a reader who cannot see it. */
  readonly viewLabel: string
  /**
   * Nothing behind yet — and a sentence rather than a blank, because the coach
   * chose to open this view and an empty panel reads as a screen that failed.
   */
  readonly pastEmpty: string
  /**
   * The bound, said out loud when the read hit it (#232).
   *
   * A practice has no ceiling on what it has already done, so Past is a window
   * — and a window the screen does not admit to is a list that quietly stops
   * being true. Absent entirely while everything fits, which is every coach for
   * a long time.
   */
  readonly pastBounded: (count: number) => string

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

  viewUpcoming: "Upcoming",
  viewPast: "Past",
  viewLabel: "Which sessions",
  pastEmpty: "Nothing behind you yet.",
  pastBounded: (count) =>
    plural("en", count, {
      one: "Showing the most recent session.",
      other: "Showing the {count} most recent sessions.",
    }),

  detailTitle: "Session",
  detailClient: "Client",
  detailKind: "Kind",
  detailInvitation: "Invitation",
  detailUnaccepted: "Not accepted yet",
  detailState: "Status",
  stateCompleted: "Completed",
  stateCancelledByCoach: "Cancelled by you",
  stateCancelledNoShow: "Cancelled: nobody came",
  stateCancelledRoom: "Cancelled: the session could not start",
  rescheduleAction: "Reschedule",
  cancelAction: "Cancel the session",
  cancelTitle: "Cancel this session?",
  cancelBody:
    "It leaves your calendar and cannot be brought back. Nothing is sent to your client — telling them is still yours to do.",
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

  viewUpcoming: "Попереду",
  viewPast: "Минулі",
  viewLabel: "Які сесії",
  pastEmpty: "Позаду ще нічого немає.",
  pastBounded: (count) =>
    plural("uk", count, {
      one: "Показано {count} останню сесію.",
      few: "Показано {count} останні сесії.",
      many: "Показано {count} останніх сесій.",
      other: "Показано {count} останньої сесії.",
    }),

  detailTitle: "Сесія",
  detailClient: "Клієнт",
  detailKind: "Тип",
  detailInvitation: "Запрошення",
  detailUnaccepted: "Ще не прийнято",
  detailState: "Стан",
  stateCompleted: "Проведена",
  stateCancelledByCoach: "Скасована вами",
  stateCancelledNoShow: "Скасована: ніхто не прийшов",
  stateCancelledRoom: "Скасована: не вдалося почати зустріч",
  rescheduleAction: "Перенести",
  cancelAction: "Скасувати сесію",
  cancelTitle: "Скасувати цю сесію?",
  cancelBody:
    "Вона зникне з календаря, і повернути її не можна. Клієнту нічого не надійде — попередити доведеться вам.",
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

  viewUpcoming: "Впереди",
  viewPast: "Прошедшие",
  viewLabel: "Какие сессии",
  pastEmpty: "Позади пока ничего нет.",
  pastBounded: (count) =>
    plural("ru", count, {
      one: "Показана {count} последняя сессия.",
      few: "Показаны {count} последние сессии.",
      many: "Показаны {count} последних сессий.",
      other: "Показано {count} последней сессии.",
    }),

  detailTitle: "Сессия",
  detailClient: "Клиент",
  detailKind: "Тип",
  detailInvitation: "Приглашение",
  detailUnaccepted: "Ещё не принято",
  detailState: "Состояние",
  stateCompleted: "Проведена",
  stateCancelledByCoach: "Отменена вами",
  stateCancelledNoShow: "Отменена: никто не пришёл",
  stateCancelledRoom: "Отменена: не удалось начать встречу",
  rescheduleAction: "Перенести",
  cancelAction: "Отменить сессию",
  cancelTitle: "Отменить эту сессию?",
  cancelBody:
    "Она исчезнет из календаря, и вернуть её нельзя. Клиенту ничего не придёт — предупредить придётся вам.",
  cancelConfirm: "Отменить сессию",
  rescheduleOverlap: "Это время уже занято. Выберите другое.",
  notFound: "Этой сессии больше нет.",

  pickTitle: "С кем сессия?",
  pickLead: "Выберите клиента, а затем день и время.",
  pickEmpty: "Клиентов пока нет. Первый начинается с приглашения.",
}

export const sessions: Record<CoachLanguage, SessionsCopy> = { en, uk, ru }
