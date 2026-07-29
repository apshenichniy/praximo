import { type CoachLanguage, DefaultCoachLanguage } from "@praximo/domain"
import { makeCatalogue } from "@praximo/i18n"

/**
 * The words of the invitation email (#58).
 *
 * A catalogue belongs to the surface that says it (ADR 0002), and here the
 * **email is the surface** — unlike `@praximo/telegram`, which owns sending but
 * not the bot's words, because the bot says those. Nothing outside this package
 * renders this text.
 *
 * It deliberately does **not** import the Acceptance Page's catalogue, and could
 * not: apps never import apps. What it does share is the one thing worth
 * sharing — the *frame*. `heading` and `subject` are «{coach} приглашает вас»,
 * the same sentence the page opens with, so a client taps a subject line and
 * lands on the words they just read. Keeping the two in agreement is a review
 * job, not a type-system one; that is the correct price for not making a page
 * and an email depend on each other's copy.
 *
 * **The name is a nominative slot and stays one** (#222,
 * `docs/agents/product-copy.md`). «приглашает» / «запрошує» agree with nothing,
 * so an operator-entered name drops in unchanged. Nothing here may phrase the
 * name into a case — «приглашение от Марины» is exactly the construction that
 * rule exists to forbid.
 */

export interface InviteEmailCopy {
  /** «{coach} приглашает вас» — the subject line and the heading, one sentence. */
  readonly subject: (coach: string) => string
  readonly heading: (coach: string) => string
  /**
   * The preview line most inboxes show beside the subject. Without one, clients
   * scrape the first words of the body and show the heading twice.
   */
  readonly preview: string
  /**
   * What happens next, in one paragraph. "Here" is honest in an email and
   * nowhere else — this *is* the mailbox the reminders will arrive in.
   */
  readonly lead: string
  readonly action: string
  /** Above the plain URL: buttons get stripped, and people paste links. */
  readonly linkFallback: string
  readonly expiry: string
  readonly footer: {
    /** What Praximo is, said once, because the coach works on a platform. */
    readonly about: string
    /** There is no Reply-To: the coach signs in with Telegram and has no mailbox here. */
    readonly noReply: string
  }
}

const en: InviteEmailCopy = {
  subject: (coach) => `${coach} is inviting you`,
  heading: (coach) => `${coach} is inviting you`,
  preview: "A minute for your profile — after that, times and links arrive on their own.",
  lead: "A minute for your profile and one thing to agree to. After that, session times and the link to the room arrive here.",
  action: "Accept the invitation",
  linkFallback: "If the button does not work, open this link:",
  expiry: "The link works for 7 days.",
  footer: {
    about: "Praximo is the platform your coach works on.",
    noReply: "This message was sent automatically — nobody reads replies to it.",
  },
}

const uk: InviteEmailCopy = {
  subject: (coach) => `${coach} запрошує вас`,
  heading: (coach) => `${coach} запрошує вас`,
  preview: "Хвилина на профіль — далі час зустрічей і посилання приходять самі.",
  lead: "Хвилина на профіль і одна згода. Далі час зустрічей і посилання на кімнату приходитимуть сюди.",
  action: "Прийняти запрошення",
  linkFallback: "Якщо кнопка не працює, відкрийте посилання:",
  expiry: "Посилання діє 7 днів.",
  footer: {
    about: "Praximo — платформа, на якій працює ваш коуч.",
    noReply: "Цей лист надіслано автоматично — відповіді на нього ніхто не читає.",
  },
}

const ru: InviteEmailCopy = {
  subject: (coach) => `${coach} приглашает вас`,
  heading: (coach) => `${coach} приглашает вас`,
  preview: "Минута на профиль — дальше время встреч и ссылки приходят сами.",
  lead: "Минута на профиль и одно согласие. Дальше время встреч и ссылка на комнату будут приходить сюда.",
  action: "Принять приглашение",
  linkFallback: "Если кнопка не работает, откройте ссылку:",
  expiry: "Ссылка действует 7 дней.",
  footer: {
    about: "Praximo — платформа, на которой работает ваш коуч.",
    noReply: "Это письмо отправлено автоматически — ответы на него никто не читает.",
  },
}

/**
 * Not strict, matching the client-facing catalogues on the page: a coach
 * pressing send must not meet a thrown `MissingTranslation` because one line of
 * one locale went missing. A partially-English email that arrives beats a send
 * that fails. The parity test holds all three levels instead.
 */
const resolve = makeCatalogue<InviteEmailCopy>({
  reference: DefaultCoachLanguage,
  byLocale: { en, uk, ru },
  strict: false,
  where: "packages/email/src/invite-email-copy.ts",
})

export const inviteEmailCopy = (locale: CoachLanguage): InviteEmailCopy => resolve(locale)
