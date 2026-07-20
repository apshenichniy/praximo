// PROTOTYPE — trilingual copy for the client-facing surfaces (wayfinder #28).
// Copy is a draft to judge the flow's feel; the real consent copy is its own ticket.

export type Locale = "en" | "uk" | "ru"

export const localeNames: Record<Locale, string> = {
  en: "English",
  uk: "Українська",
  ru: "Русский",
}

type Dict = {
  // invite email
  inviteSubject: (coach: string) => string
  invitePreview: (coach: string) => string
  inviteHeading: (coach: string) => string
  inviteBody: (coach: string, client: string) => string
  inviteCta: string
  inviteFallback: string
  inviteFooter: (coach: string) => string
  // acceptance page
  accLanguageTitle: string
  accLanguageSubtitle: (coach: string) => string
  accContinue: string
  accBack: string
  accProfileTitle: string
  accProfileSubtitle: (coach: string) => string
  accNameLabel: string
  accAvatarLabel: string
  accAvatarHint: string
  accUpload: string
  accEmailLabel: string
  accEmailHint: string
  accGoogle: string
  accGoogleDone: string
  accOr: string
  accConsentTitle: string
  accConsentIntro: (coach: string) => string
  accConsentItems: Array<string>
  accPrivacyLink: string
  accAgree: string
  accNothingSaved: string
  accDoneTitle: (coach: string) => string
  accDoneBody: (coach: string) => string
  accDoneSession: string
  accDoneReminder: { email: string; manual: (coach: string) => string }
  // reminder email
  remSubject: (coach: string) => string
  remPreview: string
  remHeading: (client: string) => string
  remBody: (coach: string) => string
  remCta: string
  remFallback: string
  remFooter: (coach: string) => string
  // pre-join / room
  joinTitle: string
  joinWith: (coach: string) => string
  joinNotice: string
  joinCta: string
  joinMicCam: string
  sessionKindIntake: string
  minutes: (n: number) => string
}

export const dict: Record<Locale, Dict> = {
  en: {
    inviteSubject: (c) => `${c} invites you to coaching sessions`,
    invitePreview: () => `Set up your profile — it takes a minute.`,
    inviteHeading: (c) => `${c} invites you`,
    inviteBody: (c, cl) =>
      `Hi ${cl}! ${c} uses Praximo, an assistant that handles scheduling, reminders, and session calls. Set up your profile to get started — it takes about a minute.`,
    inviteCta: "Set up my profile",
    inviteFallback: "Or copy this link into your browser:",
    inviteFooter: (c) =>
      `You received this email because ${c} invited you to their coaching practice. If you don't know ${c}, you can ignore this email.`,
    accLanguageTitle: "Choose your language",
    accLanguageSubtitle: (c) => `${c} invited you to coaching sessions.`,
    accContinue: "Continue",
    accBack: "Back",
    accProfileTitle: "Your profile",
    accProfileSubtitle: (c) => `This is how ${c} will see you.`,
    accNameLabel: "Name",
    accAvatarLabel: "Photo",
    accAvatarHint: "Optional — shown during video sessions",
    accUpload: "Upload",
    accEmailLabel: "Email",
    accEmailHint: "Optional — for session reminders and join links",
    accGoogle: "Continue with Google",
    accGoogleDone: "Filled from Google",
    accOr: "or fill in manually",
    accConsentTitle: "One thing to agree to",
    accConsentIntro: (c) =>
      `To help ${c} prepare for your sessions, Praximo records and analyzes them. Here is exactly what that means:`,
    accConsentItems: [
      "Session audio is recorded.",
      "Recordings are analyzed by AI; the results go only to your coach.",
      "Audio is kept up to 30 days after transcription; transcripts and analysis results are kept until your coach deletes them.",
      "Processing happens in the EU, except AI analysis in the US.",
      "You can revoke consent and request deletion through your coach at any time.",
    ],
    accPrivacyLink: "Privacy policy",
    accAgree: "I agree",
    accNothingSaved: "Nothing is saved until you agree.",
    accDoneTitle: () => `You're all set!`,
    accDoneBody: (c) => `${c} has set up your profile. Your first session:`,
    accDoneSession: "Intake session",
    accDoneReminder: {
      email: "We'll email you a reminder with the join link before the session.",
      manual: (c) => `${c} will send you the join link before the session.`,
    },
    remSubject: (c) => `Your session with ${c} — tomorrow at 10:00`,
    remPreview: "Join link inside. See you soon!",
    remHeading: (cl) => `See you tomorrow, ${cl}!`,
    remBody: (c) =>
      `Your session with ${c} is tomorrow, July 23 at 10:00 (Kyiv time). Join from your browser — no app needed.`,
    remCta: "Join the session",
    remFallback: "Or copy this link into your browser:",
    remFooter: (c) => `Sent by Praximo on behalf of ${c}.`,
    joinTitle: "Ready to join?",
    joinWith: (c) => `Session with ${c}`,
    joinNotice: "This session is recorded and analyzed by AI for your coach.",
    joinCta: "Join session",
    joinMicCam: "Check your camera and microphone",
    sessionKindIntake: "Intake session",
    minutes: (n) => `${n} min`,
  },
  uk: {
    inviteSubject: (c) => `${c} запрошує вас на коучингові сесії`,
    invitePreview: () => `Налаштуйте свій профіль — це займе хвилину.`,
    inviteHeading: (c) => `${c} запрошує вас`,
    inviteBody: (c, cl) =>
      `Вітаємо, ${cl}! ${c} користується Praximo — асистентом, що бере на себе розклад, нагадування та відеосесії. Налаштуйте свій профіль, щоб почати — це займе близько хвилини.`,
    inviteCta: "Налаштувати профіль",
    inviteFallback: "Або скопіюйте це посилання у браузер:",
    inviteFooter: (c) =>
      `Ви отримали цей лист, бо ${c} запросила вас до своєї коучингової практики. Якщо ви не знаєте ${c}, просто проігноруйте цей лист.`,
    accLanguageTitle: "Оберіть мову",
    accLanguageSubtitle: (c) => `${c} запросила вас на коучингові сесії.`,
    accContinue: "Продовжити",
    accBack: "Назад",
    accProfileTitle: "Ваш профіль",
    accProfileSubtitle: (c) => `Таким вас бачитиме ${c}.`,
    accNameLabel: "Ім'я",
    accAvatarLabel: "Фото",
    accAvatarHint: "Необов'язково — показується під час відеосесій",
    accUpload: "Завантажити",
    accEmailLabel: "Email",
    accEmailHint: "Необов'язково — для нагадувань і посилань на сесії",
    accGoogle: "Продовжити з Google",
    accGoogleDone: "Заповнено з Google",
    accOr: "або заповніть вручну",
    accConsentTitle: "Одна річ, на яку потрібна ваша згода",
    accConsentIntro: (c) =>
      `Щоб допомогти ${c} готуватися до ваших сесій, Praximo записує та аналізує їх. Ось що це означає:`,
    accConsentItems: [
      "Аудіо сесій записується.",
      "Записи аналізує ШІ; результати отримує лише ваш коуч.",
      "Аудіо зберігається до 30 днів після транскрибування; транскрипти та результати аналізу — доки коуч їх не видалить.",
      "Обробка відбувається в ЄС, окрім ШІ-аналізу в США.",
      "Ви можете відкликати згоду та попросити про видалення через свого коуча в будь-який момент.",
    ],
    accPrivacyLink: "Політика конфіденційності",
    accAgree: "Погоджуюсь",
    accNothingSaved: "Нічого не зберігається, доки ви не погодитесь.",
    accDoneTitle: () => `Все готово!`,
    accDoneBody: (c) => `${c} налаштувала ваш профіль. Ваша перша сесія:`,
    accDoneSession: "Вступна сесія",
    accDoneReminder: {
      email: "Перед сесією ми надішлемо вам нагадування з посиланням на email.",
      manual: (c) => `${c} надішле вам посилання перед сесією.`,
    },
    remSubject: (c) => `Ваша сесія з ${c} — завтра о 10:00`,
    remPreview: "Посилання для приєднання всередині. До зустрічі!",
    remHeading: (cl) => `До зустрічі завтра, ${cl}!`,
    remBody: (c) =>
      `Ваша сесія з ${c} — завтра, 23 липня о 10:00 (за Києвом). Приєднуйтесь із браузера — застосунок не потрібен.`,
    remCta: "Приєднатися до сесії",
    remFallback: "Або скопіюйте це посилання у браузер:",
    remFooter: (c) => `Надіслано Praximo від імені ${c}.`,
    joinTitle: "Готові приєднатися?",
    joinWith: (c) => `Сесія з ${c}`,
    joinNotice: "Ця сесія записується та аналізується ШІ для вашого коуча.",
    joinCta: "Приєднатися",
    joinMicCam: "Перевірте камеру та мікрофон",
    sessionKindIntake: "Вступна сесія",
    minutes: (n) => `${n} хв`,
  },
  ru: {
    inviteSubject: (c) => `${c} приглашает вас на коучинговые сессии`,
    invitePreview: () => `Настройте свой профиль — это займёт минуту.`,
    inviteHeading: (c) => `${c} приглашает вас`,
    inviteBody: (c, cl) =>
      `Здравствуйте, ${cl}! ${c} использует Praximo — ассистента, который берёт на себя расписание, напоминания и видеосессии. Настройте свой профиль, чтобы начать — это займёт около минуты.`,
    inviteCta: "Настроить профиль",
    inviteFallback: "Или скопируйте эту ссылку в браузер:",
    inviteFooter: (c) =>
      `Вы получили это письмо, потому что ${c} пригласила вас в свою коучинговую практику. Если вы не знаете ${c}, просто проигнорируйте это письмо.`,
    accLanguageTitle: "Выберите язык",
    accLanguageSubtitle: (c) => `${c} пригласила вас на коучинговые сессии.`,
    accContinue: "Продолжить",
    accBack: "Назад",
    accProfileTitle: "Ваш профиль",
    accProfileSubtitle: (c) => `Так вас будет видеть ${c}.`,
    accNameLabel: "Имя",
    accAvatarLabel: "Фото",
    accAvatarHint: "Необязательно — показывается во время видеосессий",
    accUpload: "Загрузить",
    accEmailLabel: "Email",
    accEmailHint: "Необязательно — для напоминаний и ссылок на сессии",
    accGoogle: "Продолжить с Google",
    accGoogleDone: "Заполнено из Google",
    accOr: "или заполните вручную",
    accConsentTitle: "Одна вещь, требующая вашего согласия",
    accConsentIntro: (c) =>
      `Чтобы помочь ${c} готовиться к вашим сессиям, Praximo записывает и анализирует их. Вот что это значит:`,
    accConsentItems: [
      "Аудио сессий записывается.",
      "Записи анализирует ИИ; результаты получает только ваш коуч.",
      "Аудио хранится до 30 дней после транскрибирования; транскрипты и результаты анализа — пока коуч их не удалит.",
      "Обработка происходит в ЕС, кроме ИИ-анализа в США.",
      "Вы можете отозвать согласие и попросить об удалении через своего коуча в любой момент.",
    ],
    accPrivacyLink: "Политика конфиденциальности",
    accAgree: "Согласен(на)",
    accNothingSaved: "Ничего не сохраняется, пока вы не согласитесь.",
    accDoneTitle: () => `Всё готово!`,
    accDoneBody: (c) => `${c} настроила ваш профиль. Ваша первая сессия:`,
    accDoneSession: "Вводная сессия",
    accDoneReminder: {
      email: "Перед сессией мы пришлём вам напоминание со ссылкой на email.",
      manual: (c) => `${c} пришлёт вам ссылку перед сессией.`,
    },
    remSubject: (c) => `Ваша сессия с ${c} — завтра в 10:00`,
    remPreview: "Ссылка для подключения внутри. До встречи!",
    remHeading: (cl) => `До встречи завтра, ${cl}!`,
    remBody: (c) =>
      `Ваша сессия с ${c} — завтра, 23 июля в 10:00 (по Киеву). Подключайтесь из браузера — приложение не нужно.`,
    remCta: "Подключиться к сессии",
    remFallback: "Или скопируйте эту ссылку в браузер:",
    remFooter: (c) => `Отправлено Praximo от имени ${c}.`,
    joinTitle: "Готовы подключиться?",
    joinWith: (c) => `Сессия с ${c}`,
    joinNotice: "Эта сессия записывается и анализируется ИИ для вашего коуча.",
    joinCta: "Подключиться",
    joinMicCam: "Проверьте камеру и микрофон",
    sessionKindIntake: "Вводная сессия",
    minutes: (n) => `${n} мин`,
  },
}
