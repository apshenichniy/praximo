import type { CoachLanguage } from "@praximo/domain"

/** The screen a coach lands on once first login is behind them. */
export interface HomeCopy {
  readonly mainMiniAppTitle: string
  readonly mainMiniAppLead: string
  /** Telegram's own button label, quoted inside the sentence. */
  readonly mainMiniAppOpen: string
  readonly mainMiniAppTail: string
  readonly relinkTitle: string
  /** "Telegram no longer accepts " · @username · "'s token, so …" */
  readonly relinkLead: string
  readonly relinkTail: string
  readonly relinkAction: string
}

const en: HomeCopy = {
  mainMiniAppTitle: "Optional: open from the chat list",
  mainMiniAppLead:
    "In @BotFather choose your bot → Bot Settings → Configure Mini App → Enable Mini App, and paste this exact address. Telegram then shows an ",
  mainMiniAppOpen: "Open",
  mainMiniAppTail: " button next to your bot in the chat list.",
  relinkTitle: "Your coach bot stopped working",
  relinkLead: "Telegram no longer accepts ",
  relinkTail: "'s token, so it cannot send or receive anything. Nothing in your workspace is lost.",
  relinkAction: "Reconnect your bot",
}

const uk: HomeCopy = {
  mainMiniAppTitle: "Необов'язково: відкривати зі списку чатів",
  mainMiniAppLead:
    "У @BotFather оберіть свого бота → Bot Settings → Configure Mini App → Enable Mini App і вставте цю саму адресу. Тоді Telegram показуватиме кнопку ",
  mainMiniAppOpen: "Відкрити",
  mainMiniAppTail: " біля вашого бота у списку чатів.",
  relinkTitle: "Ваш бот перестав працювати",
  relinkLead: "Telegram більше не приймає токен ",
  relinkTail:
    ", тому бот не може ні надсилати, ні отримувати повідомлення. Нічого з вашого робочого простору не втрачено.",
  relinkAction: "Підключити бота знову",
}

const ru: HomeCopy = {
  mainMiniAppTitle: "Необязательно: открывать из списка чатов",
  mainMiniAppLead:
    "В @BotFather выберите своего бота → Bot Settings → Configure Mini App → Enable Mini App и вставьте этот же адрес. Тогда Telegram будет показывать кнопку ",
  mainMiniAppOpen: "Открыть",
  mainMiniAppTail: " рядом с вашим ботом в списке чатов.",
  relinkTitle: "Ваш бот перестал работать",
  relinkLead: "Telegram больше не принимает токен ",
  relinkTail:
    ", поэтому бот не может ни отправлять, ни получать сообщения. Ничего из вашего рабочего пространства не потеряно.",
  relinkAction: "Подключить бота заново",
}

export const home: Record<CoachLanguage, HomeCopy> = { en, uk, ru }
