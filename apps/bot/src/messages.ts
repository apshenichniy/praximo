import { CoachLanguage } from "@praximo/domain"

/**
 * Every coach-facing line the manager bot and a not-yet-installed coach bot can
 * say, in the three languages the product supports.
 *
 * The language is the workspace owner's whenever a provisioning row is in hand.
 * The failure paths that never reach one — a made-up start parameter, a token
 * pasted by somebody with no invitation — fall back to the sender's own Telegram
 * client language, which is the only signal those updates carry.
 */
export interface Copy {
  readonly linkInvalid: string
  readonly linkExpired: string
  readonly linkUsed: string
  readonly setupUnavailable: string
  readonly openLinkFirst: string
  readonly setupInProgress: string
  readonly invitationReserved: (workspaceName: string) => string
  readonly createBotButton: string
  readonly botConnected: (username: string) => string
  readonly tokenNoActiveSetup: string
  readonly tokenInvalid: string
  readonly tokenBotTaken: string
  readonly tokenNotDeleted: string
  readonly tokenSetupFailed: string
  readonly proofPrompt: (username: string, link: string) => string
  readonly proofIdentityMismatch: string
  readonly proofLinkRequired: string
  readonly botReady: string
  readonly openButton: string
}

const en: Copy = {
  linkInvalid: "This setup link is invalid. Ask your Praximo administrator for a fresh link.",
  linkExpired: "This setup link has expired. Ask your Praximo administrator to reissue it.",
  linkUsed: "This setup link has already been used.",
  setupUnavailable:
    "Bot setup could not be started. Please try again or ask your administrator for help.",
  openLinkFirst: "Open the one-time Praximo setup link sent by your administrator.",
  setupInProgress:
    "This bot setup is already in progress. Telegram will retry the saved configuration automatically.",
  invitationReserved: (workspaceName) =>
    `This invitation is now reserved for you${
      workspaceName.length === 0 ? "" : ` (“${workspaceName}”)`
    }. Create your coach bot to finish the setup — you can come back to this chat and continue any time.\n\nAlready have a bot? Send me its @BotFather token in this chat instead and I will connect it.`,
  createBotButton: "Create coach bot",
  botConnected: (username) => `Your coach bot @${username} is connected. Open it to continue.`,
  tokenNoActiveSetup:
    "Open the one-time Praximo setup link sent by your administrator before sending a bot token.",
  tokenInvalid:
    "Telegram did not accept that token. Copy the whole token from @BotFather and send it again.",
  tokenBotTaken: "That bot is already connected to a Praximo workspace.",
  tokenNotDeleted:
    "I could not delete your message — please delete it yourself, it contains your bot token.",
  tokenSetupFailed: "That bot could not be set up. Send the token again to retry.",
  proofPrompt: (username, link) =>
    `@${username} looks good. Confirm it is yours: open ${link} and press Start in that bot to finish the setup.`,
  proofIdentityMismatch:
    "This confirmation link belongs to somebody else's Praximo setup. Ask your administrator for your own setup link.",
  proofLinkRequired:
    "Open the confirmation link the Praximo manager bot sent you to finish connecting this bot.",
  botReady: "Praximo is ready.",
  openButton: "Open",
}

const uk: Copy = {
  linkInvalid:
    "Це посилання для налаштування недійсне. Попросіть адміністратора Praximo надіслати нове.",
  linkExpired:
    "Термін дії цього посилання минув. Попросіть адміністратора Praximo видати його заново.",
  linkUsed: "Це посилання для налаштування вже використано.",
  setupUnavailable:
    "Не вдалося розпочати налаштування бота. Спробуйте ще раз або зверніться до адміністратора.",
  openLinkFirst: "Відкрийте одноразове посилання Praximo, яке надіслав вам адміністратор.",
  setupInProgress:
    "Налаштування цього бота вже триває. Telegram автоматично повторить збережену конфігурацію.",
  invitationReserved: (workspaceName) =>
    `Це запрошення тепер закріплене за вами${
      workspaceName.length === 0 ? "" : ` («${workspaceName}»)`
    }. Створіть свого бота, щоб завершити налаштування — ви можете повернутися до цього чату будь-коли.\n\nУже маєте бота? Надішліть мені його токен із @BotFather просто в цей чат, і я підключу його.`,
  createBotButton: "Створити бота",
  botConnected: (username) => `Ваш бот @${username} підключено. Відкрийте його, щоб продовжити.`,
  tokenNoActiveSetup:
    "Спершу відкрийте одноразове посилання Praximo від адміністратора, а вже потім надсилайте токен бота.",
  tokenInvalid:
    "Telegram не прийняв цей токен. Скопіюйте його повністю з @BotFather і надішліть ще раз.",
  tokenBotTaken: "Цього бота вже підключено до простору Praximo.",
  tokenNotDeleted:
    "Не вдалося видалити ваше повідомлення — видаліть його самі, воно містить токен бота.",
  tokenSetupFailed: "Не вдалося налаштувати цього бота. Надішліть токен ще раз, щоб повторити.",
  proofPrompt: (username, link) =>
    `З @${username} усе гаразд. Підтвердіть, що бот ваш: відкрийте ${link} і натисніть «Start» у цьому боті, щоб завершити налаштування.`,
  proofIdentityMismatch:
    "Це посилання підтвердження належить чужому налаштуванню Praximo. Попросіть адміністратора надіслати вам власне посилання.",
  proofLinkRequired:
    "Відкрийте посилання підтвердження, яке надіслав вам бот-менеджер Praximo, щоб завершити підключення.",
  botReady: "Praximo готовий.",
  openButton: "Відкрити",
}

const ru: Copy = {
  linkInvalid:
    "Эта ссылка для настройки недействительна. Попросите администратора Praximo прислать новую.",
  linkExpired:
    "Срок действия этой ссылки истёк. Попросите администратора Praximo выдать её заново.",
  linkUsed: "Эта ссылка для настройки уже использована.",
  setupUnavailable:
    "Не удалось начать настройку бота. Попробуйте ещё раз или обратитесь к администратору.",
  openLinkFirst: "Откройте одноразовую ссылку Praximo, которую прислал вам администратор.",
  setupInProgress:
    "Настройка этого бота уже идёт. Telegram автоматически повторит сохранённую конфигурацию.",
  invitationReserved: (workspaceName) =>
    `Это приглашение теперь закреплено за вами${
      workspaceName.length === 0 ? "" : ` («${workspaceName}»)`
    }. Создайте своего бота, чтобы завершить настройку — вы можете вернуться в этот чат в любой момент.\n\nУже есть бот? Пришлите мне его токен из @BotFather прямо в этот чат, и я подключу его.`,
  createBotButton: "Создать бота",
  botConnected: (username) => `Ваш бот @${username} подключён. Откройте его, чтобы продолжить.`,
  tokenNoActiveSetup:
    "Сначала откройте одноразовую ссылку Praximo от администратора, а потом присылайте токен бота.",
  tokenInvalid:
    "Telegram не принял этот токен. Скопируйте его целиком из @BotFather и пришлите ещё раз.",
  tokenBotTaken: "Этот бот уже подключён к пространству Praximo.",
  tokenNotDeleted: "Не удалось удалить ваше сообщение — удалите его сами, оно содержит токен бота.",
  tokenSetupFailed: "Не удалось настроить этого бота. Пришлите токен ещё раз, чтобы повторить.",
  proofPrompt: (username, link) =>
    `С @${username} всё в порядке. Подтвердите, что бот ваш: откройте ${link} и нажмите «Start» в этом боте, чтобы завершить настройку.`,
  proofIdentityMismatch:
    "Эта ссылка подтверждения принадлежит чужой настройке Praximo. Попросите администратора прислать вам вашу собственную ссылку.",
  proofLinkRequired:
    "Откройте ссылку подтверждения, которую прислал вам бот-менеджер Praximo, чтобы завершить подключение.",
  botReady: "Praximo готов.",
  openButton: "Открыть",
}

const catalog: Record<CoachLanguage, Copy> = { en, uk, ru }

export const DefaultLanguage: CoachLanguage = CoachLanguage.make("en")

export const messages = (language: CoachLanguage = DefaultLanguage): Copy => catalog[language]

/**
 * The sender's Telegram client language, narrowed to what the product speaks.
 * Only a fallback: a workspace that already carries the coach's chosen language
 * always wins over the client's regional tag.
 */
export const clientLanguage = (languageCode: string | undefined): CoachLanguage => {
  const base = (languageCode ?? "").toLowerCase().split("-")[0] ?? ""
  return base === "uk" || base === "ru" ? CoachLanguage.make(base) : DefaultLanguage
}
