import { type CoachLanguage, DefaultCoachLanguage } from "@praximo/domain"
import { makeCatalogue } from "@praximo/i18n"

/**
 * Everything the Acceptance Page says **except the consent** (#57).
 *
 * The split is not arbitrary. `@praximo/i18n`'s `clientCopy.consent` is shared
 * because two Workers render that exact block and a consent text with two
 * copies is a record nobody can reproduce. Every other sentence in that
 * catalogue is written for Telegram — «я пришлю ссылку прямо сюда», «детали
 * будут приходить сюда» — and belongs to a chat, not to a page with a form on
 * it. Reusing them here would mean either lying about where things arrive or
 * rewording a catalogue the bot depends on.
 *
 * So they live here, owned by the surface that says them (ADR 0002), exactly as
 * `chrome-copy.ts` beside it does for the frame.
 */

export interface InviteCopy {
  readonly greeting: {
    /** «{coach} приглашает вас» — the page's one job before it asks anything. */
    readonly invites: (coach: string) => string
    readonly lead: string
    /** Prefixes the booked session in the chip: «Первая встреча · вторник…». */
    readonly intake: string
    readonly session: string
  }
  readonly form: {
    /**
     * Google's own approved call to action, in Google's own translations.
     *
     * Localising it is explicitly encouraged by their branding guidelines, and
     * the strings are theirs rather than ours: a button that says something
     * Google does not say is a button that fails app verification.
     */
    readonly google: string
    readonly or: string
    /**
     * What replaces the button once the import has happened (#59).
     *
     * A line saying where the data came from, and **not** a badge saying it is
     * verified. Every field it filled stays an ordinary editable field, so a mark
     * claiming otherwise would be a lie the next keystroke exposes.
     */
    readonly googleDone: string
    /**
     * The same line when Google reported `email_verified: false` — which happens
     * when a non-Google domain is attached to the account (#28). The address is
     * still filled in and still editable; it is simply not described as
     * confirmed, which is the whole of what reading that flag buys.
     */
    readonly googleDoneUnverified: string
    /**
     * A declined consent screen, a closed popup, a webview Google refuses to run
     * OAuth in. Quiet and recoverable: the fields are exactly as they were left,
     * and typing them is the way through it always was.
     */
    readonly googleFailed: string
    /** For the popup, in the rare case the browser will not let it close itself. */
    readonly googleClose: string
    readonly nameLabel: string
    readonly namePlaceholder: string
    readonly emailLabel: string
    readonly emailPlaceholder: string
    /**
     * The consequence, not the obligation. A person reading *why* types it; a
     * person reading *required* looks for the way around.
     */
    readonly emailHint: string
    readonly nameInvalid: string
    readonly emailInvalid: string
  }
  readonly consent: {
    /** The eyebrow over the right column. The heading itself is the catalogue's. */
    readonly eyebrow: string
    /** Sits beside the commit: what is about to travel, so the promise is checkable. */
    readonly summary: (input: { readonly name: string; readonly email: string }) => string
    readonly locked: string
  }
  readonly done: {
    readonly title: string
    readonly remindersTo: (email: string) => string
    readonly wrongAddress: string
    readonly withoutSession: (coach: string) => string
  }
  readonly refusal: {
    readonly alreadyAccepted: { readonly title: string; readonly body: string }
    /**
     * These two say who to ask. The name is **not** in the sentence in ru and
     * uk: «попросите у …» takes the genitive, and a case table applied to an
     * operator-entered string produces confident nonsense
     * (`docs/agents/product-copy.md`). They say «своего коуча» and the screen's
     * frame carries the name in the nominative instead — which is exactly what
     * that rule means by "a surface that means to carry the name owes it
     * explicitly". `en` inflects nothing and keeps the name in the sentence.
     */
    readonly superseded: { readonly title: string; readonly body: (coach: string) => string }
    readonly expired: { readonly title: string; readonly body: (coach: string) => string }
    /** Names nobody: a typo and a guessing script get the same page. */
    readonly unknown: { readonly title: string; readonly body: string }
    readonly stale: string
    /** The nominative slot the frame uses above those two. */
    readonly yourCoach: string
  }
  readonly failure: string
}

const en: InviteCopy = {
  greeting: {
    invites: (coach) => `${coach} is inviting you`,
    lead: "A minute for your profile and one thing to agree to — after that, times and links arrive on their own.",
    intake: "First session",
    session: "Session",
  },
  form: {
    google: "Continue with Google",
    or: "or",
    googleDone: "Filled in from your Google profile — edit anything that is not right.",
    googleDoneUnverified:
      "Filled in from your Google profile. Google has not confirmed this address, so do check it.",
    googleFailed: "That did not finish. Nothing was sent — fill the fields in below instead.",
    googleClose: "You can close this window.",
    nameLabel: "What should we call you?",
    namePlaceholder: "Your name",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    emailHint: "Session times and the link to the room arrive here.",
    nameInvalid: "Please tell us what to call you.",
    emailInvalid: "That does not look like an email address.",
  },
  consent: {
    eyebrow: "Consent",
    summary: (input) => `Sending: ${input.name}, ${input.email}.`,
    locked: "Read to the end of the list to continue.",
  },
  done: {
    title: "All set — your profile is ready",
    remindersTo: (email) => `Reminders will go to ${email}`,
    wrongAddress: "Wrong address? Mention it at the session and you will be sent a new link.",
    withoutSession: (coach) =>
      `${coach} will be in touch once a time is set, and the link will arrive by email.`,
  },
  refusal: {
    alreadyAccepted: {
      title: "You are already set up",
      body: "Session details will arrive by email — there is nothing else to do.",
    },
    superseded: {
      title: "This link has been replaced",
      body: (coach) => `Ask ${coach} for the current one.`,
    },
    expired: {
      title: "This link has expired",
      body: (coach) => `Ask ${coach} for a fresh one.`,
    },
    unknown: {
      title: "This link does not work",
      body: "Check that you copied all of it, or ask for a new one.",
    },
    stale: "This invitation is no longer open. Ask your coach for a new link.",
    yourCoach: "Your coach",
  },
  failure: "That did not go through. Nothing was saved — try again.",
}

const uk: InviteCopy = {
  greeting: {
    invites: (coach) => `${coach} запрошує вас`,
    lead: "Хвилина на профіль і одна згода — далі час зустрічей і посилання приходитимуть самі.",
    intake: "Перша зустріч",
    session: "Зустріч",
  },
  form: {
    google: "Продовжити з Google",
    or: "або",
    googleDone: "Заповнено з вашого профілю Google — виправте те, що не так.",
    googleDoneUnverified:
      "Заповнено з вашого профілю Google. Google не підтвердив цю адресу, тож перевірте її.",
    googleFailed: "Не вдалося завершити. Нічого не надіслано — заповніть поля нижче.",
    googleClose: "Це вікно можна закрити.",
    nameLabel: "Як вас звати?",
    namePlaceholder: "Ваше ім'я",
    emailLabel: "Електронна пошта",
    emailPlaceholder: "you@example.com",
    emailHint: "Сюди прийдуть час зустрічі та посилання на кімнату.",
    nameInvalid: "Напишіть, будь ласка, як до вас звертатися.",
    emailInvalid: "Це не схоже на адресу електронної пошти.",
  },
  consent: {
    eyebrow: "Згода",
    summary: (input) => `Надсилаємо: ${input.name}, ${input.email}.`,
    locked: "Дочитайте список до кінця, щоб продовжити.",
  },
  done: {
    title: "Готово — профіль створено",
    remindersTo: (email) => `Нагадування приходитимуть на ${email}`,
    wrongAddress: "Не та адреса? Скажіть про це на зустрічі — вам надішлють нове посилання.",
    withoutSession: (coach) =>
      `${coach} напише, коли час буде призначено, а посилання прийде на пошту.`,
  },
  refusal: {
    alreadyAccepted: {
      title: "Ви вже підключені",
      body: "Деталі зустрічей приходитимуть на вашу пошту — більше нічого робити не потрібно.",
    },
    superseded: {
      title: "Це посилання замінено",
      body: () => `Попросіть у свого коуча актуальне.`,
    },
    expired: {
      title: "Термін дії посилання минув",
      body: () => `Попросіть у свого коуча свіже.`,
    },
    unknown: {
      title: "Це посилання не працює",
      body: "Перевірте, чи скопіювали його повністю, або попросіть нове.",
    },
    stale: "Це запрошення вже недійсне. Попросіть у свого коуча нове посилання.",
    yourCoach: "Ваш коуч",
  },
  failure: "Не вдалося. Нічого не збережено — спробуйте ще раз.",
}

const ru: InviteCopy = {
  greeting: {
    invites: (coach) => `${coach} приглашает вас`,
    lead: "Минута на профиль и одно согласие — дальше время встреч и ссылки будут приходить сами.",
    intake: "Первая встреча",
    session: "Встреча",
  },
  form: {
    google: "Продолжить с Google",
    or: "или",
    googleDone: "Заполнено из вашего профиля Google — исправьте то, что не так.",
    googleDoneUnverified:
      "Заполнено из вашего профиля Google. Google не подтвердил этот адрес, так что проверьте его.",
    googleFailed: "Не удалось завершить. Ничего не отправлено — заполните поля ниже.",
    googleClose: "Это окно можно закрыть.",
    nameLabel: "Как вас зовут?",
    namePlaceholder: "Ваше имя",
    emailLabel: "Электронная почта",
    emailPlaceholder: "you@example.com",
    emailHint: "Сюда придут время встречи и ссылка на комнату.",
    nameInvalid: "Напишите, пожалуйста, как к вам обращаться.",
    emailInvalid: "Это не похоже на адрес электронной почты.",
  },
  consent: {
    eyebrow: "Согласие",
    summary: (input) => `Отправляем: ${input.name}, ${input.email}.`,
    locked: "Дочитайте список до конца, чтобы продолжить.",
  },
  done: {
    title: "Готово — профиль создан",
    remindersTo: (email) => `Напоминания придут на ${email}`,
    wrongAddress: "Не тот адрес? Скажите об этом на встрече — вам пришлют новую ссылку.",
    withoutSession: (coach) =>
      `${coach} напишет, когда время будет назначено, а ссылка придёт на почту.`,
  },
  refusal: {
    alreadyAccepted: {
      title: "Вы уже подключены",
      body: "Детали встреч будут приходить на вашу почту — больше ничего делать не нужно.",
    },
    superseded: {
      title: "Эта ссылка заменена",
      body: () => `Попросите у своего коуча актуальную.`,
    },
    expired: {
      title: "Срок действия ссылки истёк",
      body: () => `Попросите у своего коуча свежую.`,
    },
    unknown: {
      title: "Эта ссылка не работает",
      body: "Проверьте, скопировали ли вы её целиком, или попросите новую.",
    },
    stale: "Это приглашение больше не действует. Попросите у своего коуча новую ссылку.",
    yourCoach: "Ваш коуч",
  },
  failure: "Не получилось. Ничего не сохранено — попробуйте ещё раз.",
}

/**
 * Not strict, for the same reason `clientCopy` and `chromeCopy` are not: a client
 * mid-acceptance must never meet a thrown `MissingTranslation`, and this is the
 * last screen in the product where failing loudly at somebody who came to say
 * yes would be the right trade. The parity test holds the three level instead.
 */
const resolve = makeCatalogue<InviteCopy>({
  reference: DefaultCoachLanguage,
  byLocale: { en, uk, ru },
  strict: false,
  where: "apps/client/src/features/i18n/invite-copy.ts",
})

export const inviteCopy = (locale: CoachLanguage): InviteCopy => resolve(locale)
