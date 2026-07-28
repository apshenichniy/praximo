import type { CoachLanguage } from "@praximo/domain"
import { plural } from "@praximo/i18n"

/**
 * Availability (#210): the screen the coach's working hours live on, the screen
 * that sets them, and the optional step that offers them once after the terms.
 *
 * **Not «Settings».** The screen holds hours and — next slice — the calendar
 * connection, which are both about *when this coach is reachable*; a settings
 * route would invite the question the spec has already answered twice, which is
 * where the language control is (§First login: the onboarding chips are the only
 * one in MVP).
 *
 * Weekday names are absent on purpose: `Intl` declines them correctly in all
 * three languages, and fourteen hand-translated strings is fourteen chances to
 * ship «Понеділок» where «Пн» was wanted.
 */
export interface AvailabilityCopy {
  readonly title: string
  /** The group both rows sit under, and the reason they sit together. */
  readonly yourTime: string
  readonly workingHoursRow: string

  /** The summary line, assembled from parts because word order differs. */
  readonly everyDay: string
  readonly noWorkingDays: string
  /** " · 1 day set separately" — a count, so the noun travels with it. */
  readonly ownHours: (days: number) => string

  readonly calendarTitle: string
  readonly calendarNotConnected: string
  readonly calendarWhy: string
  readonly calendarConnect: string

  readonly hoursTitle: string
  /**
   * What narrowing does and — as importantly — what it does not do. The second
   * sentence is the promise the server keeps: the grid is a preference, and an
   * exception is always still bookable.
   */
  readonly hoursLede: string
  readonly windowLabel: string
  readonly from: string
  readonly until: string
  readonly daysLabel: string
  readonly perDayRow: string
  readonly perDayNone: string
  readonly perDaySome: (days: number) => string
  /**
   * The line at the foot, which restates the result of the last tap.
   *
   * It does not name the hours: they are the two largest controls on the screen
   * already, and wrapping them in a sentence would put text on both sides of a
   * value — the shape §Standing rules keeps for counts alone.
   */
  readonly noteEveryDay: string
  readonly noteSomeOff: string
  readonly noteOwnHours: (days: number) => string
  readonly noteNoDays: string

  readonly pickerStart: string
  readonly pickerEnd: string
  readonly pickerDone: string

  readonly perDayTitle: string
  readonly perDayLede: string
  readonly notWorking: string
  /** Copies the first working day's hours onto the rest — the row that makes A cheap. */
  readonly applyToAll: string

  /** The optional third step of first login. */
  readonly stepTitle: string
  readonly stepLede: string
  readonly stepContinue: string
  readonly stepSkip: string

  readonly saveFailed: string
}

const en: AvailabilityCopy = {
  title: "Availability",
  yourTime: "Your time",
  workingHoursRow: "Working hours",

  everyDay: "Every day",
  noWorkingDays: "No working days",
  ownHours: (days) =>
    plural("en", days, {
      one: " · {count} day set separately",
      other: " · {count} days set separately",
    }),

  calendarTitle: "Google Calendar",
  calendarNotConnected: "Not connected",
  calendarWhy:
    "Praximo will hide the times you are already busy from the scheduling sheet, and put your sessions in a calendar of its own.",
  calendarConnect: "Connect Google Calendar",

  hoursTitle: "Working hours",
  hoursLede:
    "The scheduling sheet will stop offering starts outside these hours. You can still book one by hand.",
  windowLabel: "The hours you work",
  from: "From",
  until: "Until",
  daysLabel: "The days you work",
  perDayRow: "Set hours per day",
  perDayNone: "For a week that is not the same every day",
  perDaySome: (days) =>
    plural("en", days, {
      one: "{count} day has its own hours",
      other: "{count} days have their own hours",
    }),
  noteEveryDay: "Every day is worked. Switch off the days you do not.",
  noteSomeOff:
    "A session already booked on a day you switched off keeps its place. Narrowing the hours says nothing about the past.",
  noteOwnHours: (days) =>
    plural("en", days, {
      one: "{count} day keeps its own hours. The window above applies to the rest.",
      other: "{count} days keep their own hours. The window above applies to the rest.",
    }),
  noteNoDays: "Every day is switched off. The sheet will offer nothing until one is back on.",

  pickerStart: "Start",
  pickerEnd: "End",
  pickerDone: "Done",

  perDayTitle: "Hours per day",
  perDayLede: "A day set here keeps its own hours, and stops following the shared window.",
  notWorking: "Not working",
  applyToAll: "Apply these hours to the other working days",

  stepTitle: "When do you work?",
  stepLede:
    "The scheduling sheet offers 08:00–22:00 every day until you say otherwise. You can change this later in Availability.",
  stepContinue: "Save",
  stepSkip: "Skip",

  saveFailed: "That did not save. Try again.",
}

const uk: AvailabilityCopy = {
  title: "Доступність",
  yourTime: "Ваш час",
  workingHoursRow: "Робочі години",

  everyDay: "Щодня",
  noWorkingDays: "Немає робочих днів",
  ownHours: (days) =>
    plural("uk", days, {
      one: " · {count} день окремо",
      few: " · {count} дні окремо",
      many: " · {count} днів окремо",
      other: " · {count} дня окремо",
    }),

  calendarTitle: "Google Календар",
  calendarNotConnected: "Не підключено",
  calendarWhy:
    "Praximo сховає з аркуша планування час, коли ви вже зайняті, і додаватиме ваші сесії до окремого календаря.",
  calendarConnect: "Підключити Google Календар",

  hoursTitle: "Робочі години",
  hoursLede:
    "Аркуш планування більше не пропонуватиме час поза цими годинами. Ви все одно зможете записати сесію вручну.",
  windowLabel: "Години, коли ви працюєте",
  from: "З",
  until: "До",
  daysLabel: "Дні, коли ви працюєте",
  perDayRow: "Задати години для кожного дня",
  perDayNone: "Для тижня, який не однаковий щодня",
  perDaySome: (days) =>
    plural("uk", days, {
      one: "{count} день має власні години",
      few: "{count} дні мають власні години",
      many: "{count} днів мають власні години",
      other: "{count} дня мають власні години",
    }),
  noteEveryDay: "Ви працюєте щодня. Вимкніть дні, коли не працюєте.",
  noteSomeOff:
    "Сесія, вже записана на вимкнений день, залишається на місці. Звуження годин нічого не каже про минуле.",
  noteOwnHours: (days) =>
    plural("uk", days, {
      one: "{count} день має власні години. Вікно вище діє для решти.",
      few: "{count} дні мають власні години. Вікно вище діє для решти.",
      many: "{count} днів мають власні години. Вікно вище діє для решти.",
      other: "{count} дня мають власні години. Вікно вище діє для решти.",
    }),
  noteNoDays: "Усі дні вимкнено. Аркуш не пропонуватиме нічого, доки ви не увімкнете хоча б один.",

  pickerStart: "Початок",
  pickerEnd: "Кінець",
  pickerDone: "Готово",

  perDayTitle: "Години по днях",
  perDayLede: "День, заданий тут, має власні години й більше не слідує спільному вікну.",
  notWorking: "Не працюю",
  applyToAll: "Застосувати ці години до інших робочих днів",

  stepTitle: "Коли ви працюєте?",
  stepLede:
    "Аркуш планування пропонує 08:00–22:00 щодня, доки ви не скажете інакше. Це можна змінити пізніше в розділі «Доступність».",
  stepContinue: "Зберегти",
  stepSkip: "Пропустити",

  saveFailed: "Не вдалося зберегти. Спробуйте ще раз.",
}

const ru: AvailabilityCopy = {
  title: "Доступность",
  yourTime: "Ваше время",
  workingHoursRow: "Рабочие часы",

  everyDay: "Ежедневно",
  noWorkingDays: "Нет рабочих дней",
  ownHours: (days) =>
    plural("ru", days, {
      one: " · {count} день отдельно",
      few: " · {count} дня отдельно",
      many: " · {count} дней отдельно",
      other: " · {count} дня отдельно",
    }),

  calendarTitle: "Google Календарь",
  calendarNotConnected: "Не подключён",
  calendarWhy:
    "Praximo скроет из листа планирования время, когда вы уже заняты, и будет добавлять ваши сессии в отдельный календарь.",
  calendarConnect: "Подключить Google Календарь",

  hoursTitle: "Рабочие часы",
  hoursLede:
    "Лист планирования перестанет предлагать время вне этих часов. Записать сессию вручную всё равно можно.",
  windowLabel: "Часы, когда вы работаете",
  from: "С",
  until: "До",
  daysLabel: "Дни, когда вы работаете",
  perDayRow: "Задать часы по дням",
  perDayNone: "Для недели, которая не одинакова каждый день",
  perDaySome: (days) =>
    plural("ru", days, {
      one: "{count} день со своими часами",
      few: "{count} дня со своими часами",
      many: "{count} дней со своими часами",
      other: "{count} дня со своими часами",
    }),
  noteEveryDay: "Вы работаете каждый день. Выключите дни, когда не работаете.",
  noteSomeOff:
    "Сессия, уже назначенная на выключенный день, останется на месте. Сужение часов ничего не говорит о прошлом.",
  noteOwnHours: (days) =>
    plural("ru", days, {
      one: "{count} день со своими часами. Окно выше действует для остальных.",
      few: "{count} дня со своими часами. Окно выше действует для остальных.",
      many: "{count} дней со своими часами. Окно выше действует для остальных.",
      other: "{count} дня со своими часами. Окно выше действует для остальных.",
    }),
  noteNoDays: "Все дни выключены. Лист не предложит ничего, пока вы не включите хотя бы один.",

  pickerStart: "Начало",
  pickerEnd: "Конец",
  pickerDone: "Готово",

  perDayTitle: "Часы по дням",
  perDayLede: "День, заданный здесь, получает свои часы и больше не следует общему окну.",
  notWorking: "Не работаю",
  applyToAll: "Применить эти часы к остальным рабочим дням",

  stepTitle: "Когда вы работаете?",
  stepLede:
    "Лист планирования предлагает 08:00–22:00 каждый день, пока вы не скажете иначе. Это можно изменить позже в разделе «Доступность».",
  stepContinue: "Сохранить",
  stepSkip: "Пропустить",

  saveFailed: "Не удалось сохранить. Попробуйте ещё раз.",
}

export const availability: Record<CoachLanguage, AvailabilityCopy> = { en, uk, ru }
