import { type CoachLanguage, CoachLanguages } from "@praximo/domain"
import { contentDigest } from "./digest.ts"
import { makeCatalogue } from "./gaps.ts"
import { plural } from "./plural.ts"
import type { SessionMoment } from "./session-time.ts"

/**
 * The first strings in the product addressed at somebody who is **not the
 * coach** (#56).
 *
 * They live in `@praximo/i18n` rather than beside the bot that says them today
 * because #57 renders the same consent text in the `web` Worker, and a consent
 * text with two copies is a consent record nobody can reproduce.
 *
 * Three rules hold across the whole catalogue, and `docs/agents/product-copy.md`
 * is where they are written down:
 *
 * - the client is addressed by **their coach's assistant**, never by a platform;
 * - no URLs in body text — the privacy policy is an inline button (#164);
 * - no gender-agreeing verb forms about the coach in UK/RU (#16), which is why
 *   nothing here says "she set up" and the confirmations are impersonal.
 */

export interface ConfirmationInput {
  readonly coach: string
  readonly kind: "intake" | "regular"
  readonly moment: SessionMoment
  readonly durationMinutes: number
}

export interface ClientCopy {
  readonly languageStep: {
    readonly title: string
    readonly lead: (coach: string) => string
  }
  readonly consent: {
    readonly title: string
    readonly lead: (coach: string) => string
    /** The five required elements, in the order privacy-retention.md fixes. */
    readonly points: (coach: string) => ReadonlyArray<string>
    readonly privacyButton: string
    readonly agreeButton: string
    readonly footer: string
  }
  readonly confirmation: {
    readonly withSession: (input: ConfirmationInput) => string
    readonly withoutSession: (coach: string) => string
  }
  readonly refusal: {
    /**
     * The common case, and not an error at all: the client scrolled up and
     * tapped the old link. It is told apart from the one below by the Telegram
     * identity that accepted.
     */
    readonly alreadySetUp: (coach: string) => string
    readonly linkUsed: (coach: string) => string
    readonly linkExpired: (coach: string) => string
  }
  /** A bare `/start` from somebody with no invitation — and a code from another workspace. */
  readonly stranger: (coach: string) => string
}

/** The language chips, each named in its own tongue. Identical in every locale. */
export const ClientLanguageNames: Record<CoachLanguage, string> = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
}

/** Leads the language the client's own Telegram already suggests. */
export const SuggestedLanguageMark = "• "

const minutes = (locale: CoachLanguage, count: number): string =>
  plural(locale, count, {
    en: { one: "{count} minute", other: "{count} minutes" },
    uk: {
      one: "{count} хвилина",
      few: "{count} хвилини",
      many: "{count} хвилин",
      other: "{count} хвилини",
    },
    ru: {
      one: "{count} минута",
      few: "{count} минуты",
      many: "{count} минут",
      other: "{count} минуты",
    },
  }[locale])

const en: ClientCopy = {
  languageStep: {
    title: "<b>Which language should I write in?</b>",
    lead: (coach) =>
      `I am ${coach}'s assistant. Pick a language and I will carry on in it — including everything about your sessions.`,
  },
  consent: {
    title: "<b>One thing to agree to</b>",
    lead: (coach) =>
      `To help ${coach} prepare for your sessions, Praximo records and analyses them. Here is exactly what that means:`,
    points: (coach) => [
      "Your session audio is recorded.",
      `The recordings are analysed by AI. The results go only to ${coach} — nobody else sees them.`,
      `Audio is deleted 30 days after it is transcribed. Transcripts and analysis results are kept until ${coach} deletes them.`,
      "Everything is processed in the EU, except the AI analysis, which runs in the US. Those requests pass through Cloudflare AI Gateway, which keeps a log of them.",
      `You can withdraw this consent, or ask for your data to be deleted, at any time — just tell ${coach}.`,
    ],
    privacyButton: "Privacy policy",
    agreeButton: "I agree",
    footer: "Nothing is saved until you agree.",
  },
  confirmation: {
    withSession: (input) =>
      `<b>All set — your profile is ready.</b>\n\n${
        input.kind === "intake" ? "Your first meeting" : "Your meeting"
      }: ${input.moment.day}, ${input.moment.time} (${input.moment.offset}), ${minutes(
        "en",
        input.durationMinutes,
      )}.\n\nI will send the link to join right here.`,
    withoutSession: (coach) =>
      `<b>All set — your profile is ready.</b>\n\n${coach} will write here once a time is set, and I will send the link to join.`,
  },
  refusal: {
    alreadySetUp: (coach) =>
      `You are already set up with ${coach}. Session details will arrive right here — nothing else to do.`,
    linkUsed: (coach) => `This link has already been used. Ask ${coach} for a new one.`,
    linkExpired: (coach) => `This link has expired. Ask ${coach} for a fresh one.`,
  },
  stranger: (coach) =>
    `This is ${coach}'s assistant bot. If you are working with them, ask for an invitation link — that is the only way in.`,
}

const uk: ClientCopy = {
  languageStep: {
    title: "<b>Якою мовою мені писати?</b>",
    lead: (coach) =>
      `Я помічник ${coach}. Оберіть мову — нею я й продовжу, зокрема про ваші сесії.`,
  },
  consent: {
    title: "<b>Одна річ, на яку потрібна ваша згода</b>",
    lead: (coach) =>
      `Щоб допомогти ${coach} готуватися до ваших сесій, Praximo записує та аналізує їх. Ось що саме це означає:`,
    points: (coach) => [
      "Аудіо ваших сесій записується.",
      `Записи аналізує штучний інтелект. Результати отримує лише ${coach} — більше ніхто їх не бачить.`,
      `Аудіо видаляється через 30 днів після розшифрування. Транскрипти та результати аналізу зберігаються, доки ${coach} їх не видалить.`,
      "Уся обробка відбувається в ЄС, окрім аналізу штучним інтелектом — він виконується у США. Ці запити проходять через Cloudflare AI Gateway, який зберігає їх журнал.",
      `Ви можете відкликати цю згоду або попросити видалити ваші дані будь-коли — просто скажіть про це ${coach}.`,
    ],
    privacyButton: "Політика конфіденційності",
    agreeButton: "Даю згоду",
    footer: "Нічого не зберігається, доки ви не погодитесь.",
  },
  confirmation: {
    withSession: (input) =>
      `<b>Готово — профіль створено.</b>\n\n${
        input.kind === "intake" ? "Перша зустріч" : "Зустріч"
      }: ${input.moment.day}, ${input.moment.time} (${input.moment.offset}), ${minutes(
        "uk",
        input.durationMinutes,
      )}.\n\nЯ надішлю посилання для підключення просто сюди.`,
    withoutSession: (coach) =>
      `<b>Готово — профіль створено.</b>\n\n${coach} напише тут, коли час буде призначено, і я надішлю посилання для підключення.`,
  },
  refusal: {
    alreadySetUp: (coach) =>
      `Ви вже підключені до ${coach}. Деталі сесій надходитимуть просто сюди — більше нічого робити не потрібно.`,
    linkUsed: (coach) => `Це посилання вже використано. Попросіть у ${coach} нове.`,
    linkExpired: (coach) => `Термін дії посилання минув. Попросіть у ${coach} свіже.`,
  },
  stranger: (coach) =>
    `Це бот-помічник ${coach}. Якщо ви працюєте разом, попросіть посилання-запрошення — увійти можна лише за ним.`,
}

const ru: ClientCopy = {
  languageStep: {
    title: "<b>На каком языке мне писать?</b>",
    lead: (coach) =>
      `Я помощник ${coach}. Выберите язык — на нём я и продолжу, в том числе про ваши сессии.`,
  },
  consent: {
    title: "<b>Одна вещь, на которую нужно ваше согласие</b>",
    lead: (coach) =>
      `Чтобы помочь ${coach} готовиться к вашим сессиям, Praximo записывает и анализирует их. Вот что именно это значит:`,
    points: (coach) => [
      "Аудио ваших сессий записывается.",
      `Записи анализирует искусственный интеллект. Результаты получает только ${coach} — больше их никто не видит.`,
      `Аудио удаляется через 30 дней после расшифровки. Транскрипты и результаты анализа хранятся, пока ${coach} их не удалит.`,
      "Вся обработка происходит в ЕС, кроме анализа искусственным интеллектом — он выполняется в США. Эти запросы проходят через Cloudflare AI Gateway, который ведёт их журнал.",
      `Вы можете отозвать это согласие или попросить удалить ваши данные в любой момент — просто скажите об этом ${coach}.`,
    ],
    privacyButton: "Политика конфиденциальности",
    agreeButton: "Даю согласие",
    footer: "Ничего не сохраняется, пока вы не согласитесь.",
  },
  confirmation: {
    withSession: (input) =>
      `<b>Готово — профиль создан.</b>\n\n${
        input.kind === "intake" ? "Первая встреча" : "Встреча"
      }: ${input.moment.day}, ${input.moment.time} (${input.moment.offset}), ${minutes(
        "ru",
        input.durationMinutes,
      )}.\n\nЯ пришлю ссылку для подключения прямо сюда.`,
    withoutSession: (coach) =>
      `<b>Готово — профиль создан.</b>\n\n${coach} напишет здесь, когда время будет назначено, и я пришлю ссылку для подключения.`,
  },
  refusal: {
    alreadySetUp: (coach) =>
      `Вы уже подключены к ${coach}. Детали сессий будут приходить прямо сюда — больше ничего делать не нужно.`,
    linkUsed: (coach) => `Эта ссылка уже использована. Попросите у ${coach} новую.`,
    linkExpired: (coach) => `Срок действия ссылки истёк. Попросите у ${coach} свежую.`,
  },
  stranger: (coach) =>
    `Это бот-помощник ${coach}. Если вы работаете вместе, попросите ссылку-приглашение — войти можно только по ней.`,
}

/**
 * The client's words in one language.
 *
 * Not strict: a client mid-acceptance must never meet a thrown
 * `MissingTranslation`, and a consent screen is the last place to fail loudly at
 * somebody who came to say yes. The parity test in this package is what keeps
 * the three catalogues level instead.
 */
export const clientCopy = makeCatalogue<ClientCopy>({
  reference: "en",
  byLocale: { en, uk, ru },
  strict: false,
  where: "packages/i18n/src/client-copy.ts",
})

/** The day the client consent text takes effect, leading every version it produces. */
export const CLIENT_CONSENT_EFFECTIVE_DATE = "2026-08-01"

/**
 * The consent text as one string, which is both what the client reads and what
 * the version below is derived from.
 *
 * Rendered with the coach's name filled in for reading, and with a literal
 * `{coach}` for versioning — otherwise every coach's clients would carry a
 * different version of the same document.
 */
export const clientConsentText = (locale: CoachLanguage, coach: string): string => {
  const copy = clientCopy(locale)
  const points = copy.consent
    .points(coach)
    .map((point, index) => `${index + 1}. ${point}`)
    .join("\n")
  return [copy.consent.title, copy.consent.lead(coach), points, copy.consent.footer].join("\n\n")
}

/**
 * **Per language**, deliberately — unlike the coach's terms, which carry one
 * version across all three (#130).
 *
 * The coach can change language after accepting and must not be asked to accept
 * anything again, so their version has to name the document rather than the
 * rendering. The client has no language control after acceptance at all: the
 * text they agreed to is the text they were shown, in the language they named
 * themselves, and the record says which.
 */
export const clientConsentVersion = (locale: CoachLanguage): string =>
  `${CLIENT_CONSENT_EFFECTIVE_DATE}+${locale}+${contentDigest(clientConsentText(locale, "{coach}"))}`

/** Every version this build can record, for the parity test and for #57. */
export const clientConsentVersions = (): Record<CoachLanguage, string> =>
  Object.fromEntries(CoachLanguages.map((locale) => [locale, clientConsentVersion(locale)])) as Record<
    CoachLanguage,
    string
  >
