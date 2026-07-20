// PROTOTYPE — renders a React Email template to HTML and shows it inside a
// Gmail-like chrome, with a locale switcher. Not part of the design under test.
import { useEffect, useState, type ReactElement } from "react"
import { render } from "@react-email/components"
import { Link, useLocation } from "@tanstack/react-router"
import { localeNames, type Locale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function EmailPreview({
  email,
  locale,
  from,
  to,
  subject,
}: {
  email: ReactElement
  locale: Locale
  from: string
  to: string
  subject: string
}) {
  const [html, setHtml] = useState("")
  const { pathname } = useLocation()
  useEffect(() => {
    let alive = true
    void render(email).then(
      (h) =>
        alive &&
        // keep production URLs in the copy, but make the CTA drive the local flow
        setHtml(
          h
            .replaceAll('href="https://app.praximo.io/', 'href="/')
            .replace("<head>", '<head><base target="_top">'),
        ),
    )
    return () => {
      alive = false
    }
  }, [email])
  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="border-b bg-zinc-50 px-5 py-3">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h1 className="truncate text-base font-semibold text-zinc-900">
            {subject}
          </h1>
          <div className="flex shrink-0 gap-1">
            {(Object.keys(localeNames) as Array<Locale>).map((l) => (
              <Link
                key={l}
                to={pathname}
                search={{ lang: l }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  l === locale
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-200",
                )}
              >
                {l.toUpperCase()}
              </Link>
            ))}
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          <div>
            <span className="font-medium text-zinc-700">From:</span> {from}
          </div>
          <div>
            <span className="font-medium text-zinc-700">To:</span> {to}
          </div>
        </div>
      </div>
      <iframe
        title={subject}
        srcDoc={html}
        className="h-[560px] w-full"
      />
    </div>
  )
}
