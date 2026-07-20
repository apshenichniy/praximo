// PROTOTYPE — Variant C «Клиенты-first» (wayfinder #15).
// Telegram-native: сгруппированные списки в стиле настроек Telegram.
// Главный экран — календарная полоска недели + список клиентов; сессии
// живут в таймлайне клиента, артефакты — строки таймлайна.
import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  RefreshCw,
  Send,
  Video,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Md, TgShell, avatarColors, useStack } from "@/components/proto";
import {
  type ArtifactKind,
  artifactLabel,
  channelLabel,
  clientById,
  clients,
  dayLabel,
  fmtRange,
  fmtTime,
  isSameDay,
  kindLabel,
  readyToJoin,
  sessions,
  sessionsOf,
  upcoming,
} from "@/lib/mock";
import { cn } from "@/lib/utils";

type Screen =
  | { t: "home" }
  | { t: "client"; id: string }
  | { t: "session"; id: string }
  | { t: "artifact"; sessionId: string; kind: ArtifactKind };

export function VariantC() {
  const nav = useStack<Screen>({ t: "home" });
  const s = nav.top;
  const open = (screen: Screen) => nav.push(screen);

  return (
    <TgShell>
      {s.t === "home" && <Home open={open} />}
      {s.t === "client" && (
        <ClientScreen id={s.id} back={nav.pop} open={open} />
      )}
      {s.t === "session" && (
        <SessionScreen id={s.id} back={nav.pop} open={open} />
      )}
      {s.t === "artifact" && (
        <ArtifactReader sessionId={s.sessionId} kind={s.kind} back={nav.pop} />
      )}
    </TgShell>
  );
}

// ---- telegram-style list primitives --------------------------------------

function ListGroup({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {title && (
        <div className="mb-1 px-4 text-[13px] font-medium uppercase text-zinc-400">
          {title}
        </div>
      )}
      <div className="overflow-hidden rounded-xl bg-white">{children}</div>
      {footer && (
        <div className="mt-1 px-4 text-xs text-zinc-400">{footer}</div>
      )}
    </div>
  );
}

function ListRow({
  icon,
  title,
  subtitle,
  right,
  chevron = true,
  danger,
  divider = true,
  onClick,
  disabled,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  chevron?: boolean;
  danger?: boolean;
  divider?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left",
        onClick && !disabled && "active:bg-zinc-50",
        disabled && "opacity-40",
      )}
    >
      {icon}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 self-stretch",
          divider &&
            "border-b border-zinc-100 [-webkit-tap-highlight-color:transparent]",
        )}
      >
        <div className="min-w-0 flex-1 py-0.5">
          <div
            className={cn(
              "truncate text-[15px]",
              danger ? "text-red-500" : "text-zinc-900",
            )}
          >
            {title}
          </div>
          {subtitle && (
            <div className="truncate text-xs text-zinc-400">{subtitle}</div>
          )}
        </div>
        {right}
        {chevron && onClick && (
          <ChevronRight className="size-4 shrink-0 text-zinc-300" />
        )}
      </div>
    </button>
  );
}

// ---- home: week strip + clients ------------------------------------------

const dayNames = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

function Home({ open }: { open: (s: Screen) => void }) {
  const today = new Date();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i - 1); // вчера + 6 дней вперёд
    return d;
  });
  const [selected, setSelected] = useState<Date>(today);
  const daySessions = sessions
    .filter((s) => isSameDay(s.start, selected))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div className="flex flex-col gap-4 py-4">
      {/* week strip */}
      <div className="px-3">
        <div className="grid grid-cols-7 gap-1">
          {week.map((d) => {
            const has = sessions.some((s) => isSameDay(s.start, d));
            const isSel = isSameDay(d, selected);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => setSelected(d)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl py-2",
                  isSel ? "bg-blue-600 text-white" : "bg-white text-zinc-700",
                )}
              >
                <span
                  className={cn(
                    "text-[9px]",
                    isSel ? "text-blue-200" : "text-zinc-400",
                  )}
                >
                  {dayNames[d.getDay()]}
                </span>
                <span className="text-sm font-semibold">{d.getDate()}</span>
                <span
                  className={cn(
                    "size-1 rounded-full",
                    has
                      ? isSel
                        ? "bg-white"
                        : "bg-blue-500"
                      : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* selected day's sessions */}
      <div className="px-3">
        <ListGroup title={dayLabel(selected)}>
          {daySessions.length === 0 && (
            <div className="px-4 py-3 text-sm text-zinc-400">Нет сессий</div>
          )}
          {daySessions.map((session, i) => {
            const client = clientById(session.clientId);
            return (
              <ListRow
                key={session.id}
                icon={
                  <Avatar className="size-9">
                    <AvatarFallback className={avatarColors[client.color]}>
                      {client.initials}
                    </AvatarFallback>
                  </Avatar>
                }
                title={`${fmtTime(session.start)} · ${client.name.split(" ")[0]}`}
                subtitle={
                  session.state === "cancelled"
                    ? session.cancelReason === "no_show"
                      ? "отменена: неявка"
                      : "отменена"
                    : session.state === "completed"
                      ? "завершена"
                      : kindLabel(session.kind)
                }
                right={
                  readyToJoin(session) ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                      можно войти
                    </span>
                  ) : undefined
                }
                divider={i < daySessions.length - 1}
                onClick={() => open({ t: "session", id: session.id })}
              />
            );
          })}
        </ListGroup>
      </div>

      {/* clients */}
      <div className="px-3">
        <ListGroup
          title="Клиенты"
          footer="Сессии клиента и его артефакты — внутри карточки клиента."
        >
          {clients.map((client, i) => {
            const next = upcoming().find((s) => s.clientId === client.id);
            return (
              <ListRow
                key={client.id}
                icon={
                  <Avatar className="size-10">
                    <AvatarFallback className={avatarColors[client.color]}>
                      {client.initials}
                    </AvatarFallback>
                  </Avatar>
                }
                title={client.name}
                subtitle={
                  client.invitePending
                    ? "приглашение не принято"
                    : next
                      ? `следующая: ${dayLabel(next.start).toLowerCase()}, ${fmtTime(next.start)}`
                      : "нет запланированных"
                }
                right={
                  client.invitePending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      инвайт
                    </span>
                  ) : undefined
                }
                divider={i < clients.length - 1}
                onClick={() => open({ t: "client", id: client.id })}
              />
            );
          })}
        </ListGroup>
      </div>

      <div className="px-3">
        <ListGroup>
          <ListRow
            icon={<Plus className="size-5 text-blue-600" />}
            title={<span className="text-blue-600">Пригласить клиента</span>}
            chevron={false}
            divider={false}
            onClick={() => {}}
          />
        </ListGroup>
      </div>
    </div>
  );
}

// ---- client page: profile + timeline -------------------------------------

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
    <div className="flex flex-col gap-4 py-4">
      <div className="px-3">
        <BackBar back={back} />
      </div>

      {/* tg-style profile header */}
      <div className="flex flex-col items-center gap-1.5">
        <Avatar className="size-20">
          <AvatarFallback
            className={cn(avatarColors[client.color], "text-2xl")}
          >
            {client.initials}
          </AvatarFallback>
        </Avatar>
        <div className="text-lg font-semibold">{client.name}</div>
        <div className="text-xs text-zinc-400">
          {client.invitePending
            ? "приглашение не принято"
            : `клиент · ${client.language}`}
        </div>
      </div>

      <div className="px-3">
        <ListGroup>
          <ListRow
            title="Канал"
            right={
              <span className="text-sm text-zinc-400">
                {channelLabel[client.channel]}
              </span>
            }
            chevron={false}
          />
          <ListRow
            title="Согласие на запись"
            right={
              <span
                className={cn(
                  "text-sm",
                  client.consent === "active"
                    ? "text-green-600"
                    : "text-amber-600",
                )}
              >
                {client.consent === "active" ? "есть" : "не дано"}
              </span>
            }
            chevron={false}
          />
          <ListRow
            title="Запрос"
            right={
              <span className="max-w-40 truncate text-sm text-zinc-400">
                {client.goal}
              </span>
            }
            chevron={false}
            divider={false}
          />
        </ListGroup>
      </div>

      <div className="px-3">
        <ListGroup>
          <ListRow
            icon={<Plus className="size-5 text-blue-600" />}
            title={<span className="text-blue-600">Запланировать сессию</span>}
            chevron={false}
            divider={client.invitePending}
            onClick={() => {}}
          />
          {client.invitePending && (
            <ListRow
              icon={<Send className="size-5 text-blue-600" />}
              title={
                <span className="text-blue-600">
                  Отправить приглашение повторно
                </span>
              }
              chevron={false}
              divider={false}
              onClick={() => {}}
            />
          )}
        </ListGroup>
      </div>

      {/* timeline: sessions with inline artifacts */}
      <div className="px-3">
        <ListGroup title="История">
          {history.length === 0 && (
            <div className="px-4 py-3 text-sm text-zinc-400">
              Сессий ещё не было
            </div>
          )}
          {history.map((session, i) => (
            <div key={session.id}>
              <ListRow
                icon={<CalendarClock className="size-5 text-zinc-400" />}
                title={`${dayLabel(session.start)}, ${fmtTime(session.start)}`}
                subtitle={
                  session.state === "cancelled"
                    ? session.cancelReason === "no_show"
                      ? "отменена: клиент не пришёл"
                      : "отменена"
                    : kindLabel(session.kind)
                }
                divider={false}
                onClick={() => open({ t: "session", id: session.id })}
              />
              {/* inline artifact rows */}
              {session.artifacts
                .filter((a) => a.status === "ready" && a.kind !== "brief")
                .map((artifact) => (
                  <ListRow
                    key={artifact.kind}
                    icon={<FileText className="ml-6 size-4 text-blue-500" />}
                    title={
                      <span className="text-sm">
                        {artifactLabel[artifact.kind]}
                      </span>
                    }
                    divider={false}
                    onClick={() =>
                      open({
                        t: "artifact",
                        sessionId: session.id,
                        kind: artifact.kind,
                      })
                    }
                  />
                ))}
              {session.artifacts.some((a) => a.status === "failed") && (
                <ListRow
                  icon={
                    <AlertTriangle className="ml-6 size-4 text-amber-500" />
                  }
                  title={
                    <span className="text-sm text-amber-700">
                      Сбой генерации разбора
                    </span>
                  }
                  chevron={false}
                  divider={false}
                />
              )}
              {i < history.length - 1 && (
                <div className="mx-4 border-b border-zinc-100" />
              )}
            </div>
          ))}
        </ListGroup>
      </div>
    </div>
  );
}

// ---- session page ---------------------------------------------------------

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
    <div className="flex flex-col gap-4 py-4">
      <div className="px-3">
        <BackBar back={back} />
      </div>

      <div className="flex flex-col items-center gap-1">
        <Avatar className="size-14">
          <AvatarFallback className={cn(avatarColors[client.color], "text-lg")}>
            {client.initials}
          </AvatarFallback>
        </Avatar>
        <div className="text-base font-semibold">{client.name}</div>
        <div className="text-xs text-zinc-400">
          {dayLabel(session.start)}, {fmtRange(session)} ·{" "}
          {kindLabel(session.kind)}
        </div>
      </div>

      {ready && (
        <div className="px-3">
          <Button size="lg" className="w-full bg-green-600 hover:bg-green-700">
            <Video /> Войти в сессию
          </Button>
        </div>
      )}

      {session.state === "scheduled" && (
        <div className="px-3">
          <ListGroup footer="Неявку и завершение фиксирует система автоматически.">
            <ListRow
              icon={<CalendarClock className="size-5 text-blue-600" />}
              title={<span className="text-blue-600">Перенести</span>}
              chevron={false}
              onClick={() => {}}
            />
            <ListRow
              icon={<RefreshCw className="size-5 text-blue-600" />}
              title={
                <span className="text-blue-600">
                  Перевыпустить ссылки входа
                </span>
              }
              chevron={false}
              onClick={() => {}}
            />
            <ListRow
              icon={<XCircle className="size-5 text-red-500" />}
              title="Отменить сессию"
              danger
              chevron={false}
              divider={false}
              onClick={() => {}}
            />
          </ListGroup>
        </div>
      )}

      {session.state === "cancelled" && (
        <div className="px-3">
          <ListGroup>
            <ListRow
              icon={<XCircle className="size-5 text-red-400" />}
              title={
                session.cancelReason === "no_show"
                  ? "Отменена автоматически: клиент не подключился"
                  : "Отменена"
              }
              chevron={false}
              divider={false}
            />
          </ListGroup>
        </div>
      )}

      <div className="px-3">
        <ListGroup
          title="Артефакты"
          footer="Готовые артефакты бот дублирует в чат."
        >
          {(["brief", "debrief", "mentor_review"] as Array<ArtifactKind>).map(
            (kind, i) => {
              const artifact = session.artifacts.find((a) => a.kind === kind);
              const last = i === 2;
              if (!artifact)
                return (
                  <ListRow
                    key={kind}
                    icon={<FileText className="size-5 text-zinc-300" />}
                    title={
                      <span className="text-zinc-400">
                        {artifactLabel[kind]}
                      </span>
                    }
                    subtitle={
                      session.state === "scheduled" ? "после сессии" : "—"
                    }
                    chevron={false}
                    divider={!last}
                  />
                );
              return (
                <ListRow
                  key={kind}
                  icon={
                    artifact.status === "failed" ? (
                      <AlertTriangle className="size-5 text-amber-500" />
                    ) : (
                      <FileText
                        className={cn(
                          "size-5",
                          artifact.status === "ready"
                            ? "text-blue-600"
                            : "text-zinc-300",
                        )}
                      />
                    )
                  }
                  title={artifactLabel[kind]}
                  subtitle={
                    artifact.status === "ready"
                      ? `v${artifact.version}`
                      : artifact.status === "generating"
                        ? "готовится…"
                        : artifact.status === "failed"
                          ? "сбой генерации"
                          : "не будет: истории ещё нет"
                  }
                  divider={!last}
                  onClick={
                    artifact.status === "ready"
                      ? () =>
                          open({ t: "artifact", sessionId: session.id, kind })
                      : undefined
                  }
                  chevron={artifact.status === "ready"}
                />
              );
            },
          )}
        </ListGroup>
      </div>
    </div>
  );
}

// ---- artifact reader ------------------------------------------------------

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
    <div className="flex flex-col gap-4 py-4">
      <div className="px-3">
        <BackBar back={back} />
      </div>
      <div className="px-3">
        <div className="rounded-xl bg-white p-4">
          <div className="mb-3 border-b border-zinc-100 pb-3">
            <div className="text-sm font-semibold">
              {artifactLabel[kind]} · {client.name.split(" ")[0]}
            </div>
            <div className="text-xs text-zinc-400">
              {dayLabel(session.start)} · v{artifact.version} · есть в чате с
              ботом
            </div>
          </div>
          {artifact.content && (
            <Md text={artifact.content} className="text-zinc-700" />
          )}
        </div>
      </div>
      <div className="px-3">
        <ListGroup>
          <ListRow
            icon={<Send className="size-5 text-blue-600" />}
            title={
              <span className="text-blue-600">Открыть в чате с ботом</span>
            }
            chevron={false}
            onClick={() => {}}
          />
          <ListRow
            icon={<RefreshCw className="size-5 text-blue-600" />}
            title={<span className="text-blue-600">Перегенерировать</span>}
            chevron={false}
            divider={false}
            onClick={() => {}}
          />
        </ListGroup>
      </div>
    </div>
  );
}

function BackBar({ back }: { back: () => void }) {
  return (
    <button
      type="button"
      onClick={back}
      className="flex items-center gap-1 py-0.5 pr-2 text-sm font-medium text-blue-600"
    >
      <ChevronLeft className="size-4" /> Назад
    </button>
  );
}
