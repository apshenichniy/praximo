// PROTOTYPE — Variant A «Табы» (wayfinder #15).
// Классическое приложение с нижними табами: Расписание / Клиенты.
// Артефакты живут внутри карточки сессии как раскрывающиеся секции.
import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hourglass,
  Plus,
  RefreshCw,
  Send,
  Users,
  Video,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Md, TgShell, avatarColors, useStack } from "@/components/proto";
import {
  type ArtifactKind,
  type Session,
  artifactLabel,
  channelLabel,
  clientById,
  clients,
  dayLabel,
  fmtRange,
  fmtTime,
  kindLabel,
  minutesUntil,
  past,
  readyToJoin,
  sessionsOf,
  upcoming,
} from "@/lib/mock";
import { cn } from "@/lib/utils";

type Screen =
  | { t: "tabs"; tab: "schedule" | "clients" }
  | { t: "session"; id: string }
  | { t: "client"; id: string }
  | { t: "new-session"; clientId?: string };

export function VariantA() {
  const nav = useStack<Screen>({ t: "tabs", tab: "schedule" });
  const s = nav.top;

  return (
    <TgShell>
      {s.t === "tabs" && (
        <div className="flex flex-1 flex-col">
          <div className="flex-1">
            {s.tab === "schedule" ? (
              <ScheduleTab
                openSession={(id) => nav.push({ t: "session", id })}
              />
            ) : (
              <ClientsTab openClient={(id) => nav.push({ t: "client", id })} />
            )}
          </div>
          {/* FAB */}
          <button
            type="button"
            onClick={() => nav.push({ t: "new-session" })}
            className="fixed bottom-32 right-1/2 z-30 translate-x-[176px] rounded-full bg-blue-600 p-3.5 text-white shadow-lg"
          >
            <Plus className="size-5" />
          </button>
          {/* bottom tabs */}
          <div className="sticky bottom-0 z-20 grid grid-cols-2 border-t border-zinc-200 bg-white/95 backdrop-blur">
            {(
              [
                ["schedule", "Расписание", Calendar],
                ["clients", "Клиенты", Users],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => nav.reset({ t: "tabs", tab: key })}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                  s.tab === key ? "text-blue-600" : "text-zinc-400",
                )}
              >
                <Icon className="size-5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {s.t === "session" && (
        <SessionScreen
          id={s.id}
          back={nav.pop}
          openClient={(id) => nav.push({ t: "client", id })}
        />
      )}
      {s.t === "client" && (
        <ClientScreen
          id={s.id}
          back={nav.pop}
          openSession={(id) => nav.push({ t: "session", id })}
          newSession={(clientId) => nav.push({ t: "new-session", clientId })}
        />
      )}
      {s.t === "new-session" && (
        <NewSessionScreen back={nav.pop} clientId={s.clientId} />
      )}
    </TgShell>
  );
}

// ---- schedule tab ---------------------------------------------------------

function ScheduleTab({ openSession }: { openSession: (id: string) => void }) {
  const [mode, setMode] = useState<"upcoming" | "past">("upcoming");
  const list = mode === "upcoming" ? upcoming() : past();

  const groups: Array<{ label: string; items: Array<Session> }> = [];
  for (const session of list) {
    const label = dayLabel(session.start);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(session);
    else groups.push({ label, items: [session] });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-2 rounded-xl bg-zinc-200/70 p-1 text-sm font-medium">
        {(
          [
            ["upcoming", "Предстоящие"],
            ["past", "Прошедшие"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={cn(
              "rounded-lg py-1.5",
              mode === key ? "bg-white shadow-sm" : "text-zinc-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {groups.map((g) => (
        <div key={g.label}>
          <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {g.label}
          </h2>
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {g.items.map((session, i) => (
              <SessionRow
                key={session.id}
                session={session}
                divider={i > 0}
                onClick={() => openSession(session.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionRow({
  session,
  divider,
  onClick,
}: {
  session: Session;
  divider: boolean;
  onClick: () => void;
}) {
  const client = clientById(session.clientId);
  const ready = readyToJoin(session);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-zinc-50",
        divider && "border-t border-zinc-100",
      )}
    >
      <div className="w-11 text-center">
        <div className="text-sm font-semibold">{fmtTime(session.start)}</div>
        <div className="text-[10px] text-zinc-400">
          {session.durationMin} мин
        </div>
      </div>
      <Avatar className="size-9">
        <AvatarFallback className={avatarColors[client.color]}>
          {client.initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{client.name}</div>
        <div className="text-xs text-zinc-500">{kindLabel(session.kind)}</div>
      </div>
      <SessionStateChip session={session} ready={ready} />
      <ChevronRight className="size-4 shrink-0 text-zinc-300" />
    </button>
  );
}

function SessionStateChip({
  session,
  ready,
}: {
  session: Session;
  ready?: boolean;
}) {
  if (session.state === "scheduled" && ready)
    return <Badge className="bg-green-100 text-green-700">можно войти</Badge>;
  if (session.state === "cancelled")
    return (
      <Badge variant="secondary" className="bg-red-50 text-red-600">
        {session.cancelReason === "no_show" ? "неявка" : "отменена"}
      </Badge>
    );
  if (session.state === "completed") {
    const failed = session.artifacts.some((a) => a.status === "failed");
    return failed ? (
      <Badge variant="secondary" className="bg-amber-50 text-amber-700">
        <AlertTriangle className="size-3" /> сбой
      </Badge>
    ) : null;
  }
  return null;
}

// ---- session detail -------------------------------------------------------

function SessionScreen({
  id,
  back,
  openClient,
}: {
  id: string;
  back: () => void;
  openClient: (id: string) => void;
}) {
  const session = upcoming()
    .concat(past())
    .find((s) => s.id === id)!;
  const client = clientById(session.clientId);
  const ready = readyToJoin(session);
  const mins = minutesUntil(session.start);

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar
        back={back}
        title={`${dayLabel(session.start)}, ${fmtRange(session)}`}
      />

      <button
        type="button"
        onClick={() => openClient(client.id)}
        className="flex items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-sm active:bg-zinc-50"
      >
        <Avatar className="size-11">
          <AvatarFallback className={avatarColors[client.color]}>
            {client.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{client.name}</div>
          <div className="text-xs text-zinc-500">
            {kindLabel(session.kind)} · {session.durationMin} мин
          </div>
        </div>
        <ChevronRight className="size-4 text-zinc-300" />
      </button>

      {session.state === "scheduled" && (
        <div className="flex flex-col gap-2 rounded-2xl bg-white p-3.5 shadow-sm">
          {ready ? (
            <Button size="lg" className="bg-green-600 hover:bg-green-700">
              <Video /> Войти в сессию
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5 text-xs text-zinc-500">
              <Hourglass className="size-4 shrink-0" />
              Вход откроется за 15 минут до начала
              {mins > 0 && mins < 24 * 60 && ` (через ${mins - 15} мин)`}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline">
              <CalendarClock /> Перенести
            </Button>
            <Button variant="outline" className="text-red-600">
              <XCircle /> Отменить
            </Button>
          </div>
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 pt-1 text-xs text-zinc-400"
          >
            <RefreshCw className="size-3.5" /> Перевыпустить ссылки входа
          </button>
        </div>
      )}

      {session.state === "cancelled" && (
        <div className="rounded-2xl bg-red-50 p-3.5 text-sm text-red-700">
          {session.cancelReason === "no_show"
            ? "Сессия отменена автоматически: клиент не подключился."
            : "Сессия отменена."}
          <div className="mt-1 text-xs text-red-400">
            Неявку фиксирует система — вручную отмечать не нужно.
          </div>
        </div>
      )}

      {/* artifacts inline, in-session-card */}
      <div>
        <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Артефакты
        </h2>
        <div className="flex flex-col gap-2">
          {(["brief", "debrief", "mentor_review"] as Array<ArtifactKind>).map(
            (kind) => (
              <ArtifactCard key={kind} kind={kind} session={session} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({
  kind,
  session,
}: {
  kind: ArtifactKind;
  session: Session;
}) {
  const [open, setOpen] = useState(false);
  const artifact = session.artifacts.find((a) => a.kind === kind);
  const postSession = kind !== "brief";

  if (!artifact) {
    if (session.state === "scheduled" && postSession)
      return (
        <div className="rounded-2xl bg-white/60 px-3.5 py-3 text-sm text-zinc-400 shadow-sm">
          {artifactLabel[kind]} — появится после сессии
        </div>
      );
    if (!postSession) return null;
    return null;
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <button
        type="button"
        onClick={() => artifact.status === "ready" && setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <FileText
          className={cn(
            "size-4.5 shrink-0",
            artifact.status === "ready" ? "text-blue-600" : "text-zinc-300",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{artifactLabel[kind]}</div>
          <div className="text-xs text-zinc-400">
            {artifact.status === "ready" &&
              `v${artifact.version} · доставлен в чат ботом`}
            {artifact.status === "generating" && "готовится…"}
            {artifact.status === "failed" && "не удалось сгенерировать"}
            {artifact.status === "skipped" &&
              "не будет: первая сессия, истории ещё нет"}
          </div>
        </div>
        {artifact.status === "ready" && (
          <ChevronRight
            className={cn(
              "size-4 text-zinc-300 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
        {artifact.status === "failed" && (
          <AlertTriangle className="size-4 text-amber-500" />
        )}
      </button>
      {open && artifact.content && (
        <div className="border-t border-zinc-100 px-3.5 py-3">
          <Md text={artifact.content} className="text-zinc-700" />
          <button
            type="button"
            className="mt-3 flex items-center gap-1.5 text-xs font-medium text-blue-600"
          >
            <Send className="size-3.5" /> Открыть в чате с ботом
          </button>
        </div>
      )}
    </div>
  );
}

// ---- clients tab ----------------------------------------------------------

function ClientsTab({ openClient }: { openClient: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {clients.map((client, i) => {
          const next = upcoming().find((s) => s.clientId === client.id);
          return (
            <button
              key={client.id}
              type="button"
              onClick={() => openClient(client.id)}
              className={cn(
                "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-zinc-50",
                i > 0 && "border-t border-zinc-100",
              )}
            >
              <Avatar className="size-10">
                <AvatarFallback className={avatarColors[client.color]}>
                  {client.initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {client.name}
                </div>
                <div className="text-xs text-zinc-500">
                  {client.invitePending
                    ? "приглашение не принято"
                    : next
                      ? `${dayLabel(next.start).toLowerCase()}, ${fmtTime(next.start)}`
                      : "нет запланированных сессий"}
                </div>
              </div>
              {client.invitePending && (
                <Badge
                  variant="secondary"
                  className="bg-amber-50 text-amber-700"
                >
                  инвайт
                </Badge>
              )}
              <ChevronRight className="size-4 shrink-0 text-zinc-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ClientScreen({
  id,
  back,
  openSession,
  newSession,
}: {
  id: string;
  back: () => void;
  openSession: (id: string) => void;
  newSession: (clientId: string) => void;
}) {
  const client = clientById(id);
  const history = sessionsOf(id);

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title="Клиент" />

      <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm">
        <Avatar className="size-16">
          <AvatarFallback className={cn(avatarColors[client.color], "text-xl")}>
            {client.initials}
          </AvatarFallback>
        </Avatar>
        <div className="text-base font-semibold">{client.name}</div>
        <div className="flex gap-1.5">
          <Badge variant="secondary">{channelLabel[client.channel]}</Badge>
          <Badge variant="secondary">{client.language}</Badge>
          {client.consent === "active" ? (
            <Badge variant="secondary" className="bg-green-50 text-green-700">
              согласие
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-amber-50 text-amber-700">
              согласие не дано
            </Badge>
          )}
        </div>
        {client.goal !== "—" && (
          <div className="text-center text-xs text-zinc-500">
            Запрос: {client.goal}
          </div>
        )}
      </div>

      {client.invitePending && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
          <Send className="size-4 shrink-0" />
          <span className="flex-1">
            Приглашение отправлено, ещё не принято.
          </span>
          <button
            type="button"
            className="text-xs font-semibold text-amber-700 underline"
          >
            Повторить
          </button>
        </div>
      )}

      <Button size="lg" onClick={() => newSession(client.id)}>
        <Plus /> Новая сессия
      </Button>

      <div>
        <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Сессии
        </h2>
        {history.length === 0 ? (
          <div className="rounded-2xl bg-white/60 px-3.5 py-3 text-sm text-zinc-400 shadow-sm">
            Сессий ещё не было
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {history.map((session, i) => (
              <button
                key={session.id}
                type="button"
                onClick={() => openSession(session.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-zinc-50",
                  i > 0 && "border-t border-zinc-100",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {dayLabel(session.start)}, {fmtTime(session.start)}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {kindLabel(session.kind)}
                  </div>
                </div>
                <SessionStateChip
                  session={session}
                  ready={readyToJoin(session)}
                />
                <ChevronRight className="size-4 shrink-0 text-zinc-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- new session (stub) ---------------------------------------------------

function NewSessionScreen({
  back,
  clientId,
}: {
  back: () => void;
  clientId?: string;
}) {
  const [selected, setSelected] = useState(clientId ?? "");
  const [done, setDone] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title="Новая сессия" />
      {done ? (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700">
          Сессия запланирована (заглушка — ничего не сохраняется). Клиент
          получит напоминание и ссылку в свой канал.
          <Button variant="outline" className="mt-3 w-full" onClick={back}>
            Готово
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Клиент
          </div>
          <div className="flex flex-col gap-1.5">
            {clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => setSelected(client.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm",
                  selected === client.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-zinc-200",
                  client.consent !== "active" &&
                    !client.invitePending &&
                    "opacity-40",
                )}
              >
                <Avatar className="size-7">
                  <AvatarFallback className={avatarColors[client.color]}>
                    {client.initials}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1">{client.name}</span>
                {client.invitePending && (
                  <span className="text-[10px] text-amber-600">
                    инвайт не принят
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Дата и время
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              defaultValue={new Date(Date.now() + 86400000)
                .toISOString()
                .slice(0, 10)}
            />
            <input
              type="time"
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              defaultValue="10:00"
            />
          </div>
          <Button size="lg" disabled={!selected} onClick={() => setDone(true)}>
            Запланировать
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- shared ---------------------------------------------------------------

function BackBar({ back, title }: { back: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={back}
      className="flex items-center gap-1 self-start py-0.5 pr-2 text-sm font-medium text-blue-600"
    >
      <ChevronLeft className="size-4" /> {title}
    </button>
  );
}
