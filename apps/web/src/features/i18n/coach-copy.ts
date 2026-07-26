import { type CoachLanguage, DefaultCoachLanguage } from "@praximo/domain"

/**
 * Every word the coach Mini App says, in the three languages the product speaks
 * (#130).
 *
 * The catalogue is data rather than components because the language is chosen at
 * runtime by the coach and read from `member.language` on every launch: a screen
 * that hard-coded English would have to be rewritten to translate, which is
 * exactly how the trilingual bot catalogue ended up with three quarters of its
 * copy unreachable.
 *
 * Sentences that wrap something the app supplies — the coach's bot username, the
 * name of the language itself — are split into their own fields rather than
 * assembled from a template. Word order differs between these three languages,
 * and a placeholder in the middle of a string is a translation waiting to read
 * backwards.
 */
export interface CoachCopy {
  readonly common: {
    readonly back: string
    readonly tryAgain: string
    /** A button's label while its action is in flight, on either step. */
    readonly working: string
    /** A write that did not land — the same answer wherever it happened. */
    readonly failed: string
  }
  /**
   * Screens shown *before* a member is resolved. Nothing has been read from the
   * database at that point, so these render in the language the sender's own
   * Telegram client reports — the same fallback the bot uses for updates that
   * never reach a workspace row.
   */
  readonly entry: {
    readonly notFromBotTitle: string
    readonly notFromBotBody: string
    readonly unavailableTitle: string
    readonly unavailableBody: string
  }
  /** First login, step one: what Praximo is, and the language it will speak. */
  readonly language: {
    readonly step: string
    readonly greeting: string
    readonly introduction: string
    /** "I will write to you in " · "English" · " — here and in your bot." */
    readonly writesLead: string
    readonly writesEmphasis: string
    readonly writesTail: string
    readonly chipsLabel: string
    readonly continue: string
  }
  /** First login, step two: the terms, in the language just chosen. */
  readonly terms: {
    readonly step: string
    readonly title: string
    readonly lead: string
    readonly points: readonly [string, string, string, string, string]
    /** "The full " · "terms of service" · " and " · "privacy policy" · " …" */
    readonly legalLead: string
    readonly legalTerms: string
    readonly legalAnd: string
    readonly legalPrivacy: string
    readonly legalTail: string
    readonly accept: string
    readonly staleError: string
  }
  readonly home: {
    readonly title: string
    /** "You are set up on " · @username · " Scheduling, sessions …" */
    readonly bodyLead: string
    readonly bodyTail: string
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
}

/**
 * Each language named in its own tongue — never translated, so a coach who
 * opened the app in a language they cannot read still recognises their own.
 */
export const languageNames: Record<CoachLanguage, string> = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
}

const en: CoachCopy = {
  common: {
    back: "Back",
    tryAgain: "Try again",
    working: "One moment…",
    failed: "That did not go through. Check your connection and try again.",
  },
  entry: {
    notFromBotTitle: "Open Praximo from your bot",
    notFromBotBody:
      "This app opens from the Praximo bot set up for your practice. Find it in Telegram and tap Open.",
    unavailableTitle: "We couldn't open Praximo",
    unavailableBody: "Something on our side is not answering. Try again in a moment.",
  },
  language: {
    step: "Step 1 of 2",
    greeting: "Hi! I'm Praximo.",
    introduction:
      "I schedule your sessions, remind your clients, and write your notes after every session.",
    writesLead: "I will write to you in ",
    writesEmphasis: "English",
    writesTail: " — here and in your bot.",
    chipsLabel: "Language",
    continue: "Continue",
  },
  terms: {
    step: "Step 2 of 2",
    title: "Before you start",
    lead: "The short version of what you are agreeing to.",
    points: [
      "You decide what client data enters Praximo and what happens to it. We run the software on your instructions.",
      "The AI notes are assistive, not authoritative. Review them before you rely on them with a client.",
      "The competency framework the self-review draws on is described in our own words. We are not affiliated with any coaching federation.",
      "This is early access: features change, and there is no uptime guarantee.",
      "Everything is stored in the EU, except the AI analysis, which runs on providers in the United States.",
    ],
    legalLead: "The full ",
    legalTerms: "terms of service",
    legalAnd: " and ",
    legalPrivacy: "privacy policy",
    legalTail: " are what you are accepting.",
    accept: "I agree and continue",
    staleError: "These terms have been updated. Reopen the app to read the current version.",
  },
  home: {
    title: "Your workspace is active",
    bodyLead: "You are set up on ",
    bodyTail:
      ". Scheduling, sessions and session notes arrive here next — for now, everything happens in the chat with your bot.",
    mainMiniAppTitle: "Optional: open from the chat list",
    mainMiniAppLead:
      "In @BotFather choose your bot → Bot Settings → Configure Mini App → Enable Mini App, and paste this exact address. Telegram then shows an ",
    mainMiniAppOpen: "Open",
    mainMiniAppTail: " button next to your bot in the chat list.",
    relinkTitle: "Your coach bot stopped working",
    relinkLead: "Telegram no longer accepts ",
    relinkTail:
      "'s token, so it cannot send or receive anything. Nothing in your workspace is lost.",
    relinkAction: "Reconnect your bot",
  },
}

/**
 * Ukrainian. No sentence addressed at or about the coach uses a gender-agreeing
 * verb form — no past-tense singulars, no participles that would have to pick a
 * gender the product has never been told (#130). Present and future tense do
 * that work here, and they read more naturally besides.
 */
const uk: CoachCopy = {
  common: {
    back: "Назад",
    tryAgain: "Спробувати ще раз",
    working: "Хвилинку…",
    failed: "Не вдалося. Перевірте з'єднання і спробуйте ще раз.",
  },
  entry: {
    notFromBotTitle: "Відкрийте Praximo у своєму боті",
    notFromBotBody:
      "Цей застосунок відкривається з бота Praximo, налаштованого для вашої практики. Знайдіть його в Telegram і натисніть «Відкрити».",
    unavailableTitle: "Не вдається відкрити Praximo",
    unavailableBody: "Щось на нашому боці не відповідає. Спробуйте за хвилину.",
  },
  language: {
    step: "Крок 1 з 2",
    greeting: "Вітаю! Я — Praximo.",
    introduction:
      "Я планую ваші сесії, нагадую про них клієнтам і пишу нотатки після кожної сесії.",
    writesLead: "Я писатиму вам ",
    writesEmphasis: "українською",
    writesTail: " — тут і у вашому боті.",
    chipsLabel: "Мова",
    continue: "Продовжити",
  },
  terms: {
    step: "Крок 2 з 2",
    title: "Перш ніж почати",
    lead: "Коротко про те, з чим ви погоджуєтеся.",
    points: [
      "Ви вирішуєте, які дані клієнтів потрапляють у Praximo і що з ними відбувається. Ми надаємо програму та діємо за вашими інструкціями.",
      "Нотатки ШІ — допоміжні, а не остаточні. Перевіряйте їх, перш ніж покладатися на них у роботі з клієнтом.",
      "Модель компетенцій, на яку спирається самоаналіз, описана нашими словами. Ми не пов'язані з жодною коучинговою федерацією.",
      "Це ранній доступ: можливості змінюються, гарантій безперебійної роботи немає.",
      "Усе зберігається в ЄС, окрім аналізу ШІ — він виконується у провайдерів у США.",
    ],
    legalLead: "Ви приймаєте повні ",
    legalTerms: "умови надання послуг",
    legalAnd: " і ",
    legalPrivacy: "політику конфіденційності",
    legalTail: ".",
    accept: "Погоджуюсь і продовжую",
    staleError: "Умови оновилися. Відкрийте застосунок знову, щоб прочитати чинну версію.",
  },
  home: {
    title: "Ваш робочий простір активний",
    bodyLead: "Вас налаштовано на ",
    bodyTail:
      ". Планування, сесії та нотатки з'являться тут згодом — наразі все відбувається в чаті з вашим ботом.",
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
  },
}

/** Russian, under the same rule about gender-agreeing forms as Ukrainian. */
const ru: CoachCopy = {
  common: {
    back: "Назад",
    tryAgain: "Попробовать ещё раз",
    working: "Минутку…",
    failed: "Не получилось. Проверьте соединение и попробуйте ещё раз.",
  },
  entry: {
    notFromBotTitle: "Откройте Praximo в своём боте",
    notFromBotBody:
      "Это приложение открывается из бота Praximo, настроенного для вашей практики. Найдите его в Telegram и нажмите «Открыть».",
    unavailableTitle: "Не получается открыть Praximo",
    unavailableBody: "Что-то на нашей стороне не отвечает. Попробуйте через минуту.",
  },
  language: {
    step: "Шаг 1 из 2",
    greeting: "Привет! Я — Praximo.",
    introduction:
      "Я планирую ваши сессии, напоминаю о них клиентам и пишу заметки после каждой сессии.",
    writesLead: "Я буду писать вам ",
    writesEmphasis: "по-русски",
    writesTail: " — здесь и в вашем боте.",
    chipsLabel: "Язык",
    continue: "Продолжить",
  },
  terms: {
    step: "Шаг 2 из 2",
    title: "Прежде чем начать",
    lead: "Коротко о том, с чем вы соглашаетесь.",
    points: [
      "Вы решаете, какие данные клиентов попадают в Praximo и что с ними происходит. Мы предоставляем программу и действуем по вашим инструкциям.",
      "Заметки ИИ — вспомогательные, а не окончательные. Проверяйте их, прежде чем опираться на них в работе с клиентом.",
      "Модель компетенций, на которую опирается самоанализ, описана нашими словами. Мы не связаны ни с одной коучинговой федерацией.",
      "Это ранний доступ: возможности меняются, гарантий бесперебойной работы нет.",
      "Всё хранится в ЕС, кроме анализа ИИ — он выполняется у провайдеров в США.",
    ],
    legalLead: "Вы принимаете полные ",
    legalTerms: "условия использования",
    legalAnd: " и ",
    legalPrivacy: "политику конфиденциальности",
    legalTail: ".",
    accept: "Соглашаюсь и продолжаю",
    staleError: "Условия обновились. Откройте приложение заново, чтобы прочитать текущую версию.",
  },
  home: {
    title: "Ваше рабочее пространство активно",
    bodyLead: "Вы подключены к ",
    bodyTail:
      ". Планирование, сессии и заметки появятся здесь позже — пока всё происходит в чате с вашим ботом.",
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
  },
}

/**
 * English is the reference, not merely one of three: it is the shape every
 * other catalogue is filled out against, and the value a gap falls back to.
 */
export const coachCatalog: Record<CoachLanguage, CoachCopy> = { en, uk, ru }

/** What a gap falls back to, and the language every catalogue is filled out against. */
export const FallbackLanguage: CoachLanguage = DefaultCoachLanguage

export class MissingTranslation extends Error {
  readonly locale: CoachLanguage
  readonly path: string

  constructor(locale: CoachLanguage, path: string) {
    super(
      `Missing ${locale} translation for "${path}". Add it to the ${locale} catalogue in features/i18n/coach-copy.ts — ` +
        `production would silently fall back to English here, which is how a language ends up shipped and unread (#130).`,
    )
    this.name = "MissingTranslation"
    this.locale = locale
    this.path = path
  }
}

const isPresent = (value: unknown): boolean =>
  typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null

/**
 * Fill one catalogue out against English, leaf by leaf.
 *
 * The types already make an *omitted* key impossible, so what this catches is
 * the other half: a key that is present and empty — a translator's placeholder,
 * a bad merge, a string somebody blanked while editing. In development that
 * throws where it happens; in production it renders English, because a coach
 * reading one English sentence in a Ukrainian screen is a smaller failure than
 * a coach reading `terms.points.3`.
 *
 * Exported for the test that pins both halves of that split — the behaviour is
 * conditional on the build, so a test has to be able to call it directly.
 */
export const fillGaps = <T>(reference: T, translation: T, locale: CoachLanguage, path = ""): T => {
  if (Array.isArray(reference)) {
    const translated = translation as ReadonlyArray<unknown>
    return reference.map((item, index) =>
      fillGaps(item, translated[index], locale, `${path}.${index}`),
    ) as T
  }
  if (typeof reference === "object" && reference !== null) {
    const source = translation as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(reference).map(([key, value]) => [
        key,
        fillGaps(value, source?.[key], locale, path === "" ? key : `${path}.${key}`),
      ]),
    ) as T
  }
  if (isPresent(translation)) return translation
  if (import.meta.env.DEV) throw new MissingTranslation(locale, path)
  return reference
}

const resolved = new Map<CoachLanguage, CoachCopy>()

/**
 * The coach Mini App's words in one language. Resolved once per locale per
 * process — the catalogues are constants, so the fallback walk cannot produce a
 * different answer the second time.
 */
export const coachCopy = (locale: CoachLanguage): CoachCopy => {
  const cached = resolved.get(locale)
  if (cached !== undefined) return cached
  const copy =
    locale === FallbackLanguage
      ? coachCatalog[FallbackLanguage]
      : fillGaps(coachCatalog[FallbackLanguage], coachCatalog[locale], locale, "")
  resolved.set(locale, copy)
  return copy
}
