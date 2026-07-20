// PROTOTYPE — in-room mock (wayfinder #28). The real room is LiveKit Components
// (spec'd in web-room-sessions.md); this only shows that entry lands somewhere.
import { createFileRoute, Link } from "@tanstack/react-router"
import { Circle, Mic, MicOff, PhoneOff, Video } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { client, coach } from "@/lib/mock"

export const Route = createFileRoute("/room")({ component: Room })

function Room() {
  return (
    <main className="flex min-h-svh flex-col bg-zinc-950 p-4 pb-24 text-zinc-50">
      <div className="flex items-center justify-between px-2 py-2 text-sm text-zinc-400">
        <span>Intake session · 10:02</span>
        <span className="flex items-center gap-1.5 text-red-400">
          <Circle className="size-2 fill-current" /> REC
        </span>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
        <Tile initials={coach.initials} name={coach.name} speaking />
        <Tile initials={client.initials} name="Марія Петренко" />
      </div>
      <div className="flex items-center justify-center gap-3 py-5">
        <RoundBtn>
          <Mic className="size-5" />
        </RoundBtn>
        <RoundBtn>
          <Video className="size-5" />
        </RoundBtn>
        <Link
          to="/coach/bot"
          className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium hover:bg-red-500"
        >
          <PhoneOff className="size-5" /> Выйти
        </Link>
      </div>
      <p className="text-center text-xs text-zinc-600">
        мок — реальная комната описана в web-room-sessions.md; «Выйти» ведёт на
        сторону коуча
      </p>
    </main>
  )
}

function Tile({
  initials,
  name,
  speaking,
}: {
  initials: string
  name: string
  speaking?: boolean
}) {
  return (
    <div
      className={
        "relative flex items-center justify-center rounded-2xl bg-zinc-800 " +
        (speaking ? "ring-2 ring-green-500" : "")
      }
    >
      <Avatar className="size-24">
        <AvatarFallback className="bg-zinc-700 text-3xl text-zinc-200">
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-zinc-900/70 px-2 py-1 text-xs">
        {speaking ? <Mic className="size-3" /> : <MicOff className="size-3" />}
        {name}
      </span>
    </div>
  )
}

function RoundBtn({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="flex size-12 items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700"
    >
      {children}
    </button>
  )
}
