import { type CoachLanguage, DefaultCoachLanguage, narrowCoachLanguage } from "@praximo/domain"

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
  /**
   * What the creation prompt itself becomes once the bot is connected (#134).
   * The button is gone with the keyboard, so this message has one job: to be the
   * confirmation the coach came back to that message for. Distinct from
   * `botConnected`, which arrives as its own message and points them onward — the
   * two sit next to each other in the chat and must not read as a duplicate.
   */
  readonly promptConnected: (username: string) => string
  readonly botConnected: (username: string) => string
  /**
   * A bot the coach created that we did not connect, because their setup was
   * already finished (#135). Reassurance first — nothing is broken, and that is
   * the question they actually have — then the bot by username, then the
   * optional cleanup. Never an error, and never a request to fix anything.
   */
  readonly extraBotNotConnected: (username: string) => string
  readonly tokenNoActiveSetup: string
  readonly tokenInvalid: string
  readonly tokenBotTaken: string
  readonly tokenNotDeleted: string
  readonly tokenSetupFailed: string
  readonly proofPrompt: (username: string, link: string) => string
  readonly proofIdentityMismatch: string
  readonly proofLinkRequired: string
  /**
   * The first thing the coach's own bot says, sent while it is still being
   * configured (#154).
   *
   * Telegram offers a **Start bot** button the moment the bot exists, so the
   * coach taps it seconds before there is anything to answer with. This is what
   * they see instead of an empty chat; it becomes `botReady` in place once
   * activation completes, so it has to read as a step and not as a state.
   */
  readonly botSettingUp: string
  readonly botReady: string
  readonly openButton: string
  /**
   * A coach bot whose credential Telegram had stopped accepting, put back
   * together from the manager's own management rights before anybody noticed
   * (#55). Sent once per episode, to the coach alone.
   *
   * It names the deliberate gesture on purpose. A coach who ran `/revoke`
   * meaning to disconnect will otherwise watch it heal and revoke again; the
   * only ways out are @BotFather or their administrator, and saying so is what
   * stops the loop.
   */
  readonly botRepaired: (username: string) => string
  /**
   * The bot is beyond repair — deleted, or never ours to manage. Reassurance
   * first, because the coach's real question is what happened to their data,
   * then the one action that fixes it.
   */
  readonly botNeedsRelink: (username: string) => string
  /**
   * The recovery prompt: `invitationReserved`'s counterpart for a coach coming
   * back to reconnect. No workspace name — they know whose workspace it is, and
   * nothing is being reserved for them a second time.
   */
  readonly relinkReserved: string
  /**
   * What the recovery prompt becomes once the new bot is connected. Its own
   * string because `promptConnected`'s "Setup finished" is wrong for something
   * that was set up months ago and has just come back.
   */
  readonly promptReconnected: (username: string) => string
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
  promptConnected: (username) => `Setup finished — your coach bot @${username} is connected.`,
  botConnected: (username) => `Your coach bot @${username} is connected. Open it to continue.`,
  extraBotNotConnected: (username) =>
    `Your workspace is fine — your coach bot is still connected and working.\n\n@${username} is a second bot, and it is not connected to Praximo. Nothing needs fixing on your side.\n\nIf you would rather not keep it, delete @${username} in @BotFather. We cannot remove it for you — only you can.`,
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
  botSettingUp: "Setting your bot up — this takes a few seconds.",
  botReady: "Praximo is ready.",
  openButton: "Open",
  botRepaired: (username) =>
    `The connection to your coach bot @${username} broke and has been restored automatically. Nothing was lost and there is nothing for you to do. If you wanted to disconnect the bot, delete it in @BotFather or ask your administrator — that is the only way.`,
  botNeedsRelink: (username) =>
    `Your coach bot @${username} has stopped working — Telegram no longer accepts its token. Nothing in your workspace is lost. Send /start in this chat to reconnect it.`,
  relinkReserved:
    "Let's reconnect your coach bot. Create a new one with the button below — or send me a token from @BotFather for a bot you already have.",
  promptReconnected: (username) => `Reconnected — your coach bot @${username} is working again.`,
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
  promptConnected: (username) => `Налаштування завершено — бота @${username} підключено.`,
  botConnected: (username) => `Ваш бот @${username} підключено. Відкрийте його, щоб продовжити.`,
  extraBotNotConnected: (username) =>
    `З вашим простором усе гаразд — ваш бот і далі підключений та працює.\n\n@${username} — це другий бот, і він не підключений до Praximo. Виправляти нічого не потрібно.\n\nЯкщо він вам не потрібен, видаліть @${username} у @BotFather. Ми не можемо зробити це за вас — це можете зробити лише ви.`,
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
  botSettingUp: "Налаштовую вашого бота — це триває кілька секунд.",
  botReady: "Praximo готовий.",
  openButton: "Відкрити",
  botRepaired: (username) =>
    `Зв'язок із вашим ботом @${username} перервався й відновлено автоматично. Нічого не втрачено, робити нічого не потрібно. Якщо ви хотіли відключити бота — видаліть його в @BotFather або зверніться до адміністратора, іншого способу немає.`,
  botNeedsRelink: (username) =>
    `Ваш бот @${username} перестав працювати — Telegram більше не приймає його токен. Дані у вашому просторі збережено. Надішліть /start у цей чат, щоб підключити бота знову.`,
  relinkReserved:
    "Підключімо вашого бота знову. Створіть нового за кнопкою нижче — або надішліть мені токен із @BotFather для бота, який у вас уже є.",
  promptReconnected: (username) => `Підключення відновлено — бот @${username} знову працює.`,
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
  promptConnected: (username) => `Настройка завершена — бот @${username} подключён.`,
  botConnected: (username) => `Ваш бот @${username} подключён. Откройте его, чтобы продолжить.`,
  extraBotNotConnected: (username) =>
    `С вашим пространством всё в порядке — ваш бот по-прежнему подключён и работает.\n\n@${username} — это второй бот, и он не подключён к Praximo. Исправлять ничего не нужно.\n\nЕсли он вам не нужен, удалите @${username} в @BotFather. Мы не можем сделать это за вас — это можете сделать только вы.`,
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
  botSettingUp: "Настраиваю вашего бота — это займёт несколько секунд.",
  botReady: "Praximo готов.",
  openButton: "Открыть",
  botRepaired: (username) =>
    `Связь с вашим ботом @${username} прервалась и восстановлена автоматически. Ничего не потеряно, делать ничего не нужно. Если вы хотели отключить бота — удалите его в @BotFather или обратитесь к администратору, другого способа нет.`,
  botNeedsRelink: (username) =>
    `Ваш бот @${username} перестал работать — Telegram больше не принимает его токен. Данные в вашем пространстве сохранены. Отправьте /start в этот чат, чтобы подключить бота заново.`,
  relinkReserved:
    "Подключим вашего бота заново. Создайте нового по кнопке ниже — или пришлите мне токен из @BotFather для бота, который у вас уже есть.",
  promptReconnected: (username) => `Подключение восстановлено — бот @${username} снова работает.`,
}

const catalog: Record<CoachLanguage, Copy> = { en, uk, ru }

export const DefaultLanguage: CoachLanguage = DefaultCoachLanguage

export const messages = (language: CoachLanguage = DefaultLanguage): Copy => catalog[language]

/**
 * The sender's Telegram client language, narrowed to what the product speaks.
 * Only a fallback: a workspace that already carries the coach's chosen language
 * always wins over the client's regional tag.
 *
 * The narrowing itself belongs to the domain, so the Mini App resolves `uk-UA`
 * to the same thing this does (#130).
 */
export const clientLanguage = narrowCoachLanguage
