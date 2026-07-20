// PROTOTYPE — floating flow navigator, not part of the design under evaluation.
import { Link, useLocation } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight, Map } from "lucide-react"

const steps: Array<{ path: string; label: string }> = [
  { path: "/email/invite", label: "1 · Invite email" },
  { path: "/invite/inv_email_demo", label: "2 · Acceptance page" },
  { path: "/email/reminder", label: "3 · Reminder email" },
  { path: "/join/jn_c_M9rT2xKfVb81uQzL", label: "4 · Pre-join" },
  { path: "/room", label: "5 · Room" },
  { path: "/coach/bot", label: "6 · Coach: bot chat" },
  { path: "/coach/miniapp", label: "7 · Coach: Mini App" },
]

export function ProtoNav() {
  const { pathname } = useLocation()
  const idx = steps.findIndex((s) => {
    const [s1, s2] = s.path.split("/").slice(1)
    const [p1, p2] = pathname.split("/").slice(1)
    if (s1 !== p1) return false
    // email/* and coach/* need the second segment; token routes match on the first
    return s1 === "email" || s1 === "coach" ? s2 === p2 : true
  })
  const current = idx >= 0 ? steps[idx] : null
  const prev = steps[(Math.max(idx, 0) - 1 + steps.length) % steps.length]
  const next = steps[(idx + 1) % steps.length]
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/95 px-2 py-1.5 text-zinc-100 shadow-xl backdrop-blur">
      <Link
        to="/"
        className="flex size-7 items-center justify-center rounded-full hover:bg-zinc-700"
        title="Flow map"
      >
        <Map className="size-4" />
      </Link>
      <Link
        to={prev.path}
        className="flex size-7 items-center justify-center rounded-full hover:bg-zinc-700"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <span className="min-w-40 px-1 text-center text-xs font-medium whitespace-nowrap">
        {current ? current.label : "Flow map"}
      </span>
      <Link
        to={next.path}
        className="flex size-7 items-center justify-center rounded-full hover:bg-zinc-700"
      >
        <ArrowRight className="size-4" />
      </Link>
    </div>
  )
}
