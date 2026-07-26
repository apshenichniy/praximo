import type { CoachLanguage } from "@praximo/domain"

/** Words that belong to no one screen, because every screen can need them. */
export interface CommonCopy {
  readonly back: string
  readonly tryAgain: string
  /** A button's label while its action is in flight, on either step. */
  readonly working: string
  /** A write that did not land — the same answer wherever it happened. */
  readonly failed: string
}

const en: CommonCopy = {
  back: "Back",
  tryAgain: "Try again",
  working: "One moment…",
  failed: "That did not go through. Check your connection and try again.",
}

const uk: CommonCopy = {
  back: "Назад",
  tryAgain: "Спробувати ще раз",
  working: "Хвилинку…",
  failed: "Не вдалося. Перевірте з'єднання і спробуйте ще раз.",
}

const ru: CommonCopy = {
  back: "Назад",
  tryAgain: "Попробовать ещё раз",
  working: "Минутку…",
  failed: "Не получилось. Проверьте соединение и попробуйте ещё раз.",
}

export const common: Record<CoachLanguage, CommonCopy> = { en, uk, ru }
