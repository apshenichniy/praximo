// PROTOTYPE — mock data for Mini App screens (wayfinder #15).
// In-memory only, nothing persists. Times are relative to "now" at page load.

export type ArtifactKind = "brief" | "debrief" | "mentor_review";
export type ArtifactStatus = "ready" | "generating" | "failed" | "skipped";

export type Artifact = {
  kind: ArtifactKind;
  status: ArtifactStatus;
  version: number;
  content?: string;
};

export type ChannelKind = "telegram" | "email" | "manual";

export type Client = {
  id: string;
  name: string;
  initials: string;
  channel: ChannelKind;
  language: "ru" | "uk" | "en";
  consent: "active" | "pending";
  invitePending?: boolean;
  color: string;
  goal: string;
};

export type SessionState =
  "scheduled" | "in_progress" | "completed" | "cancelled";

export type Session = {
  id: string;
  clientId: string;
  kind: "intake" | "regular";
  start: Date;
  durationMin: number;
  state: SessionState;
  closeReason?: string;
  cancelReason?: "coach_cancelled" | "no_show";
  noShowDetail?:
    "both_absent" | "coach_absent" | "client_absent" | "no_overlap";
  artifacts: Array<Artifact>;
};

const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

const at = (offsetMs: number, h: number, m = 0) => {
  const d = new Date(now + offsetMs);
  d.setHours(h, m, 0, 0);
  return d;
};

export const coach = { name: "Александра", initials: "АП" };

export const clients: Array<Client> = [
  {
    id: "c-marina",
    name: "Марина Ковальчук",
    initials: "МК",
    channel: "telegram",
    language: "ru",
    consent: "active",
    color: "violet",
    goal: "Переход на руководящую роль",
  },
  {
    id: "c-olha",
    name: "Ольга Ткаченко",
    initials: "ОТ",
    channel: "email",
    language: "uk",
    consent: "active",
    color: "emerald",
    goal: "Баланс работы и жизни",
  },
  {
    id: "c-sergey",
    name: "Сергей Волков",
    initials: "СВ",
    channel: "manual",
    language: "ru",
    consent: "active",
    color: "amber",
    goal: "Запуск собственного проекта",
  },
  {
    id: "c-anna",
    name: "Анна Лебедева",
    initials: "АЛ",
    channel: "telegram",
    language: "ru",
    consent: "pending",
    invitePending: true,
    color: "sky",
    goal: "—",
  },
];

const briefMd = `**Контекст.** Восьмая сессия. В прошлый раз Марина решила поговорить с CTO о границах ответственности — договорённость: подготовить тезисы до пятницы.

**Динамика.** Последние две сессии — сдвиг от «мне надо всех спасать» к «я выбираю, где я нужна». В дебрифе №7 отмечена незакрытая тема страха делегирования.

**Возможные фокусы.**
- Как прошёл разговор с CTO; что Марина узнала о своих границах
- Страх делегирования: вернуться, если Марина сама поднимет
- Запрос на этой сессии может смениться — в №6 и №7 запрос менялся в первые 10 минут`;

const debriefMd = `**Запрос.** Марина пришла с «не успеваю ничего», в работе уточнили: «как выбирать, что *не* делать».

**Ход сессии.** Три поворотных момента: осознание «список дел — это чужие ожидания» (мин. 18), пауза после вопроса «чьи это цели?» (мин. 31), решение про разговор с CTO (мин. 44).

**Договорённости.** Тезисы к разговору с CTO до пятницы; заметить момент, когда берёт чужую задачу.

**Наблюдение для коуча.** Марина трижды уходила в рационализацию — каждый раз после вопросов «почему», а не «что/как».`;

const reviewMd = `**Компетенция 6 — Активное слушание.** Сильно: возвраты к словам клиента («вы сказали „чужие ожидания“ — что это для вас?»). 4 из 5 маркеров проявлены.

**Компетенция 7 — Пробуждение осознанности.** Вопросы в основном открытые; в мин. 22–28 серия из трёх «почему»-вопросов подряд — клиент ушла в объяснения. Попробуйте «что» / «как».

**Зона роста.** Пауз после сильных вопросов почти нет (медиана 1.2 с). Маркер 6.4 — дать клиенту закончить мысль без подсказок.`;

export const sessions: Array<Session> = [
  // сегодня, через ~40 минут — окно входа вот-вот откроется
  {
    id: "s-today-soon",
    clientId: "c-marina",
    kind: "regular",
    start: new Date(now + 40 * min),
    durationMin: 60,
    state: "scheduled",
    artifacts: [
      { kind: "brief", status: "ready", version: 1, content: briefMd },
    ],
  },
  // сегодня вечером
  {
    id: "s-today-evening",
    clientId: "c-sergey",
    kind: "regular",
    start: new Date(now + 5 * hour),
    durationMin: 60,
    state: "scheduled",
    artifacts: [{ kind: "brief", status: "generating", version: 1 }],
  },
  // завтра — интейк нового клиента (приглашение ещё не принято)
  {
    id: "s-tomorrow-intake",
    clientId: "c-anna",
    kind: "intake",
    start: at(day, 10, 0),
    durationMin: 90,
    state: "scheduled",
    artifacts: [{ kind: "brief", status: "skipped", version: 1 }],
  },
  // послезавтра
  {
    id: "s-plus2",
    clientId: "c-olha",
    kind: "regular",
    start: at(2 * day, 14, 30),
    durationMin: 60,
    state: "scheduled",
    artifacts: [],
  },
  // вчера — завершена, всё готово
  {
    id: "s-yesterday",
    clientId: "c-olha",
    kind: "regular",
    start: at(-day, 11, 0),
    durationMin: 60,
    state: "completed",
    closeReason: "coach_end",
    artifacts: [
      { kind: "brief", status: "ready", version: 1, content: briefMd },
      { kind: "debrief", status: "ready", version: 1, content: debriefMd },
      { kind: "mentor_review", status: "ready", version: 1, content: reviewMd },
    ],
  },
  // 3 дня назад — mentor review упал
  {
    id: "s-minus3",
    clientId: "c-marina",
    kind: "regular",
    start: at(-3 * day, 16, 0),
    durationMin: 60,
    state: "completed",
    closeReason: "grace_due",
    artifacts: [
      { kind: "brief", status: "ready", version: 1, content: briefMd },
      { kind: "debrief", status: "ready", version: 2, content: debriefMd },
      { kind: "mentor_review", status: "failed", version: 1 },
    ],
  },
  // 2 дня назад — клиент не пришёл
  {
    id: "s-noshow",
    clientId: "c-sergey",
    kind: "regular",
    start: at(-2 * day, 9, 0),
    durationMin: 60,
    state: "cancelled",
    cancelReason: "no_show",
    noShowDetail: "client_absent",
    artifacts: [
      { kind: "brief", status: "ready", version: 1, content: briefMd },
    ],
  },
  // неделю назад
  {
    id: "s-lastweek",
    clientId: "c-marina",
    kind: "regular",
    start: at(-7 * day, 16, 0),
    durationMin: 60,
    state: "completed",
    closeReason: "coach_end",
    artifacts: [
      { kind: "brief", status: "ready", version: 1, content: briefMd },
      { kind: "debrief", status: "ready", version: 1, content: debriefMd },
      { kind: "mentor_review", status: "ready", version: 1, content: reviewMd },
    ],
  },
];

export const clientById = (id: string) => clients.find((c) => c.id === id)!;
export const sessionsOf = (clientId: string) =>
  sessions
    .filter((s) => s.clientId === clientId)
    .sort((a, b) => b.start.getTime() - a.start.getTime());

export const upcoming = () =>
  sessions
    .filter((s) => s.state === "scheduled" || s.state === "in_progress")
    .sort((a, b) => a.start.getTime() - b.start.getTime());

export const past = () =>
  sessions
    .filter((s) => s.state === "completed" || s.state === "cancelled")
    .sort((a, b) => b.start.getTime() - a.start.getTime());

// ---- formatting -----------------------------------------------------------

const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const months = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export const fmtTime = (d: Date) =>
  `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export const fmtRange = (s: Session) => {
  const end = new Date(s.start.getTime() + s.durationMin * min);
  return `${fmtTime(s.start)}–${fmtTime(end)}`;
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const dayLabel = (d: Date) => {
  const today = new Date(now);
  const tomorrow = new Date(now + day);
  const yesterday = new Date(now - day);
  if (sameDay(d, today)) return "Сегодня";
  if (sameDay(d, tomorrow)) return "Завтра";
  if (sameDay(d, yesterday)) return "Вчера";
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
};

export const shortDate = (d: Date) => `${d.getDate()} ${months[d.getMonth()]}`;

export const isSameDay = sameDay;

export const kindLabel = (k: Session["kind"]) =>
  k === "intake" ? "Вводная" : "Сессия";

export const artifactLabel: Record<ArtifactKind, string> = {
  brief: "Бриф",
  debrief: "Дебриф",
  mentor_review: "Менторский разбор",
};

export const channelLabel: Record<ChannelKind, string> = {
  telegram: "Telegram",
  email: "Email",
  manual: "Вручную",
};

// join window: T−15m .. effective end
export const readyToJoin = (s: Session) => {
  if (s.state !== "scheduled" && s.state !== "in_progress") return false;
  const opens = s.start.getTime() - 15 * min;
  const ends = s.start.getTime() + s.durationMin * min;
  return now >= opens - 1 && now <= ends;
};

export const minutesUntil = (d: Date) => Math.round((d.getTime() - now) / min);
