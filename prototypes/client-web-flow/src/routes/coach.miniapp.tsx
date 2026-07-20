// PROTOTYPE — Mini App session card (wayfinder #28): copy-link + iOS-only
// navigator.share. The platform switcher simulates Telegram.WebApp.platform.
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Check, ChevronLeft, Copy, EllipsisVertical, Link2, RefreshCw, Share, X } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { client, joinTokens, urls } from "@/lib/mock"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/coach/miniapp")({ component: MiniApp })

type Platform = "ios" | "android" | "tdesktop"
const joinUrl = urls.join(joinTokens.client)

function MiniApp() {
  const [platform, setPlatform] = useState<Platform>("ios")
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(joinUrl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const share = () => {
    // real Mini App: gated by Telegram.WebApp.platform === 'ios', NOT feature-detection
    if (navigator.share) void navigator.share({ url: joinUrl }).catch(() => {})
    else alert("navigator.share недоступен в этом браузере — на реальном iOS откроется share sheet")
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col bg-[#0e1621] pb-24">
      {/* platform switcher — prototype control, not product UI */}
      <div className="flex items-center justify-center gap-1 bg-black/40 py-2">
        {(["ios", "android", "tdesktop"] as Array<Platform>).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              p === platform
                ? "bg-white text-zinc-900"
                : "text-zinc-400 hover:bg-white/10",
            )}
          >
            {p === "ios" ? "iOS" : p === "android" ? "Android" : "Desktop"}
          </button>
        ))}
        <span className="ml-2 text-[10px] text-zinc-500">
          Telegram.WebApp.platform
        </span>
      </div>

      {/* Mini App chrome */}
      <div className="flex items-center justify-between bg-[#17212b] px-3 py-2 text-white">
        <ChevronLeft className="size-5 text-[#708499]" />
        <div className="text-center">
          <div className="text-sm font-semibold">Praximo</div>
          <div className="text-[10px] text-[#708499]">mini app</div>
        </div>
        <div className="flex gap-3 text-[#708499]">
          <EllipsisVertical className="size-5" />
          <X className="size-5" />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 bg-zinc-100 p-4">
        <h1 className="text-sm font-semibold text-zinc-500">Завтра</h1>
        <Card size="sm" className="rounded-2xl">
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-11">
                <AvatarFallback className="bg-violet-100 text-violet-700">
                  {client.initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {client.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  Вводная · 10:00–11:00
                </div>
              </div>
              <Badge variant="secondary">manual</Badge>
            </div>

            <Button size="lg">Войти в сессию</Button>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={copy}>
                {copied ? (
                  <>
                    <Check /> Скопировано
                  </>
                ) : (
                  <>
                    <Copy /> Ссылка клиента
                  </>
                )}
              </Button>
              {platform === "ios" ? (
                <Button variant="outline" onClick={share}>
                  <Share /> Поделиться
                </Button>
              ) : (
                <Button variant="outline" disabled title="только iOS">
                  <Share /> Поделиться
                </Button>
              )}
            </div>
            {platform !== "ios" && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Share скрыт/недоступен: navigator.share есть только в iOS-вебвью
                Telegram (Android WebView и Desktop — нет).
              </p>
            )}

            <button
              type="button"
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-3.5" /> Перевыпустить ссылки (rotation)
            </button>
          </CardContent>
        </Card>

        <div className="flex items-start gap-2 rounded-xl bg-white px-3.5 py-3 text-xs text-zinc-500 shadow-sm">
          <Link2 className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Ссылка клиента: <span className="break-all">{joinUrl}</span> —
            многоразовая, живёт до завершения сессии, переживает перенос времени.
          </span>
        </div>
      </div>
    </main>
  )
}
