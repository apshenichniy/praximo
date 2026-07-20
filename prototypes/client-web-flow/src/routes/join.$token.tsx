// PROTOTYPE — pre-join page (wayfinder #28). Genuinely implements the spec's
// URL hygiene: the token is read into memory + sessionStorage, then stripped
// from the URL via history.replaceState.
import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Mic, Video } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { dict, type Locale } from "@/lib/i18n"
import { client, coach, session } from "@/lib/mock"

export const Route = createFileRoute("/join/$token")({
  validateSearch: (s): { lang?: Locale } => ({
    lang: s.lang === "en" || s.lang === "uk" || s.lang === "ru" ? s.lang : undefined,
  }),
  component: PreJoin,
})

function PreJoin() {
  const { token } = Route.useParams()
  const { lang } = Route.useSearch()
  const navigate = useNavigate()
  const locale: Locale = lang ?? "uk"
  const t = dict[locale]
  const [strippedToken, setStrippedToken] = useState<string | null>(null)

  useEffect(() => {
    if (token !== "s") {
      sessionStorage.setItem("join-token", token)
      setStrippedToken(token)
      history.replaceState(null, "", "/join/s")
    } else {
      setStrippedToken(sessionStorage.getItem("join-token"))
    }
  }, [token])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-zinc-950 px-4 py-10 pb-24 text-zinc-50">
      <div className="flex w-full max-w-3xl flex-col items-center gap-8 md:flex-row">
        {/* camera preview mock */}
        <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-2xl bg-zinc-800">
          <div className="absolute inset-0 flex items-center justify-center">
            <Avatar className="size-20">
              <AvatarFallback className="bg-zinc-700 text-2xl text-zinc-200">
                {client.initials}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            <span className="flex size-10 items-center justify-center rounded-full bg-zinc-700/80">
              <Mic className="size-4" />
            </span>
            <span className="flex size-10 items-center justify-center rounded-full bg-zinc-700/80">
              <Video className="size-4" />
            </span>
          </div>
          <span className="absolute top-3 left-3 text-xs text-zinc-400">
            {t.joinMicCam}
          </span>
        </div>

        <Card className="w-full max-w-sm bg-zinc-900 ring-zinc-800">
          <CardContent className="flex flex-col gap-5 text-zinc-50">
            <div>
              <h1 className="text-lg font-semibold">{t.joinTitle}</h1>
              <p className="mt-1 text-sm text-zinc-400">
                {t.joinWith(coach.name)} · {t.sessionKindIntake}
              </p>
              <p className="text-sm text-zinc-400">
                23.07.2026 · 10:00 · {t.minutes(session.durationMin)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/60 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-300">
              {t.joinNotice}
            </div>
            <Button
              size="lg"
              className="bg-white text-zinc-900 hover:bg-zinc-200"
              onClick={() => void navigate({ to: "/room" })}
            >
              {t.joinCta}
            </Button>
            <div className="text-center text-[11px] text-zinc-500">
              токен в URL:{" "}
              {strippedToken ? (
                <Badge
                  variant="outline"
                  className="border-zinc-700 text-zinc-400"
                >
                  вычищен → sessionStorage
                </Badge>
              ) : (
                "…"
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
