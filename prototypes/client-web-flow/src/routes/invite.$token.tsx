// PROTOTYPE — web acceptance page (wayfinder #28): language → profile →
// consent (the single commit) → confirmation. In-memory state only.
import { useRef, useState } from "react"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { Camera, Check, ShieldCheck } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { dict, localeNames, type Locale } from "@/lib/i18n"
import { client, coach, invites, session, type InviteToken } from "@/lib/mock"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/invite/$token")({
  component: AcceptancePage,
  loader: ({ params }) => {
    if (!(params.token in invites)) throw notFound()
    return { token: params.token as InviteToken }
  },
  notFoundComponent: ExpiredInvite,
})

type Step = "language" | "profile" | "consent" | "done"

function AcceptancePage() {
  const { token } = Route.useLoaderData()
  const invite = invites[token]
  const [step, setStep] = useState<Step>("language")
  const [locale, setLocale] = useState<Locale>(invite.language)
  const [name, setName] = useState(client.name)
  const [email, setEmail] = useState(
    invite.delivery === "email" ? client.email : "",
  )
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [googleDone, setGoogleDone] = useState(false)

  const steps: Array<Step> = ["language", "profile", "consent", "done"]
  const stepIdx = steps.indexOf(step)

  return (
    <main className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-10 pb-24">
      {/* branded header: the coach's assistant, not "a platform" */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <Avatar className="size-14">
          <AvatarFallback className="bg-zinc-900 text-lg text-white">
            {coach.initials}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <div className="text-sm font-semibold">{coach.name}</div>
          <div className="text-xs text-muted-foreground">Praximo</div>
        </div>
      </div>

      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-6">
          {step === "language" && (
            <LanguageStep
              locale={locale}
              onPick={setLocale}
              onNext={() => setStep("profile")}
            />
          )}
          {step === "profile" && (
            <ProfileStep
              locale={locale}
              invite={invite}
              name={name}
              setName={setName}
              email={email}
              setEmail={setEmail}
              avatarUrl={avatarUrl}
              setAvatarUrl={setAvatarUrl}
              googleDone={googleDone}
              setGoogleDone={setGoogleDone}
              onBack={() => setStep("language")}
              onNext={() => setStep("consent")}
            />
          )}
          {step === "consent" && (
            <ConsentStep
              locale={locale}
              onBack={() => setStep("profile")}
              onAgree={() => setStep("done")}
            />
          )}
          {step === "done" && (
            <DoneStep locale={locale} email={email} avatarUrl={avatarUrl} name={name} />
          )}
        </CardContent>
      </Card>

      {/* progress dots */}
      <div className="mt-5 flex gap-1.5">
        {steps.slice(0, 3).map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === Math.min(stepIdx, 2) ? "w-6 bg-foreground" : "w-1.5 bg-border",
            )}
          />
        ))}
      </div>
    </main>
  )
}

function LanguageStep({
  locale,
  onPick,
  onNext,
}: {
  locale: Locale
  onPick: (l: Locale) => void
  onNext: () => void
}) {
  const t = dict[locale]
  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">{t.accLanguageTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.accLanguageSubtitle(coach.name)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {(Object.keys(localeNames) as Array<Locale>).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onPick(l)}
            className={cn(
              "flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors",
              l === locale
                ? "border-foreground bg-foreground/5"
                : "border-border hover:bg-muted",
            )}
          >
            {localeNames[l]}
            {l === locale && <Check className="size-4" />}
          </button>
        ))}
      </div>
      <Button size="lg" onClick={onNext}>
        {t.accContinue}
      </Button>
    </>
  )
}

function ProfileStep(props: {
  locale: Locale
  invite: (typeof invites)[InviteToken]
  name: string
  setName: (v: string) => void
  email: string
  setEmail: (v: string) => void
  avatarUrl: string | null
  setAvatarUrl: (v: string | null) => void
  googleDone: boolean
  setGoogleDone: (v: boolean) => void
  onBack: () => void
  onNext: () => void
}) {
  const t = dict[props.locale]
  const fileRef = useRef<HTMLInputElement>(null)
  const [googleOpen, setGoogleOpen] = useState(false)
  const emailKnown = props.invite.delivery === "email"

  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">{t.accProfileTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.accProfileSubtitle(coach.name)}
        </p>
      </div>

      {props.googleDone ? (
        <Badge variant="secondary" className="self-start">
          <ShieldCheck className="size-3.5" /> {t.accGoogleDone}
        </Badge>
      ) : (
        <>
          <Button variant="outline" size="lg" onClick={() => setGoogleOpen(true)}>
            <GoogleLogo /> {t.accGoogle}
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">{t.accOr}</span>
            <Separator className="flex-1" />
          </div>
        </>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative"
          title={t.accUpload}
        >
          <Avatar className="size-16">
            {props.avatarUrl && <AvatarImage src={props.avatarUrl} />}
            <AvatarFallback className="text-lg">{client.initials}</AvatarFallback>
          </Avatar>
          <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border bg-background shadow-sm">
            <Camera className="size-3.5" />
          </span>
        </button>
        <div className="text-xs text-muted-foreground">
          {t.accAvatarLabel} · {t.accAvatarHint}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) props.setAvatarUrl(URL.createObjectURL(f))
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t.accNameLabel}</Label>
        <Input
          id="name"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
        />
      </div>

      {!emailKnown && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t.accEmailLabel}</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={props.email}
            onChange={(e) => props.setEmail(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t.accEmailHint}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="lg" onClick={props.onBack}>
          {t.accBack}
        </Button>
        <Button size="lg" className="flex-1" onClick={props.onNext}>
          {t.accContinue}
        </Button>
      </div>

      <GoogleChooserDialog
        open={googleOpen}
        onOpenChange={setGoogleOpen}
        onPick={() => {
          props.setName("Maria Petrenko")
          props.setEmail(client.email)
          props.setAvatarUrl(googleAvatarDataUri)
          props.setGoogleDone(true)
          setGoogleOpen(false)
        }}
      />
    </>
  )
}

// mock of Google's account chooser — validates the "one-tap fills the profile" feel
function GoogleChooserDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            <GoogleLogo /> Sign in with Google{" "}
            <Badge variant="outline">мок OAuth</Badge>
          </div>
          <DialogTitle className="text-base">Choose an account</DialogTitle>
          <DialogDescription>to continue to praximo.io</DialogDescription>
        </DialogHeader>
        <button
          type="button"
          onClick={onPick}
          className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left hover:bg-muted"
        >
          <Avatar className="size-9">
            <AvatarImage src={googleAvatarDataUri} />
            <AvatarFallback>M</AvatarFallback>
          </Avatar>
          <div>
            <div className="text-sm font-medium">Maria Petrenko</div>
            <div className="text-xs text-muted-foreground">{client.email}</div>
          </div>
        </button>
        <p className="text-xs text-muted-foreground">
          Praximo получит имя, фото и email. Токен не сохраняется, аккаунт не
          создаётся — только заполнение профиля (google_sub фиксируется).
        </p>
      </DialogContent>
    </Dialog>
  )
}

function ConsentStep({
  locale,
  onBack,
  onAgree,
}: {
  locale: Locale
  onBack: () => void
  onAgree: () => void
}) {
  const t = dict[locale]
  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">{t.accConsentTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.accConsentIntro(coach.name)}
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {t.accConsentItems.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <a href="#" className="text-sm underline underline-offset-4">
        {t.accPrivacyLink}
      </a>
      <div className="flex gap-2">
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t.accBack}
        </Button>
        <Button size="lg" className="flex-1" onClick={onAgree}>
          {t.accAgree}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {t.accNothingSaved}
      </p>
    </>
  )
}

function DoneStep({
  locale,
  email,
  name,
  avatarUrl,
}: {
  locale: Locale
  email: string
  name: string
  avatarUrl: string | null
}) {
  const t = dict[locale]
  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-green-100">
          <Check className="size-6 text-green-700" />
        </div>
        <h1 className="text-lg font-semibold">{t.accDoneTitle(coach.name)}</h1>
        <p className="text-sm text-muted-foreground">
          {t.accDoneBody(coach.name)}
        </p>
      </div>
      <div className="rounded-2xl border bg-muted/40 px-4 py-3">
        <div className="text-sm font-semibold">{t.accDoneSession}</div>
        <div className="text-sm text-muted-foreground">
          23.07.2026 · 10:00 · {t.minutes(session.durationMin)}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border px-4 py-3">
        <Avatar className="size-9">
          {avatarUrl && <AvatarImage src={avatarUrl} />}
          <AvatarFallback>{client.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{name}</div>
          {email && (
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          )}
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {email ? t.accDoneReminder.email : t.accDoneReminder.manual(coach.name)}
      </p>
      <p className="text-center text-xs text-muted-foreground/60">
        (прототип: канал ={" "}
        {email ? `email — ${email}` : "manual — напоминания пойдут коучу"})
      </p>
      <Button
        variant="outline"
        size="lg"
        render={<Link to="/email/reminder" search={{ lang: locale }} />}
      >
        Дальше по флоу: reminder email →
      </Button>
    </>
  )
}

function ExpiredInvite() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-lg font-semibold">Ссылка больше не действует</h1>
          <p className="text-sm text-muted-foreground">
            Попросите вашего коуча прислать новую ссылку-приглашение.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.1A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
      />
    </svg>
  )
}

// tiny inline "Google profile photo" so the mock needs no network
const googleAvatarDataUri =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#7c3aed"/><text x="48" y="62" font-family="sans-serif" font-size="42" fill="#fff" text-anchor="middle">M</text></svg>`,
  )
