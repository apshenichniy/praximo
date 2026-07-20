// PROTOTYPE — Variant B «Сегодня» (wayfinder #15).
// Hub-and-spoke: главный экран — дашборд дня (ближайшая сессия, «требует
// внимания», лента свежих артефактов); всё остальное — drill-in со стеком.
// Артефакты — первоклассная лента, Mini App как архив того, что доставил бот.
import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
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
  artifactLabel,
  channelLabel,
  clientById,
  clients,
  coach,
  dayLabel,
  fmtRange,
  fmtTime,
  kindLabel,
  minutesUntil,
  past,
  readyToJoin,
  sessions,
  sessionsOf,
  upcoming,
} from "@/lib/mock";
import { cn } from "@/lib/utils";

type Screen =
  | { t: "home" }
  | { t: "sessions" }
  | { t: "clients" }
  | { t: "session"; id: string }
  | { t: "client"; id: string }
  | { t: "artifact"; sessionId: string; kind: ArtifactKind }
  | { t: "new" };

export function VariantB() {
  const nav = useStack<Screen>({ t: "home" });
  const s = nav.top;
  const open = (screen: Screen) => nav.push(screen);

  return (
    <TgShell>
      {s.t === "home" && <Home open={open} />}
      {s.t === "sessions" && <SessionsList back={nav.pop} open={open} />}
      {s.t === "clients" && <ClientsList back={nav.pop} open={open} />}
      {s.t === "session" && (
        <SessionScreen id={s.id} back={nav.pop} open={open} />
      )}
      {s.t === "client" && (
        <ClientScreen id={s.id} back={nav.pop} open={open} />
      )}
      {s.t === "artifact" && (
        <ArtifactReader sessionId={s.sessionId} kind={s.kind} back={nav.pop} />
      )}
      {s.t === "new" && <NewSessionScreen back={nav.pop} />}
    </TgShell>
  );
}

// ---- home dashboard -------------------------------------------------------

function Home({ open }: { open: (s: Screen) => void }) {
  const next = upcoming()[0];
  const nextClient = next ? clientById(next.clientId) : null;
  const ready = next ? readyToJoin(next) : false;
  const mins = next ? minutesUntil(next.start) : 0;
  const brief = next?.artifacts.find((a) => a.kind === "brief");

  // needs attention: failed artifacts + pending invites
  const failed = sessions.flatMap((session) =>
    session.artifacts
      .filter((a) => a.status === "failed")
      .map((a) => ({ session, artifact: a })),
  );
  const pendingInvites = clients.filter((c) => c.invitePending);

  // artifact feed: latest ready post-session artifacts
  const feed = past()
    .flatMap((session) =>
      session.artifacts
        .filter((a) => a.kind !== "brief" && a.status === "ready")
        .map((a) => ({ session, artifact: a })),
    )
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-bold">Добрый день, {coach.name}</h1>
        <p className="text-xs text-zinc-500">
          {upcoming().filter((s) => dayLabel(s.start) === "Сегодня").length}{" "}
          сессии сегодня
        </p>
      </div>

      {/* hero: next session */}
      {next && nextClient && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between bg-blue-600 px-4 py-2 text-white">
            <span className="text-xs font-medium">Ближайшая сессия</span>
            <span className="text-xs">
              {dayLabel(next.start).toLowerCase()}, {fmtRange(next)}
            </span>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <button
              type="button"
              onClick={() => open({ t: "client", id: nextClient.id })}
              className="flex items-center gap-3 text-left"
            >
              <Avatar className="size-12">
                <AvatarFallback className={avatarColors[nextClient.color]}>
                  {nextClient.initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {nextClient.name}
                </div>
                <div className="text-xs text-zinc-500">
                  {kindLabel(next.kind)} · {next.durationMin} мин
                  {mins > 0 && mins < 180 && ` · через ${mins} мин`}
                </div>
              </div>
            </button>

            {brief?.status === "ready" && (
              <button
                type="button"
                onClick={() =>
                  open({ t: "artifact", sessionId: next.id, kind: "brief" })
                }
                className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm text-blue-700"
              >
                <FileText className="size-4 shrink-0" />
                <span className="flex-1 font-medium">
                  Бриф готов — прочитать перед сессией
                </span>
                <ChevronRight className="size-4" />
              </button>
            )}
            {brief?.status === "generating" && (
              <div className="rounded-xl bg-zinc-100 px-3 py-2.5 text-xs text-zinc-500">
                Бриф готовится — придёт в чат до начала
              </div>
            )}

            {ready ? (
              <Button size="lg" className="bg-green-600 hover:bg-green-700">
                <Video /> Войти в сессию
              </Button>
            ) : (
              <Button
                size="lg"
                variant="outline"
                onClick={() => open({ t: "session", id: next.id })}
              >
                Детали сессии
              </Button>
            )}
          </div>
        </div>
      )}

      {/* needs attention */}
      {(failed.length > 0 || pendingInvites.length > 0) && (
        <div>
          <SectionTitle>Требует внимания</SectionTitle>
          <div className="flex flex-col gap-2">
            {failed.map(({ session, artifact }) => (
              <button
                key={session.id + artifact.kind}
                type="button"
                onClick={() => open({ t: "session", id: session.id })}
                className="flex items-center gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-left text-sm text-amber-800"
              >
                <AlertTriangle className="size-4 shrink-0" />
                <span className="flex-1">
                  {artifactLabel[artifact.kind]} —{" "}
                  {clientById(session.clientId).name.split(" ")[0]}: сбой
                  генерации
                </span>
                <ChevronRight className="size-4" />
              </button>
            ))}
            {pendingInvites.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => open({ t: "client", id: client.id })}
                className="flex items-center gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 text-left text-sm text-amber-800"
              >
                <Send className="size-4 shrink-0" />
                <span className="flex-1">
                  {client.name} не приняла приглашение
                </span>
                <ChevronRight className="size-4" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* artifact feed */}
      <div>
        <SectionTitle>Свежие артефакты</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {feed.map(({ session, artifact }, i) => {
            const client = clientById(session.clientId);
            return (
              <button
                key={session.id + artifact.kind}
                type="button"
                onClick={() =>
                  open({
                    t: "artifact",
                    sessionId: session.id,
                    kind: artifact.kind,
                  })
                }
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-zinc-50",
                  i > 0 && "border-t border-zinc-100",
                )}
              >
                <FileText className="size-4.5 shrink-0 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {artifactLabel[artifact.kind]} — {client.name.split(" ")[0]}
                  </div>
                  <div className="text-xs text-zinc-400">
                    {dayLabel(session.start).toLowerCase()} · доставлен ботом
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-zinc-300" />
              </button>
            );
          })}
        </div>
      </div>

      {/* bottom actions: primary «Новая сессия», secondary navigation */}
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => open({ t: "new" })}
        >
          <Plus /> Новая сессия
        </Button>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [{ t: "sessions" } as Screen, "Все сессии", CalendarDays],
              [{ t: "clients" } as Screen, "Клиенты", Users],
            ] as const
          ).map(([screen, label, Icon]) => (
            <button
              key={label}
              type="button"
              onClick={() => open(screen)}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-xs font-medium text-zinc-600 shadow-sm active:bg-zinc-50"
            >
              <Icon className="size-4.5 text-blue-600" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- lists ----------------------------------------------------------------

function SessionsList({
  back,
  open,
}: {
  back: () => void;
  open: (s: Screen) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title="Все сессии" />
      {(
        [
          ["Предстоящие", upcoming()],
          ["Прошедшие", past()],
        ] as const
      ).map(([label, list]) => (
        <div key={label}>
          <SectionTitle>{label}</SectionTitle>
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {list.map((session, i) => {
              const client = clientById(session.clientId);
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => open({ t: "session", id: session.id })}
                  className={cn(
                    "flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-zinc-50",
                    i > 0 && "border-t border-zinc-100",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {client.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {dayLabel(session.start).toLowerCase()},{" "}
                      {fmtTime(session.start)} · {kindLabel(session.kind)}
                    </div>
                  </div>
                  {session.state === "cancelled" && (
                    <Badge
                      variant="secondary"
                      className="bg-red-50 text-red-600"
                    >
                      {session.cancelReason === "no_show"
                        ? "неявка"
                        : "отменена"}
                    </Badge>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-zinc-300" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ClientsList({
  back,
  open,
}: {
  back: () => void;
  open: (s: Screen) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title="Клиенты" />
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {clients.map((client, i) => (
          <button
            key={client.id}
            type="button"
            onClick={() => open({ t: "client", id: client.id })}
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
              <div className="truncate text-sm font-medium">{client.name}</div>
              <div className="text-xs text-zinc-500">
                {client.invitePending ? "приглашение не принято" : client.goal}
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-zinc-300" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- detail screens -------------------------------------------------------

function SessionScreen({
  id,
  back,
  open,
}: {
  id: string;
  back: () => void;
  open: (s: Screen) => void;
}) {
  const session = sessions.find((s) => s.id === id)!;
  const client = clientById(session.clientId);
  const ready = readyToJoin(session);

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title="Сессия" />

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Avatar className="size-11">
            <AvatarFallback className={avatarColors[client.color]}>
              {client.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{client.name}</div>
            <div className="text-xs text-zinc-500">
              {dayLabel(session.start)}, {fmtRange(session)} ·{" "}
              {kindLabel(session.kind)}
            </div>
          </div>
        </div>

        {session.state === "scheduled" && (
          <div className="mt-3 flex items-center justify-around border-t border-zinc-100 pt-3">
            <IconAction
              icon={Video}
              label="Войти"
              accent={ready}
              disabled={!ready}
            />
            <IconAction icon={CalendarClock} label="Перенести" />
            <IconAction icon={RefreshCw} label="Ссылки" />
            <IconAction icon={XCircle} label="Отменить" danger />
          </div>
        )}
        {session.state === "cancelled" && (
          <div className="mt-3 border-t border-zinc-100 pt-3 text-sm text-red-600">
            {session.cancelReason === "no_show"
              ? "Отменена автоматически: клиент не подключился."
              : "Отменена."}
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Артефакты</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {(["brief", "debrief", "mentor_review"] as Array<ArtifactKind>).map(
            (kind, i) => {
              const artifact = session.artifacts.find((a) => a.kind === kind);
              const row = (
                <div
                  className={cn(
                    "flex w-full items-center gap-3 px-3.5 py-3",
                    i > 0 && "border-t border-zinc-100",
                  )}
                >
                  <FileText
                    className={cn(
                      "size-4.5 shrink-0",
                      artifact?.status === "ready"
                        ? "text-blue-600"
                        : "text-zinc-300",
                    )}
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-sm font-medium">
                      {artifactLabel[kind]}
                    </div>
                    <div className="text-xs text-zinc-400">
                      {!artifact &&
                        session.state === "scheduled" &&
                        "после сессии"}
                      {!artifact && session.state !== "scheduled" && "—"}
                      {artifact?.status === "ready" &&
                        `v${artifact.version} · доставлен ботом`}
                      {artifact?.status === "generating" && "готовится…"}
                      {artifact?.status === "failed" && "сбой генерации"}
                      {artifact?.status === "skipped" &&
                        "не будет: истории ещё нет"}
                    </div>
                  </div>
                  {artifact?.status === "ready" && (
                    <ChevronRight className="size-4 shrink-0 text-zinc-300" />
                  )}
                  {artifact?.status === "failed" && (
                    <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                  )}
                </div>
              );
              return artifact?.status === "ready" ? (
                <button
                  key={kind}
                  type="button"
                  className="block w-full active:bg-zinc-50"
                  onClick={() =>
                    open({ t: "artifact", sessionId: session.id, kind })
                  }
                >
                  {row}
                </button>
              ) : (
                <div key={kind}>{row}</div>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
}

function ClientScreen({
  id,
  back,
  open,
}: {
  id: string;
  back: () => void;
  open: (s: Screen) => void;
}) {
  const client = clientById(id);
  const history = sessionsOf(id);

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title="Клиент" />
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Avatar className="size-14">
          <AvatarFallback className={cn(avatarColors[client.color], "text-lg")}>
            {client.initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{client.name}</div>
          <div className="text-xs text-zinc-500">
            {channelLabel[client.channel]} · {client.language} ·{" "}
            {client.consent === "active" ? "согласие есть" : "согласие не дано"}
          </div>
        </div>
      </div>
      {client.invitePending && (
        <div className="rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
          Приглашение не принято — сессии можно планировать, но напоминания
          клиент пока не получает.
        </div>
      )}
      <div>
        <SectionTitle>Сессии</SectionTitle>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {history.length === 0 && (
            <div className="px-3.5 py-3 text-sm text-zinc-400">
              Сессий ещё не было
            </div>
          )}
          {history.map((session, i) => (
            <button
              key={session.id}
              type="button"
              onClick={() => open({ t: "session", id: session.id })}
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
              <ChevronRight className="size-4 shrink-0 text-zinc-300" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtifactReader({
  sessionId,
  kind,
  back,
}: {
  sessionId: string;
  kind: ArtifactKind;
  back: () => void;
}) {
  const session = sessions.find((s) => s.id === sessionId)!;
  const client = clientById(session.clientId);
  const artifact = session.artifacts.find((a) => a.kind === kind)!;

  return (
    <div className="flex flex-col gap-3 p-4">
      <BackBar back={back} title={artifactLabel[kind]} />
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 border-b border-zinc-100 pb-3">
          <div className="text-sm font-semibold">
            {artifactLabel[kind]} · {client.name}
          </div>
          <div className="text-xs text-zinc-400">
            {dayLabel(session.start)}, {fmtRange(session)} · v{artifact.version}{" "}
            · доставлен в чат ботом
          </div>
        </div>
        {artifact.content && (
          <Md text={artifact.content} className="text-zinc-700" />
        )}
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <Button variant="outline" size="sm" className="w-full">
            <Send className="size-3.5" /> Открыть в чате
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- new session (stub) ---------------------------------------------------

function NewSessionScreen({ back }: { back: () => void }) {
  const [selected, setSelected] = useState("");
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </h2>
  );
}

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

function IconAction({
  icon: Icon,
  label,
  accent,
  danger,
  disabled,
}: {
  icon: typeof Video;
  label: string;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-1 text-[11px] font-medium",
        accent ? "text-green-600" : danger ? "text-red-500" : "text-blue-600",
        disabled && "opacity-40",
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}
