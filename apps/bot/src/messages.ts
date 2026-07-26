import { type CoachLanguage, DefaultCoachLanguage, narrowCoachLanguage } from "@praximo/domain"
import { makeCatalogue } from "@praximo/i18n"

/**
 * Every coach-facing line the manager bot and a not-yet-installed coach bot can
 * say, in the three languages the product supports.
 *
 * The language is the workspace owner's whenever a provisioning row is in hand.
 * The failure paths that never reach one — a made-up start parameter, a token
 * pasted by somebody with no invitation — fall back to the sender's own Telegram
 * client language, which is the only signal those updates carry.
 *
 * **Two rules hold across the whole catalogue (#164).**
 *
 * *No URLs in body text.* Every action the coach has to take is an inline
 * button. A `t.me/…?start=` payload wrapped across four lines of a phone screen
 * reads like phishing, and "press Start" is an instruction, not a control.
 *
 * *HTML everywhere, except the notification pair.* Each string below is sent
 * with `parse_mode: "HTML"`, which is what buys the bold line and the expandable
 * blockquote. {@link Copy.botRepaired} and {@link Copy.botNeedsRelink} are the
 * exception: they leave through `ManagerBotSender.sendText`, which has no
 * parse-mode channel, so they are plain text and a test keeps them that way.
 */
export interface Copy {
  readonly linkInvalid: string
  readonly linkExpired: string
  readonly linkUsed: string
  readonly setupUnavailable: string
  readonly openLinkFirst: string
  readonly setupInProgress: string
  /**
   * The message the whole setup hangs on. It answers the question the coach has
   * not asked out loud — why the bot has to be *theirs* — inside an expandable
   * blockquote, so the answer is there in full for whoever wants it and costs a
   * single line to whoever does not.
   */
  readonly invitationReserved: (workspaceName: string) => string
  readonly createBotButton: string
  /**
   * The second button on the creation prompt. The BotFather path is a minority
   * one, and as a paragraph it took a third of the message everybody reads; as a
   * button it costs nothing until it is wanted (#164).
   */
  readonly haveBotButton: string
  readonly haveBotInstructions: string
  /**
   * What the creation prompt itself becomes once the bot is connected (#134).
   * The button is gone with the keyboard, so this message has one job: to be the
   * confirmation the coach came back to that message for. Distinct from
   * `botConnected`, which arrives as its own message and points them onward — the
   * two sit next to each other in the chat and must not read as a duplicate.
   *
   * Deliberately a record rather than a conclusion. An edit keeps the timestamp
   * of the message it replaces, so this line can sit *above* a later step in the
   * history; "the bot is connected" survives that ordering, "setup finished"
   * does not (#164).
   */
  readonly promptConnected: (username: string) => string
  readonly botConnected: (username: string) => string
  /** Opens the coach's own bot from the manager chat — `botConnected`'s button. */
  readonly openBotButton: (username: string) => string
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
  /** The proof link rides on {@link Copy.proofButton}, never in this text. */
  readonly proofPrompt: (username: string) => string
  readonly proofButton: (username: string) => string
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
   * (#55). Sent once per episode, to the coach alone. **Plain text** — see the
   * module note.
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
   * then the one action that fixes it. **Plain text** — see the module note.
   *
   * `/start` is named rather than linked: Telegram renders a bare command
   * tappable on its own, which is the button this path cannot otherwise carry.
   */
  readonly botNeedsRelink: (username: string) => string
  /**
   * A client accepted their invitation (#56). Coach-facing, and the one event in
   * the whole onboarding that happens without the coach in the room — everything
   * else they learn by having done it themselves.
   *
   * Sent through the coach's **own** bot rather than the manager's, because that
   * is the chat the client just appeared in and the only one whose button can
   * open the Mini App on their route.
   */
  readonly clientAccepted: (client: {
    readonly name: string
    readonly telegramName?: string
    readonly username?: string
    readonly language: string
  }) => string
  /** The push's one button: the client's own route in the Mini App. */
  readonly openClientButton: string
  /**
   * The recovery prompt: `invitationReserved`'s counterpart for a coach coming
   * back to reconnect. No workspace name — they know whose workspace it is, and
   * nothing is being reserved for them a second time.
   */
  readonly relinkReserved: string
  /**
   * What the recovery prompt becomes once the new bot is connected. Its own
   * string because `promptConnected`'s wording is wrong for something that was
   * set up months ago and has just come back.
   */
  readonly promptReconnected: (username: string) => string
}

/**
 * A workspace name is the one interpolation somebody else typed, and it lands
 * inside `parse_mode: "HTML"`. Bot usernames need no escaping — Telegram
 * constrains them to `[A-Za-z0-9_]` — so only the free-text value goes through
 * this.
 */
export const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const en: Copy = {
  linkInvalid: "🤔 This setup link is not valid. Ask your Praximo administrator for a fresh one.",
  linkExpired:
    "⌛ This setup link has expired. Ask your Praximo administrator to reissue it — that takes them a second.",
  linkUsed:
    "✅ This setup link has already been used. If your bot has stopped working, send /start here and I will help you reconnect it.",
  setupUnavailable:
    "😕 Something went wrong starting the setup. Try again in a minute, or ask your administrator for help.",
  openLinkFirst:
    "👋 Hi! I'm Praximo. To get started, open the one-time setup link your administrator sent you — it brings you right back here.",
  setupInProgress:
    "⏳ This setup is already running. Telegram will finish the saved configuration on its own — there is nothing for you to do.",
  invitationReserved: (workspaceName) =>
    `🎉 <b>This invitation is now yours</b>${
      workspaceName.length === 0 ? "" : ` (“${escapeHtml(workspaceName)}”)`
    }.\n\nOne step is left: your own coach bot. It carries your name and your photo, and it is the bot your clients will write to.\n\n<blockquote expandable>Why a bot of your own?\nYour clients never see Praximo — they see you. The bot is your address in Telegram: it takes bookings, sends reminders and keeps your notes, around the clock and under your name. Only you can create it, because only you can own it.</blockquote>\n\n👇 Tap <b>Create my bot</b>. Telegram asks for two things — a name (I have suggested one, change it freely) and a username ending in “bot”. About a minute, and I take over from there.\n\nNothing expires while you think it over: come back to this chat whenever you like.`,
  createBotButton: "🤖 Create my bot",
  haveBotButton: "🔑 I already have a bot",
  haveBotInstructions:
    "🔑 <b>Connecting a bot you already have</b>\n\n1️⃣ Open @BotFather\n2️⃣ Send /mybots and pick your bot\n3️⃣ Tap <b>API Token</b>\n4️⃣ Send that token here, in this chat\n\n🔒 I delete your message the moment it arrives — a token controls the bot, so it should never sit in a chat.",
  promptConnected: (username) =>
    `✅ <b>@${username}</b> is created and connected to your workspace.`,
  botConnected: (username) =>
    `🎉 <b>Setup finished — @${username} is live.</b>\n\nThat bot is where your coaching happens now: your clients, your schedule, your notes. This chat stays for setup and support only, so feel free to mute it.`,
  openBotButton: (username) => `🚀 Open @${username}`,
  extraBotNotConnected: (username) =>
    `✅ <b>Your workspace is fine</b> — your coach bot is still connected and working.\n\n@${username} is a second bot, and it is not connected to Praximo. Nothing needs fixing on your side.\n\nIf you would rather not keep it, delete @${username} in @BotFather. Only you can do that — we cannot do it for you.`,
  tokenNoActiveSetup:
    "🔑 I can only connect a bot to an invitation. Open the one-time Praximo setup link your administrator sent you first, then send the token.",
  tokenInvalid:
    "🤔 Telegram did not accept that token.\n\nIt looks like <code>1234567890:AA…</code> — copy the whole line from @BotFather (/mybots → your bot → <b>API Token</b>) and send it again.",
  tokenBotTaken:
    "🔒 That bot is already connected to a Praximo workspace. Pick a different one in @BotFather, or create a new bot.",
  tokenNotDeleted:
    "⚠️ <b>I could not delete your message, and it contains your bot token.</b> Please delete it yourself — anyone who reads it can take the bot over.",
  tokenSetupFailed: "😕 That bot could not be set up. Send the token again and I will retry.",
  proofPrompt: (username) =>
    `✅ <b>@${username} looks good</b> — Telegram accepted the token.\n\nOne last step, and it is the security one: show me the bot is yours. Open it and press <b>Start</b>, and I will connect it to your workspace right away.`,
  proofButton: (username) => `👉 Open @${username}`,
  proofIdentityMismatch:
    "🔒 This confirmation link belongs to somebody else's Praximo setup. Ask your administrator for your own setup link.",
  proofLinkRequired:
    "👋 Hi! To finish connecting this bot, open the confirmation link the Praximo manager bot sent you.",
  botSettingUp:
    "⏳ <b>Setting your bot up…</b>\n\nA few seconds. Nothing for you to do — stay right here.",
  botReady:
    "✨ <b>Praximo is ready.</b>\n\nEverything happens inside this bot from here on. Open it and I will show you around.",
  openButton: "🚀 Open Praximo",
  botRepaired: (username) =>
    `🔧 The connection to your coach bot @${username} broke and has been restored automatically.\n\nNothing was lost and there is nothing for you to do.\n\nIf you wanted to disconnect the bot, delete it in @BotFather or ask your administrator — that is the only way.`,
  botNeedsRelink: (username) =>
    `⚠️ Your coach bot @${username} has stopped working — Telegram no longer accepts its token.\n\nNothing in your workspace is lost: your clients, your sessions and your notes are all there.\n\nSend /start here and I will help you reconnect it. It takes about a minute.`,
  relinkReserved:
    "🔄 <b>Let's get your bot back.</b>\n\nEverything in your workspace is exactly where you left it — clients, sessions, notes. Only the connection to Telegram needs rebuilding.\n\n👇 Tap <b>Create my bot</b> and Telegram will walk you through it. Already have a bot ready? The second button is for you.",
  promptReconnected: (username) => `✅ <b>@${username}</b> is reconnected and working again.`,
  clientAccepted: (client) =>
    `<b>${client.name} is in.</b>\n\nAccepted as ${
      client.telegramName ?? client.name
    }${client.username === undefined ? "" : ` (@${client.username})`}, writing in ${client.language}.`,
  openClientButton: "Open their card",
}

const uk: Copy = {
  linkInvalid:
    "🤔 Це посилання для налаштування недійсне. Попросіть адміністратора Praximo надіслати нове.",
  linkExpired:
    "⌛ Термін дії цього посилання минув. Попросіть адміністратора Praximo видати його заново — це справа секунди.",
  linkUsed:
    "✅ Це посилання для налаштування вже використано. Якщо ваш бот перестав працювати, надішліть /start сюди — і я допоможу підключити його знову.",
  setupUnavailable:
    "😕 Щось пішло не так на початку налаштування. Спробуйте ще раз за хвилину або зверніться до адміністратора.",
  openLinkFirst:
    "👋 Вітаю! Я — Praximo. Щоб почати, відкрийте одноразове посилання, яке надіслав вам адміністратор, — воно поверне вас просто сюди.",
  setupInProgress:
    "⏳ Це налаштування вже триває. Telegram сам завершить збережену конфігурацію — робити нічого не потрібно.",
  invitationReserved: (workspaceName) =>
    `🎉 <b>Це запрошення тепер ваше</b>${
      workspaceName.length === 0 ? "" : ` («${escapeHtml(workspaceName)}»)`
    }.\n\nЛишився один крок: ваш власний бот. Він носить ваше ім'я та ваше фото — саме йому писатимуть ваші клієнти.\n\n<blockquote expandable>Навіщо власний бот?\nВаші клієнти не бачать Praximo — вони бачать вас. Бот стає вашою адресою в Telegram: приймає записи, надсилає нагадування та зберігає ваші нотатки — цілодобово й під вашим ім'ям. Створити його можете лише ви, бо володіти ним можете лише ви.</blockquote>\n\n👇 Натисніть <b>Створити бота</b>. Telegram запитає дві речі — назву (я вже пропоную варіант, змінюйте вільно) та адресу, що закінчується на «bot». Хвилина — і далі все роблю я.\n\nНічого не згорить, поки ви думаєте: повертайтеся в цей чат коли завгодно.`,
  createBotButton: "🤖 Створити бота",
  haveBotButton: "🔑 У мене вже є бот",
  haveBotInstructions:
    "🔑 <b>Як підключити бота, який у вас уже є</b>\n\n1️⃣ Відкрийте @BotFather\n2️⃣ Надішліть /mybots і виберіть свого бота\n3️⃣ Натисніть <b>API Token</b>\n4️⃣ Надішліть цей токен сюди, у цей чат\n\n🔒 Я видалю ваше повідомлення одразу, щойно воно надійде: токен керує ботом, тож йому не місце в чаті.",
  promptConnected: (username) =>
    `✅ <b>@${username}</b> створено та підключено до вашого простору.`,
  botConnected: (username) =>
    `🎉 <b>Налаштування завершено — @${username} працює.</b>\n\nТепер уся робота відбувається саме там: ваші клієнти, ваш розклад, ваші нотатки. Цей чат лишається тільки для налаштування та підтримки — його можна приглушити.`,
  openBotButton: (username) => `🚀 Відкрити @${username}`,
  extraBotNotConnected: (username) =>
    `✅ <b>З вашим простором усе гаразд</b> — ваш бот і далі підключений та працює.\n\n@${username} — це другий бот, і він не підключений до Praximo. Виправляти нічого не потрібно.\n\nЯкщо він вам не потрібен, видаліть @${username} у @BotFather. Це можете зробити лише ви — ми не можемо зробити це за вас.`,
  tokenNoActiveSetup:
    "🔑 Я можу підключити бота лише до запрошення. Спершу відкрийте одноразове посилання Praximo від адміністратора, а вже потім надсилайте токен.",
  tokenInvalid:
    "🤔 Telegram не прийняв цей токен.\n\nВін має вигляд <code>1234567890:AA…</code> — скопіюйте рядок повністю з @BotFather (/mybots → ваш бот → <b>API Token</b>) і надішліть ще раз.",
  tokenBotTaken:
    "🔒 Цього бота вже підключено до простору Praximo. Виберіть іншого в @BotFather або створіть нового.",
  tokenNotDeleted:
    "⚠️ <b>Не вдалося видалити ваше повідомлення, а в ньому токен вашого бота.</b> Будь ласка, видаліть його самі — той, хто його прочитає, зможе заволодіти ботом.",
  tokenSetupFailed:
    "😕 Не вдалося налаштувати цього бота. Надішліть токен ще раз, і я спробую знову.",
  proofPrompt: (username) =>
    `✅ <b>З @${username} усе гаразд</b> — Telegram прийняв токен.\n\nЛишився останній крок, і він про безпеку: підтвердіть, що бот ваш. Відкрийте його та натисніть <b>Start</b> — і я одразу підключу його до вашого простору.`,
  proofButton: (username) => `👉 Відкрити @${username}`,
  proofIdentityMismatch:
    "🔒 Це посилання підтвердження належить чужому налаштуванню Praximo. Попросіть адміністратора надіслати вам власне посилання.",
  proofLinkRequired:
    "👋 Вітаю! Щоб завершити підключення цього бота, відкрийте посилання підтвердження, яке надіслав вам бот-менеджер Praximo.",
  botSettingUp:
    "⏳ <b>Налаштовую вашого бота…</b>\n\nКілька секунд. Робити нічого не потрібно — залишайтеся тут.",
  botReady:
    "✨ <b>Praximo готовий.</b>\n\nВідтепер усе відбувається всередині цього бота. Відкривайте — і я все покажу.",
  openButton: "🚀 Відкрити Praximo",
  botRepaired: (username) =>
    `🔧 Зв'язок із вашим ботом @${username} перервався й відновлено автоматично.\n\nНічого не втрачено, робити нічого не потрібно.\n\nЯкщо ви хотіли відключити бота — видаліть його в @BotFather або зверніться до адміністратора, іншого способу немає.`,
  botNeedsRelink: (username) =>
    `⚠️ Ваш бот @${username} перестав працювати — Telegram більше не приймає його токен.\n\nУ вашому просторі нічого не втрачено: клієнти, сесії та нотатки на місці.\n\nНадішліть /start сюди — і я допоможу підключити бота знову. Це триває близько хвилини.`,
  relinkReserved:
    "🔄 <b>Повернімо вашого бота.</b>\n\nУ вашому просторі все саме там, де ви лишили: клієнти, сесії, нотатки. Відновити треба лише зв'язок із Telegram.\n\n👇 Натисніть <b>Створити бота</b> — і Telegram усе підкаже. Уже маєте готового бота? Тоді вам до другої кнопки.",
  promptReconnected: (username) => `✅ <b>@${username}</b> знову підключено, і він працює.`,
  clientAccepted: (client) =>
    `<b>${client.name}: запрошення прийнято.</b>\n\nПрийнято як ${
      client.telegramName ?? client.name
    }${client.username === undefined ? "" : ` (@${client.username})`}, мова спілкування — ${client.language}.`,
  openClientButton: "Відкрити картку",
}

const ru: Copy = {
  linkInvalid:
    "🤔 Эта ссылка для настройки недействительна. Попросите администратора Praximo прислать новую.",
  linkExpired:
    "⌛ Срок действия этой ссылки истёк. Попросите администратора Praximo выдать её заново — это секундное дело.",
  linkUsed:
    "✅ Эта ссылка для настройки уже использована. Если ваш бот перестал работать, отправьте /start сюда — и я помогу подключить его заново.",
  setupUnavailable:
    "😕 Что-то пошло не так в начале настройки. Попробуйте ещё раз через минуту или обратитесь к администратору.",
  openLinkFirst:
    "👋 Привет! Я — Praximo. Чтобы начать, откройте одноразовую ссылку, которую прислал вам администратор, — она вернёт вас прямо сюда.",
  setupInProgress:
    "⏳ Эта настройка уже идёт. Telegram сам завершит сохранённую конфигурацию — делать ничего не нужно.",
  invitationReserved: (workspaceName) =>
    `🎉 <b>Это приглашение теперь ваше</b>${
      workspaceName.length === 0 ? "" : ` («${escapeHtml(workspaceName)}»)`
    }.\n\nОстался один шаг: ваш собственный бот. Он носит ваше имя и вашу фотографию — именно ему будут писать ваши клиенты.\n\n<blockquote expandable>Зачем нужен свой бот?\nВаши клиенты не видят Praximo — они видят вас. Бот становится вашим адресом в Telegram: принимает записи, присылает напоминания и хранит ваши заметки — круглосуточно и под вашим именем. Создать его можете только вы, потому что владеть им можете только вы.</blockquote>\n\n👇 Нажмите <b>Создать бота</b>. Telegram спросит две вещи — название (я уже предлагаю вариант, меняйте свободно) и адрес, который заканчивается на «bot». Минута — и дальше всё делаю я.\n\nПока вы думаете, ничего не сгорит: возвращайтесь в этот чат когда угодно.`,
  createBotButton: "🤖 Создать бота",
  haveBotButton: "🔑 У меня уже есть бот",
  haveBotInstructions:
    "🔑 <b>Как подключить бота, который у вас уже есть</b>\n\n1️⃣ Откройте @BotFather\n2️⃣ Отправьте /mybots и выберите своего бота\n3️⃣ Нажмите <b>API Token</b>\n4️⃣ Пришлите этот токен сюда, в этот чат\n\n🔒 Я удалю ваше сообщение сразу, как только оно придёт: токен управляет ботом, и ему не место в чате.",
  promptConnected: (username) => `✅ <b>@${username}</b> создан и подключён к вашему пространству.`,
  botConnected: (username) =>
    `🎉 <b>Настройка завершена — @${username} работает.</b>\n\nТеперь вся работа происходит именно там: ваши клиенты, ваше расписание, ваши заметки. Этот чат остаётся только для настройки и поддержки — его можно приглушить.`,
  openBotButton: (username) => `🚀 Открыть @${username}`,
  extraBotNotConnected: (username) =>
    `✅ <b>С вашим пространством всё в порядке</b> — ваш бот по-прежнему подключён и работает.\n\n@${username} — это второй бот, и он не подключён к Praximo. Исправлять ничего не нужно.\n\nЕсли он вам не нужен, удалите @${username} в @BotFather. Это можете сделать только вы — мы не можем сделать это за вас.`,
  tokenNoActiveSetup:
    "🔑 Я могу подключить бота только к приглашению. Сначала откройте одноразовую ссылку Praximo от администратора, а потом присылайте токен.",
  tokenInvalid:
    "🤔 Telegram не принял этот токен.\n\nОн выглядит так: <code>1234567890:AA…</code> — скопируйте строку целиком из @BotFather (/mybots → ваш бот → <b>API Token</b>) и пришлите ещё раз.",
  tokenBotTaken:
    "🔒 Этот бот уже подключён к пространству Praximo. Выберите другого в @BotFather или создайте нового.",
  tokenNotDeleted:
    "⚠️ <b>Не удалось удалить ваше сообщение, а в нём токен вашего бота.</b> Пожалуйста, удалите его сами — тот, кто его прочитает, сможет завладеть ботом.",
  tokenSetupFailed:
    "😕 Не удалось настроить этого бота. Пришлите токен ещё раз, и я попробую снова.",
  proofPrompt: (username) =>
    `✅ <b>С @${username} всё в порядке</b> — Telegram принял токен.\n\nОстался последний шаг, и он про безопасность: подтвердите, что бот ваш. Откройте его и нажмите <b>Start</b> — и я сразу подключу его к вашему пространству.`,
  proofButton: (username) => `👉 Открыть @${username}`,
  proofIdentityMismatch:
    "🔒 Эта ссылка подтверждения принадлежит чужой настройке Praximo. Попросите администратора прислать вам вашу собственную ссылку.",
  proofLinkRequired:
    "👋 Привет! Чтобы завершить подключение этого бота, откройте ссылку подтверждения, которую прислал вам бот-менеджер Praximo.",
  botSettingUp:
    "⏳ <b>Настраиваю вашего бота…</b>\n\nНесколько секунд. Делать ничего не нужно — оставайтесь здесь.",
  botReady:
    "✨ <b>Praximo готов.</b>\n\nОтныне всё происходит внутри этого бота. Открывайте — и я всё покажу.",
  openButton: "🚀 Открыть Praximo",
  botRepaired: (username) =>
    `🔧 Связь с вашим ботом @${username} прервалась и восстановлена автоматически.\n\nНичего не потеряно, делать ничего не нужно.\n\nЕсли вы хотели отключить бота — удалите его в @BotFather или обратитесь к администратору, другого способа нет.`,
  botNeedsRelink: (username) =>
    `⚠️ Ваш бот @${username} перестал работать — Telegram больше не принимает его токен.\n\nВ вашем пространстве ничего не потеряно: клиенты, сессии и заметки на месте.\n\nОтправьте /start сюда — и я помогу подключить бота заново. Это займёт около минуты.`,
  relinkReserved:
    "🔄 <b>Вернём вашего бота.</b>\n\nВ вашем пространстве всё ровно там, где вы оставили: клиенты, сессии, заметки. Восстановить нужно только связь с Telegram.\n\n👇 Нажмите <b>Создать бота</b> — и Telegram всё подскажет. Уже есть готовый бот? Тогда вам ко второй кнопке.",
  promptReconnected: (username) => `✅ <b>@${username}</b> снова подключён и работает.`,
  clientAccepted: (client) =>
    `<b>${client.name}: приглашение принято.</b>\n\nПринято как ${
      client.telegramName ?? client.name
    }${client.username === undefined ? "" : ` (@${client.username})`}, язык общения — ${client.language}.`,
  openClientButton: "Открыть карточку",
}

/** Exported for the test that resolves every locale strictly — see below. */
export const botCatalog: Record<CoachLanguage, Copy> = { en, uk, ru }

export const DefaultLanguage: CoachLanguage = DefaultCoachLanguage

export const CatalogueFile = "apps/bot/src/messages.ts"

/**
 * The catalogue, gap-filled against English through the shared mechanism
 * (#167). Until now this Worker indexed the record directly, so a field somebody
 * blanked while editing reached a coach as an empty message — the half of #130
 * the Mini App got and the bot did not.
 *
 * **Not strict**, deliberately. A Worker has no development build to fail in, and
 * `import.meta.env.DEV` does not survive a wrangler bundle at all. The strict
 * half runs in `messages.test.ts`, which resolves all three locales with gaps
 * fatal — so a blank cannot be committed, and a blank that somehow ships still
 * renders English rather than nothing.
 */
const resolve = makeCatalogue<Copy>({
  reference: DefaultLanguage,
  byLocale: botCatalog,
  strict: false,
  where: CatalogueFile,
})

export const messages = (language: CoachLanguage = DefaultLanguage): Copy => resolve(language)

/**
 * The sender's Telegram client language, narrowed to what the product speaks.
 * Only a fallback: a workspace that already carries the coach's chosen language
 * always wins over the client's regional tag.
 *
 * The narrowing itself belongs to the domain, so the Mini App resolves `uk-UA`
 * to the same thing this does (#130).
 */
export const clientLanguage = narrowCoachLanguage
