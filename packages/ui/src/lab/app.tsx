import { useEffect, useMemo, useState } from "react"
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  InformationCircleIcon,
  PaintBrush01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Heading } from "@/components/heading"
import { Text } from "@/components/text"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Toaster, toast } from "@/components/ui/toast"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  interfaceTypographyRoles,
  typographyRecipe,
  type InterfaceTypographyRole,
} from "@/lib/typography"
import { cn } from "@/lib/utils"

type ThemeName = "light" | "dark"
type StatusName = "success" | "warning" | "error" | "info"
type StatusToken = "base" | "foreground" | "surface" | "border"
type StatusDraft = Record<ThemeName, Record<StatusName, Record<StatusToken, string>>>

const statusNames: readonly StatusName[] = ["success", "warning", "error", "info"]
const statusTokens: readonly StatusToken[] = ["base", "foreground", "surface", "border"]
const storageKey = "praximo.ui-lab.status-draft.v1"

const defaultStatusDraft: StatusDraft = {
  light: {
    success: { base: "#16803b", foreground: "#ffffff", surface: "#effcf3", border: "#8ed5a5" },
    warning: { base: "#a65400", foreground: "#2c1600", surface: "#fff7e1", border: "#e9b961" },
    error: { base: "#d52b36", foreground: "#ffffff", surface: "#fff1f2", border: "#ef9aa0" },
    info: { base: "#2463d4", foreground: "#ffffff", surface: "#eff5ff", border: "#9ebbf0" },
  },
  dark: {
    success: { base: "#49cc76", foreground: "#071f0f", surface: "#143320", border: "#287b43" },
    warning: { base: "#f0a132", foreground: "#291700", surface: "#39280e", border: "#8f5a19" },
    error: { base: "#f06a72", foreground: "#2a090b", surface: "#3c171a", border: "#943c43" },
    info: { base: "#73a5ff", foreground: "#07162d", surface: "#152844", border: "#3f6daf" },
  },
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const normalized = hex.replace("#", "")
  const value = Number.parseInt(normalized, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function linearizeColorChannel(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex)

  return (
    0.2126 * linearizeColorChannel(red) +
    0.7152 * linearizeColorChannel(green) +
    0.0722 * linearizeColorChannel(blue)
  )
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

function readDraft(): StatusDraft {
  try {
    const persisted = localStorage.getItem(storageKey)
    return persisted ? (JSON.parse(persisted) as StatusDraft) : defaultStatusDraft
  } catch {
    return defaultStatusDraft
  }
}

function cssVariable(status: StatusName, token: StatusToken): string {
  return `--${status}${token === "base" ? "" : `-${token}`}`
}

function applyDraft(theme: ThemeName, draft: StatusDraft) {
  for (const status of statusNames) {
    for (const token of statusTokens) {
      document.documentElement.style.setProperty(
        cssVariable(status, token),
        draft[theme][status][token],
      )
    }
  }
}

function draftToCss(draft: StatusDraft): string {
  return (["light", "dark"] as const)
    .map((theme) => {
      const selector = theme === "light" ? ":root" : ".dark"
      const declarations = statusNames.flatMap((status) =>
        statusTokens.map(
          (token) => `  ${cssVariable(status, token)}: ${draft[theme][status][token]};`,
        ),
      )
      return `${selector} {\n${declarations.join("\n")}\n}`
    })
    .join("\n\n")
}

function Section({
  children,
  description,
  title,
}: {
  readonly children: React.ReactNode
  readonly description: string
  readonly title: string
}) {
  return (
    <section className="space-y-5" aria-labelledby={`section-${title}`}>
      <div className="space-y-1">
        <Heading id={`section-${title}`} as="h2" role="section-title">
          {title}
        </Heading>
        <Text role="body-small" className="text-muted-foreground">
          {description}
        </Text>
      </div>
      {children}
    </section>
  )
}

function StatusEditor({
  draft,
  onChange,
  onReset,
}: {
  readonly draft: StatusDraft
  readonly onChange: (draft: StatusDraft) => void
  readonly onReset: () => void
}) {
  const css = draftToCss(draft)

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-3xl border-collapse text-left">
          <caption className="sr-only">Editable light and dark status colors</caption>
          <thead>
            <tr className="border-b">
              <th className="p-3">Theme / family</th>
              {statusTokens.map((token) => (
                <th key={token} className="p-3 capitalize">
                  {token}
                </th>
              ))}
              <th className="p-3">Contrast</th>
            </tr>
          </thead>
          <tbody>
            {(["light", "dark"] as const).flatMap((theme) =>
              statusNames.map((status) => {
                const values = draft[theme][status]
                const ratio = contrastRatio(values.foreground, values.base)

                return (
                  <tr key={`${theme}-${status}`} className="border-b last:border-0">
                    <th className="p-3 capitalize">
                      {theme} · {status}
                    </th>
                    {statusTokens.map((token) => (
                      <td key={token} className="p-3">
                        <label className="flex items-center gap-2">
                          <input
                            aria-label={`${theme} ${status} ${token}`}
                            type="color"
                            value={values[token]}
                            onChange={(event) =>
                              onChange({
                                ...draft,
                                [theme]: {
                                  ...draft[theme],
                                  [status]: {
                                    ...values,
                                    [token]: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                          <Text as="span" role="caption" mono>
                            {values[token]}
                          </Text>
                        </label>
                      </td>
                    ))}
                    <td className="p-3">
                      <Badge variant={ratio >= 4.5 ? "secondary" : "destructive"}>
                        {ratio.toFixed(2)}:1 {ratio >= 4.5 ? "AA" : "Fail"}
                      </Badge>
                    </td>
                  </tr>
                )
              }),
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(css)}>
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} data-icon="inline-start" />
          Copy CSS
        </Button>
        <Button variant="ghost" onClick={onReset}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} data-icon="inline-start" />
          Reset colors
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-2xl bg-muted p-4 font-mono text-xs">{css}</pre>
    </div>
  )
}

function TypographyGallery() {
  const sampleByRole: Record<InterfaceTypographyRole, string> = {
    display: "48 active clients",
    "page-title": "Practice overview",
    "section-title": "Upcoming sessions",
    "card-title": "Discovery call · Elena Petrova",
    body: "Keep the next step visible and the current state unambiguous.",
    "body-small": "Updated 12 minutes ago by the Manager Bot.",
    label: "Session duration",
    caption: "DEVELOPMENT · UTC+2",
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {interfaceTypographyRoles.map((role) => (
          <Card key={role}>
            <CardHeader>
              <Badge variant="outline">{role}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={typographyRecipe({ role })}>{sampleByRole[role]}</div>
              <div className={typographyRecipe({ role })}>
                Cyrillic: Следующая сессия начинается через двадцать минут
              </div>
              <div className={cn(typographyRecipe({ role }), "truncate")}>
                Truncate · An intentionally long application label that must remain on one line
              </div>
              <div className={cn(typographyRecipe({ role, mono: true }), "tabular-nums")}>
                2026-07-28 · 01:42:09 · €1,248.50
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Mobile</CardTitle>
            <CardDescription>320 px wrapping pressure</CardDescription>
          </CardHeader>
          <CardContent className="max-w-[320px] space-y-2">
            <Heading as="h3" role="card-title">
              A long workspace title wraps without losing hierarchy
            </Heading>
            <Text role="body-small">
              Latin and Cyrillic coexist: Coach workspace · Практика коуча.
            </Text>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Desktop</CardTitle>
            <CardDescription>Dense table-like application context</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-[1fr_auto_auto] gap-3">
            <Text role="label">Elena Petrova</Text>
            <Text role="caption" className="text-muted-foreground">
              Awaiting Setup
            </Text>
            <Text role="body-small" mono className="tabular-nums">
              14:30
            </Text>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Component recipes</CardTitle>
          <CardDescription>
            Shared recipes inside card, field, button, and badge slots.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field className="max-w-sm">
            <FieldLabel htmlFor="recipe-input">Workspace title</FieldLabel>
            <Input id="recipe-input" defaultValue="North Star Practice" />
            <FieldDescription>Shown to coaches and clients.</FieldDescription>
          </Field>
          <Button>Save workspace</Button>
          <Badge>Ready</Badge>
        </CardContent>
      </Card>
    </div>
  )
}

function PrimitiveGallery() {
  return (
    <div className="lab-grid">
      <Card>
        <CardHeader>
          <CardTitle>Actions and states</CardTitle>
          <CardDescription>Hover, press, keyboard focus, disabled, and error.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Toggle aria-label="Pin workspace">Toggle</Toggle>
          <Switch aria-label="Notifications" defaultChecked />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forms</CardTitle>
          <CardDescription>Labels, groups, textarea, and validation.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="lab-email">Contact email</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>@</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput id="lab-email" defaultValue="coach@example.com" />
              </InputGroup>
              <FieldDescription>Used for operational recovery only.</FieldDescription>
            </Field>
            <Field data-invalid="true">
              <FieldLabel htmlFor="lab-note">Session note</FieldLabel>
              <Textarea id="lab-note" aria-invalid defaultValue="Too short" />
              <FieldError>Write at least 20 characters.</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status and feedback</CardTitle>
          <CardDescription>
            Semantic tones remain distinct from destructive actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {statusNames.map((status) => (
            <Alert
              key={status}
              style={{
                background: `var(--${status}-surface)`,
                borderColor: `var(--${status}-border)`,
                color: `var(--${status})`,
              }}
            >
              <AlertTitle className="capitalize">{status}</AlertTitle>
              <AlertDescription className="text-current">
                Observable {status} state with semantic surface and border.
              </AlertDescription>
            </Alert>
          ))}
          <Button
            variant="outline"
            onClick={() =>
              toast.add({
                title: "Workspace saved",
                description: "The draft is available to the Manager Bot.",
                type: "success",
              })
            }
          >
            Show toast
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People and lists</CardTitle>
          <CardDescription>Avatar, item, badge, empty, skeleton, and spinner.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Item variant="outline">
            <ItemMedia>
              <Avatar>
                <AvatarFallback>EP</AvatarFallback>
                <AvatarBadge />
              </Avatar>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Elena Petrova</ItemTitle>
              <ItemDescription>Next session today at 14:30</ItemDescription>
            </ItemContent>
            <Badge variant="secondary">Active</Badge>
          </Item>
          <Empty className="min-h-48 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>No archived sessions</EmptyTitle>
              <EmptyDescription>Completed sessions will appear here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm">
                Return to sessions
              </Button>
            </EmptyContent>
          </Empty>
          <div className="flex items-center gap-3">
            <Spinner />
            <Skeleton className="h-4 flex-1" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Selection and overlays</CardTitle>
          <CardDescription>Open-state and keyboard behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleGroup defaultValue={["week"]} variant="outline">
            <ToggleGroupItem value="day">Day</ToggleGroupItem>
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
          </ToggleGroup>
          <Separator />
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="outline" />}>
                Open dialog
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this workspace?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This is a visual state only; no data is changed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Drawer>
              <DrawerTrigger render={<Button variant="outline" />}>Open drawer</DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Session actions</DrawerTitle>
                  <DrawerDescription>Mobile overlay and swipe behavior.</DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <DrawerClose render={<Button />}>Done</DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>Focus, selected day, and range-ready slots.</CardDescription>
        </CardHeader>
        <CardContent>
          <Calendar mode="single" defaultMonth={new Date(2026, 6)} />
        </CardContent>
      </Card>
    </div>
  )
}

export function UiLab() {
  const [theme, setTheme] = useState<ThemeName>("light")
  const [reducedMotion, setReducedMotion] = useState(false)
  const [draft, setDraft] = useState<StatusDraft>(readDraft)
  const systemPrefersReducedMotion = useMemo(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  )

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.classList.toggle("reduce-motion", reducedMotion)
    document.documentElement.style.colorScheme = theme
    applyDraft(theme, draft)
  }, [draft, reducedMotion, theme])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft))
  }, [draft])

  return (
    <Toaster>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <HugeiconsIcon icon={PaintBrush01Icon} strokeWidth={2} />
              </span>
              <div>
                <Heading as="h1" role="card-title">
                  Praximo UI Lab
                </Heading>
                <Text role="caption" className="text-muted-foreground">
                  Maia · Base UI · development only
                </Text>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ToggleGroup
                value={[theme]}
                onValueChange={(value) => {
                  const nextTheme = value[0]
                  if (nextTheme === "light" || nextTheme === "dark") setTheme(nextTheme)
                }}
                variant="outline"
                spacing={0}
                aria-label="Theme"
              >
                <ToggleGroupItem value="light">Light</ToggleGroupItem>
                <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
              </ToggleGroup>
              <Label>
                <Switch checked={reducedMotion} onCheckedChange={setReducedMotion} />
                Reduced motion
              </Label>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-16 px-4 py-10 sm:px-6">
          <div className="space-y-3">
            <Badge variant="secondary">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
              Static CSS is authoritative
            </Badge>
            <Heading as="h1" role="page-title">
              Shared interface foundation
            </Heading>
            <Text className="max-w-3xl text-muted-foreground">
              Inspect semantic typography, primitive states, status contrast, and meaningful motion
              before the same package is consumed by Admin, Coach, Client, and WWW.
            </Text>
            <Text role="caption" className="text-muted-foreground">
              System prefers-reduced-motion: {systemPrefersReducedMotion ? "reduce" : "normal"}
            </Text>
          </div>

          <Section
            title="Typography"
            description="All semantic roles, localized samples, wrapping, truncation, and tabular data."
          >
            <TypographyGallery />
          </Section>

          <Section
            title="Status colors"
            description="Draft both themes locally, inspect WCAG contrast, and copy candidate static CSS."
          >
            <StatusEditor
              draft={draft}
              onChange={setDraft}
              onReset={() => {
                localStorage.removeItem(storageKey)
                setDraft(defaultStatusDraft)
              }}
            />
          </Section>

          <Section
            title="Primitives"
            description="The installed product union with representative interaction and open states."
          >
            <PrimitiveGallery />
          </Section>
        </main>
      </div>
    </Toaster>
  )
}
