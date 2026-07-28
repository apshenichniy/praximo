import type { CoachLanguage } from "@praximo/domain"

/** First login, step one: what Praximo is, and the language it will speak. */
export interface LanguageCopy {
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
export interface TermsCopy {
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

/**
 * Each language named in its own tongue — never translated, so a coach who
 * opened the app in a language they cannot read still recognises their own.
 */
export const languageNames: Record<CoachLanguage, string> = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
}

const enLanguage: LanguageCopy = {
  step: "Step 1 of 2",
  greeting: "Hi! I'm Praximo.",
  introduction:
    "I schedule your sessions, remind your clients, and write your notes after every session.",
  writesLead: "I will write to you in ",
  writesEmphasis: "English",
  writesTail: " — here and in your bot.",
  chipsLabel: "Language",
  continue: "Continue",
}

const ukLanguage: LanguageCopy = {
  step: "Крок 1 з 2",
  greeting: "Вітаю! Я — Praximo.",
  introduction: "Я планую ваші сесії, нагадую про них клієнтам і пишу нотатки після кожної сесії.",
  writesLead: "Я писатиму вам ",
  writesEmphasis: "українською",
  writesTail: " — тут і у вашому боті.",
  chipsLabel: "Мова",
  continue: "Продовжити",
}

const ruLanguage: LanguageCopy = {
  step: "Шаг 1 из 2",
  greeting: "Привет! Я — Praximo.",
  introduction:
    "Я планирую ваши сессии, напоминаю о них клиентам и пишу заметки после каждой сессии.",
  writesLead: "Я буду писать вам ",
  writesEmphasis: "по-русски",
  writesTail: " — здесь и в вашем боте.",
  chipsLabel: "Язык",
  continue: "Продолжить",
}

const enTerms: TermsCopy = {
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
}

const ukTerms: TermsCopy = {
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
}

const ruTerms: TermsCopy = {
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
}

export const language: Record<CoachLanguage, LanguageCopy> = {
  en: enLanguage,
  uk: ukLanguage,
  ru: ruLanguage,
}

export const terms: Record<CoachLanguage, TermsCopy> = { en: enTerms, uk: ukTerms, ru: ruTerms }
