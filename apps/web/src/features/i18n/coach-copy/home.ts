import type { CoachLanguage } from "@praximo/domain"

/**
 * What Today carries that is not the day itself: the re-link banner, and the
 * optional @BotFather hint.
 *
 * The hint is **one row on Today and a screen behind it** (#61). The row reads
 * as its payoff — what the coach gets — rather than as its mechanism, and every
 * step, the address and the Hide control live on the screen it opens. A row a
 * coach can put away from the dashboard is a row they put away without reading,
 * and `has_main_web_app` already dismisses it for everybody who did the steps.
 */
export interface HomeCopy {
  /** The row on Today: the payoff, then what it costs. */
  readonly mainMiniAppRow: string
  readonly mainMiniAppRowMeta: string

  readonly mainMiniAppTitle: string
  readonly mainMiniAppLead: string
  /** Telegram's own button label, quoted inside the sentence. */
  readonly mainMiniAppOpen: string
  readonly mainMiniAppTail: string
  readonly mainMiniAppUrlLabel: string
  readonly mainMiniAppHide: string

  readonly relinkTitle: string
  /** "Telegram no longer accepts " · @username · "'s token, so …" */
  readonly relinkLead: string
  readonly relinkTail: string
  readonly relinkAction: string
}

const en: HomeCopy = {
  mainMiniAppRow: "Add an Open button to your chat list",
  mainMiniAppRowMeta: "Optional · 4 steps in @BotFather",

  mainMiniAppTitle: "Optional: open from the chat list",
  mainMiniAppLead:
    "In @BotFather choose your bot → Bot Settings → Configure Mini App → Enable Mini App, and paste this exact address. Telegram then shows an ",
  mainMiniAppOpen: "Open",
  mainMiniAppTail: " button next to your bot in the chat list.",
  mainMiniAppUrlLabel: "Your Mini App address",
  mainMiniAppHide: "Do not show this again",

  relinkTitle: "Your coach bot stopped working",
  relinkLead: "Telegram no longer accepts ",
  relinkTail: "'s token, so it cannot send or receive anything. Nothing in your workspace is lost.",
  relinkAction: "Reconnect your bot",
}

const uk: HomeCopy = {
  mainMiniAppRow: "Кнопка «Відкрити» у списку чатів",
  mainMiniAppRowMeta: "Необов'язково · 4 кроки в @BotFather",

  mainMiniAppTitle: "Необов'язково: відкривати зі списку чатів",
  mainMiniAppLead:
    "У @BotFather оберіть свого бота → Bot Settings → Configure Mini App → Enable Mini App і вставте цю саму адресу. Тоді Telegram показуватиме кнопку ",
  mainMiniAppOpen: "Відкрити",
  mainMiniAppTail: " біля вашого бота у списку чатів.",
  mainMiniAppUrlLabel: "Адреса вашого Mini App",
  mainMiniAppHide: "Більше не показувати",

  relinkTitle: "Ваш бот перестав працювати",
  relinkLead: "Telegram більше не приймає токен ",
  relinkTail:
    ", тому бот не може ні надсилати, ні отримувати повідомлення. Нічого з вашого робочого простору не втрачено.",
  relinkAction: "Підключити бота знову",
}

const ru: HomeCopy = {
  mainMiniAppRow: "Кнопка «Открыть» в списке чатов",
  mainMiniAppRowMeta: "Необязательно · 4 шага в @BotFather",

  mainMiniAppTitle: "Необязательно: открывать из списка чатов",
  mainMiniAppLead:
    "В @BotFather выберите своего бота → Bot Settings → Configure Mini App → Enable Mini App и вставьте этот же адрес. Тогда Telegram будет показывать кнопку ",
  mainMiniAppOpen: "Открыть",
  mainMiniAppTail: " рядом с вашим ботом в списке чатов.",
  mainMiniAppUrlLabel: "Адрес вашего Mini App",
  mainMiniAppHide: "Больше не показывать",

  relinkTitle: "Ваш бот перестал работать",
  relinkLead: "Telegram больше не принимает токен ",
  relinkTail:
    ", поэтому бот не может ни отправлять, ни получать сообщения. Ничего из вашего рабочего пространства не потеряно.",
  relinkAction: "Подключить бота заново",
}

export const home: Record<CoachLanguage, HomeCopy> = { en, uk, ru }
