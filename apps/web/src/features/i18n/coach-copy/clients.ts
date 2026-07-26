import type { CoachLanguage } from "@praximo/domain"

/**
 * The client screens (#56): the list the coach lands on, the client they
 * create, the client they open, and the sheet they book a session in.
 *
 * Sentences that wrap a value the app supplies are split into a lead and a tail
 * rather than templated — word order differs between these three languages, and
 * a placeholder in the middle of a string is a translation waiting to read
 * backwards. Counts are the exception: a number is the same token everywhere,
 * and splitting one from the noun it agrees with makes the plural unreachable.
 */
export interface ClientsCopy {
  readonly listTitle: string
  readonly newClient: string
  readonly empty: string
  readonly stateInvited: string
  readonly stateExpired: string
  readonly stateAccepted: string
  /** "invited " · "2 days ago" — the relative moment comes from the formatter. */
  readonly invitedPrefix: string
  readonly expiresPrefix: string
  readonly acceptedPrefix: string

  readonly newTitle: string
  readonly nameLabel: string
  readonly namePlaceholder: string
  readonly languageLabel: string
  /** "The language of the invitation you send. " · name · " picks their own when they accept." */
  readonly languageHintLead: string
  readonly languageHintTail: string
  readonly languageHintFallback: string
  readonly createAction: string
  readonly nameRequired: string

  readonly invitationEyebrow: string
  /**
   * name · " opens your bot in Telegram and accepts there. The link works for 7 days."
   *
   * The coach's own summary of what the invitation does, and **only** that
   * (#181). What the client actually receives lives in the client catalogue in
   * `@praximo/i18n`, is written to them rather than about them, and is rendered
   * in the language the coach chose for that client.
   */
  readonly invitationLeadTail: string
  readonly sendCard: string
  readonly copyInvite: string
  readonly copied: string
  readonly linkLabel: string
  readonly reissueLead: string
  /**
   * Recovery, not reset (#61). It sits on the invitation card itself once the
   * link is dead, in the ordinary tone — there is nothing live left to destroy,
   * so the danger zone's framing would be a lie about what the tap does.
   */
  readonly reissueAction: string

  readonly sessionsTitle: string
  readonly scheduleAction: string
  readonly noSessions: string
  readonly kindIntake: string
  readonly kindRegular: string

  readonly profileTitle: string
  readonly profileAccepted: string
  readonly profileChannel: string
  readonly profileLanguage: string
  readonly profileConsent: string
  readonly pendingAccepted: string
  readonly pendingChannel: string
  readonly pendingLanguage: string
  readonly pendingConsent: string
  readonly channelTelegram: string

  readonly dangerTitle: string
  readonly resetTitle: string
  readonly resetBody: string
  readonly resetAction: string
  readonly resetConfirm: string
  readonly deleteTitle: string
  readonly deleteBody: string
  readonly deleteAction: string
  readonly deleteConfirm: string
  readonly cancel: string

  readonly sheetTitle: string
  readonly kindLabel: string
  readonly dateLabel: string
  readonly changeDate: string
  readonly today: string
  readonly durationLabel: string
  readonly durationSuffix: string
  readonly timeLabel: string
  readonly morning: string
  readonly afternoon: string
  readonly evening: string
  readonly freeSuffix: string
  /** "No 60-minute slot fits on " · day · " before 22:00." */
  readonly emptyDayLead: string
  readonly emptyDayTail: string
  readonly nextDay: string
  readonly pickTime: string
  readonly scheduleSubmit: string
  /** name · " will see it as " · offset · ", your zone, in the bot's message." */
  readonly footnotePendingTail: string
  readonly footnoteReadyTail: string
  readonly overlapError: string
  readonly pastError: string
  readonly invalidError: string
}

const en: ClientsCopy = {
  listTitle: "Clients",
  newClient: "New client",
  empty: "No clients yet. The first one starts with an invitation.",
  stateInvited: "Invited",
  stateExpired: "Link expired",
  stateAccepted: "Active",
  invitedPrefix: "invited ",
  expiresPrefix: "expires ",
  acceptedPrefix: "joined ",

  newTitle: "New client",
  nameLabel: "Name",
  namePlaceholder: "How you refer to them",
  languageLabel: "Invitation language",
  languageHintLead: "The language of the invitation you send. ",
  languageHintTail: " picks their own when they accept.",
  languageHintFallback: "They pick their own when they accept.",
  createAction: "Create and invite",
  nameRequired: "A name is needed — it is how you will find them in the list.",

  invitationEyebrow: "Invitation · Telegram",
  invitationLeadTail: " opens your bot in Telegram and accepts there. The link works for 7 days.",
  sendCard: "Send a card in Telegram",
  copyInvite: "Copy invite",
  copied: "Copied",
  linkLabel: "Invitation link",
  reissueLead: "This link is no longer valid. Issue a fresh one to invite them again.",
  reissueAction: "Issue a fresh link",

  sessionsTitle: "Sessions",
  scheduleAction: "Schedule a session",
  noSessions: "Nothing scheduled yet.",
  kindIntake: "Intake",
  kindRegular: "Regular",

  profileTitle: "Profile",
  profileAccepted: "Accepted",
  profileChannel: "Channel",
  profileLanguage: "Language",
  profileConsent: "Consent",
  pendingAccepted: "Not yet",
  pendingChannel: "Not yet",
  pendingLanguage: "They pick it",
  pendingConsent: "Pending",
  channelTelegram: "Telegram",

  dangerTitle: "Danger zone",
  resetTitle: "Reset the invitation",
  resetBody:
    "Issues a fresh link and kills the one your client is holding. Use it when the link went astray.",
  resetAction: "Reset the invitation",
  resetConfirm: "Reset it",
  deleteTitle: "Delete the client",
  deleteBody:
    "Available only while nothing has been recorded — no acceptance, no sessions. It undoes the creation.",
  deleteAction: "Delete the client",
  deleteConfirm: "Delete",
  cancel: "Cancel",

  sheetTitle: "New session",
  kindLabel: "Kind",
  dateLabel: "Date",
  changeDate: "Change",
  today: "Today",
  durationLabel: "Duration",
  durationSuffix: " min",
  timeLabel: "Time",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  freeSuffix: " free",
  emptyDayLead: "No slot of this length fits on ",
  emptyDayTail: " before 22:00.",
  nextDay: "Try the next day",
  pickTime: "Pick a time",
  scheduleSubmit: "Schedule",
  footnotePendingTail: " will see it in your zone, ",
  footnoteReadyTail: " will see ",
  overlapError: "That time runs into another session. Pick another one.",
  pastError: "That time has already passed. Pick a later one.",
  invalidError: "That time cannot be booked. Pick one from the grid.",
}

const uk: ClientsCopy = {
  listTitle: "Клієнти",
  newClient: "Новий клієнт",
  empty: "Клієнтів ще немає. Перший починається із запрошення.",
  stateInvited: "Запрошено",
  stateExpired: "Посилання прострочене",
  stateAccepted: "Активний",
  invitedPrefix: "запрошено ",
  expiresPrefix: "діє до ",
  acceptedPrefix: "приєднався ",

  newTitle: "Новий клієнт",
  nameLabel: "Ім'я",
  namePlaceholder: "Як ви його називаєте",
  languageLabel: "Мова запрошення",
  languageHintLead: "Мова запрошення, яке ви надсилаєте. ",
  languageHintTail: " обере свою, коли прийме його.",
  languageHintFallback: "Свою мову клієнт обере, коли прийме запрошення.",
  createAction: "Створити і запросити",
  nameRequired: "Потрібне ім'я — саме за ним ви знайдете клієнта у списку.",

  invitationEyebrow: "Запрошення · Telegram",
  invitationLeadTail:
    " відкриє вашого бота в Telegram і прийме запрошення там. Посилання діє 7 днів.",
  sendCard: "Надіслати картку в Telegram",
  copyInvite: "Скопіювати запрошення",
  copied: "Скопійовано",
  linkLabel: "Посилання-запрошення",
  reissueLead: "Це посилання більше не діє. Випустіть нове, щоб запросити ще раз.",
  reissueAction: "Випустити нове посилання",

  sessionsTitle: "Сесії",
  scheduleAction: "Запланувати сесію",
  noSessions: "Поки нічого не заплановано.",
  kindIntake: "Перша",
  kindRegular: "Звичайна",

  profileTitle: "Профіль",
  profileAccepted: "Прийнято",
  profileChannel: "Канал",
  profileLanguage: "Мова",
  profileConsent: "Згода",
  pendingAccepted: "Ще ні",
  pendingChannel: "Ще ні",
  pendingLanguage: "Обере сам",
  pendingConsent: "Очікується",
  channelTelegram: "Telegram",

  dangerTitle: "Небезпечна зона",
  resetTitle: "Скинути запрошення",
  resetBody:
    "Випускає нове посилання і робить недійсним те, що вже у клієнта. Знадобиться, якщо посилання загубилося.",
  resetAction: "Скинути запрошення",
  resetConfirm: "Скинути",
  deleteTitle: "Видалити клієнта",
  deleteBody:
    "Доступно, лише поки нічого не записано — немає ні прийняття, ні сесій. Це скасування створення.",
  deleteAction: "Видалити клієнта",
  deleteConfirm: "Видалити",
  cancel: "Скасувати",

  sheetTitle: "Нова сесія",
  kindLabel: "Тип",
  dateLabel: "Дата",
  changeDate: "Змінити",
  today: "Сьогодні",
  durationLabel: "Тривалість",
  durationSuffix: " хв",
  timeLabel: "Час",
  morning: "Ранок",
  afternoon: "День",
  evening: "Вечір",
  freeSuffix: " вільно",
  emptyDayLead: "Сесія такої тривалості не вміщається ",
  emptyDayTail: " до 22:00.",
  nextDay: "Спробувати наступний день",
  pickTime: "Оберіть час",
  scheduleSubmit: "Запланувати",
  footnotePendingTail: " побачить час у вашій зоні, ",
  footnoteReadyTail: " побачить ",
  overlapError: "Цей час перетинається з іншою сесією. Оберіть інший.",
  pastError: "Цей час уже минув. Оберіть пізніший.",
  invalidError: "Цей час не можна забронювати. Оберіть його із сітки.",
}

const ru: ClientsCopy = {
  listTitle: "Клиенты",
  newClient: "Новый клиент",
  empty: "Клиентов пока нет. Первый начинается с приглашения.",
  stateInvited: "Приглашён",
  stateExpired: "Ссылка истекла",
  stateAccepted: "Активен",
  invitedPrefix: "приглашён ",
  expiresPrefix: "действует до ",
  acceptedPrefix: "присоединился ",

  newTitle: "Новый клиент",
  nameLabel: "Имя",
  namePlaceholder: "Как вы его называете",
  languageLabel: "Язык приглашения",
  languageHintLead: "Язык приглашения, которое вы отправляете. ",
  languageHintTail: " выберет свой, когда примет его.",
  languageHintFallback: "Свой язык клиент выберет, когда примет приглашение.",
  createAction: "Создать и пригласить",
  nameRequired: "Нужно имя — именно по нему вы найдёте клиента в списке.",

  invitationEyebrow: "Приглашение · Telegram",
  invitationLeadTail:
    " откроет вашего бота в Telegram и примет приглашение там. Ссылка действует 7 дней.",
  sendCard: "Отправить карточку в Telegram",
  copyInvite: "Скопировать приглашение",
  copied: "Скопировано",
  linkLabel: "Ссылка-приглашение",
  reissueLead: "Эта ссылка больше не действует. Выпустите новую, чтобы пригласить ещё раз.",
  reissueAction: "Выпустить новую ссылку",

  sessionsTitle: "Сессии",
  scheduleAction: "Запланировать сессию",
  noSessions: "Пока ничего не запланировано.",
  kindIntake: "Первая",
  kindRegular: "Обычная",

  profileTitle: "Профиль",
  profileAccepted: "Принято",
  profileChannel: "Канал",
  profileLanguage: "Язык",
  profileConsent: "Согласие",
  pendingAccepted: "Ещё нет",
  pendingChannel: "Ещё нет",
  pendingLanguage: "Выберет сам",
  pendingConsent: "Ожидается",
  channelTelegram: "Telegram",

  dangerTitle: "Опасная зона",
  resetTitle: "Сбросить приглашение",
  resetBody:
    "Выпускает новую ссылку и делает недействительной ту, что уже у клиента. Нужно, если ссылка потерялась.",
  resetAction: "Сбросить приглашение",
  resetConfirm: "Сбросить",
  deleteTitle: "Удалить клиента",
  deleteBody:
    "Доступно, только пока ничего не записано — нет ни принятия, ни сессий. Это отмена создания.",
  deleteAction: "Удалить клиента",
  deleteConfirm: "Удалить",
  cancel: "Отмена",

  sheetTitle: "Новая сессия",
  kindLabel: "Тип",
  dateLabel: "Дата",
  changeDate: "Изменить",
  today: "Сегодня",
  durationLabel: "Длительность",
  durationSuffix: " мин",
  timeLabel: "Время",
  morning: "Утро",
  afternoon: "День",
  evening: "Вечер",
  freeSuffix: " свободно",
  emptyDayLead: "Сессия такой длительности не помещается ",
  emptyDayTail: " до 22:00.",
  nextDay: "Попробовать следующий день",
  pickTime: "Выберите время",
  scheduleSubmit: "Запланировать",
  footnotePendingTail: " увидит время в вашей зоне, ",
  footnoteReadyTail: " увидит ",
  overlapError: "Это время пересекается с другой сессией. Выберите другое.",
  pastError: "Это время уже прошло. Выберите более позднее.",
  invalidError: "Это время нельзя забронировать. Выберите его из сетки.",
}

export const clients: Record<CoachLanguage, ClientsCopy> = { en, uk, ru }
