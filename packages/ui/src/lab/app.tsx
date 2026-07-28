import { useEffect, useId, useMemo, useState } from "react"
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  InformationCircleIcon,
  PaintBrush01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import tailwindColors from "tailwindcss/colors"

import { Heading } from "../components/heading.tsx"
import { Text } from "../components/text.tsx"
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
} from "../components/ui/alert-dialog.tsx"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import { Avatar, AvatarBadge, AvatarFallback } from "../components/ui/avatar.tsx"
import { Badge } from "../components/ui/badge.tsx"
import { Button } from "../components/ui/button.tsx"
import { Calendar } from "../components/ui/calendar.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.tsx"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../components/ui/drawer.tsx"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty.tsx"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field.tsx"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "../components/ui/input-group.tsx"
import { Input } from "../components/ui/input.tsx"
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../components/ui/item.tsx"
import { Label } from "../components/ui/label.tsx"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../components/ui/popover.tsx"
import { ScrollArea } from "../components/ui/scroll-area.tsx"
import { Separator } from "../components/ui/separator.tsx"
import { Skeleton } from "../components/ui/skeleton.tsx"
import { Spinner } from "../components/ui/spinner.tsx"
import { Switch } from "../components/ui/switch.tsx"
import { Textarea } from "../components/ui/textarea.tsx"
import { Toaster, toast } from "../components/ui/toast.tsx"
import { Toggle } from "../components/ui/toggle.tsx"
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.tsx"
import {
  interfaceTypographyRoles,
  typographyRecipe,
  type InterfaceTypographyRole,
} from "../lib/typography.ts"
import { cn } from "../lib/utils.ts"
import { contrastRatio, hexToOklch, normalizeOklch, oklchToHex } from "./status-colors.ts"

type ThemeName = "light" | "dark"
type StatusName = "success" | "warning" | "error" | "info"
type StatusToken = "base" | "foreground" | "surface" | "border"
type StatusDraft = Record<ThemeName, Record<StatusName, Record<StatusToken, string>>>
type PrimaryDraft = Record<ThemeName, string>

const statusNames: readonly StatusName[] = ["success", "warning", "error", "info"]
const statusTokens: readonly StatusToken[] = ["base", "foreground", "surface", "border"]
const tailwindFamilies = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "mauve",
  "olive",
  "mist",
  "taupe",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const
const tailwindShades = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const
const tailwindFixedColors = ["white", "black"] as const
const storageKey = "praximo.ui-lab.status-draft.v2"
const legacyStorageKey = "praximo.ui-lab.status-draft.v1"
const primaryStorageKey = "praximo.ui-lab.primary-draft.v1"

const defaultPrimaryDraft: PrimaryDraft = {
  light: "oklch(0.491 0.27 292.581)",
  dark: "oklch(0.606 0.25 292.717)",
}
const primaryInk: PrimaryDraft = {
  light: "oklch(0.969 0.016 293.756)",
  dark: "oklch(0.141 0.005 285.823)",
}

const defaultStatusDraft: StatusDraft = {
  light: {
    success: {
      base: "oklch(0.527142 0.138742 149.393)",
      foreground: "oklch(1 0 0)",
      surface: "oklch(0.978938 0.018074 155.825)",
      border: "oklch(0.81303 0.098609 154.122)",
    },
    warning: {
      base: "oklch(0.53567 0.132805 54.892)",
      foreground: "oklch(1 0 0)",
      surface: "oklch(0.976562 0.030054 90.324)",
      border: "oklch(0.811489 0.119614 80.886)",
    },
    error: {
      base: "oklch(0.569446 0.204136 23.849)",
      foreground: "oklch(1 0 0)",
      surface: "oklch(0.96941 0.015168 12.422)",
      border: "oklch(0.773069 0.10222 15.117)",
    },
    info: {
      base: "oklch(0.527401 0.185892 261.051)",
      foreground: "oklch(1 0 0)",
      surface: "oklch(0.96852 0.014848 260.73)",
      border: "oklch(0.789593 0.082309 262.281)",
    },
  },
  dark: {
    success: {
      base: "oklch(0.752819 0.167918 151.343)",
      foreground: "oklch(0.214738 0.043673 152.115)",
      surface: "oklch(0.291125 0.051042 154.663)",
      border: "oklch(0.51861 0.118061 150.665)",
    },
    warning: {
      base: "oklch(0.769588 0.150375 70.204)",
      foreground: "oklch(0.22369 0.047976 71.705)",
      surface: "oklch(0.290916 0.046915 75.559)",
      border: "oklch(0.515505 0.103285 66.234)",
    },
    error: {
      base: "oklch(0.689981 0.165384 18.865)",
      foreground: "oklch(0.199081 0.05497 20.062)",
      surface: "oklch(0.261651 0.05837 17.014)",
      border: "oklch(0.477707 0.118743 17.97)",
    },
    info: {
      base: "oklch(0.725501 0.142209 261.448)",
      foreground: "oklch(0.201659 0.050721 258.426)",
      surface: "oklch(0.276339 0.05785 257.985)",
      border: "oklch(0.533769 0.115953 257.537)",
    },
  },
}

function normalizeStoredDraft(value: unknown): StatusDraft | null {
  if (typeof value !== "object" || value === null) return null

  const source = value as Record<string, unknown>
  const normalized = structuredClone(defaultStatusDraft)

  for (const theme of ["light", "dark"] as const) {
    const themeSource = source[theme]
    if (typeof themeSource !== "object" || themeSource === null) return null

    for (const status of statusNames) {
      const statusSource = (themeSource as Record<string, unknown>)[status]
      if (typeof statusSource !== "object" || statusSource === null) return null

      for (const token of statusTokens) {
        const color = (statusSource as Record<string, unknown>)[token]
        if (typeof color !== "string") return null
        const oklch = normalizeOklch(color) ?? hexToOklch(color)
        if (oklch === null) return null
        normalized[theme][status][token] = oklch
      }
    }
  }

  return normalized
}

function readDraft(): StatusDraft {
  try {
    const persisted = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey)
    return persisted
      ? (normalizeStoredDraft(JSON.parse(persisted)) ?? defaultStatusDraft)
      : defaultStatusDraft
  } catch {
    return defaultStatusDraft
  }
}

function readPrimaryDraft(): PrimaryDraft {
  try {
    const persisted = localStorage.getItem(primaryStorageKey)
    if (persisted === null) return defaultPrimaryDraft

    const value = JSON.parse(persisted) as unknown
    if (typeof value !== "object" || value === null) return defaultPrimaryDraft

    const source = value as Record<string, unknown>
    const light = typeof source.light === "string" ? normalizeOklch(source.light) : null
    const dark = typeof source.dark === "string" ? normalizeOklch(source.dark) : null
    return light === null || dark === null ? defaultPrimaryDraft : { light, dark }
  } catch {
    return defaultPrimaryDraft
  }
}

function cssVariable(status: StatusName, token: StatusToken): string {
  return `--${status}${token === "base" ? "" : `-${token}`}`
}

function applyDraft(theme: ThemeName, draft: StatusDraft, primaryDraft: PrimaryDraft) {
  document.documentElement.style.setProperty("--primary", primaryDraft[theme])

  for (const status of statusNames) {
    for (const token of statusTokens) {
      document.documentElement.style.setProperty(
        cssVariable(status, token),
        draft[theme][status][token],
      )
    }
  }
}

function draftToCss(draft: StatusDraft, primaryDraft: PrimaryDraft): string {
  return (["light", "dark"] as const)
    .map((theme) => {
      const selector = theme === "light" ? ":root" : ".dark"
      const primary = normalizeOklch(primaryDraft[theme])
      if (primary === null) throw new Error(`Invalid OKLCH value for ${theme} primary`)
      const declarations = [
        `  --primary: ${primary};`,
        ...statusNames.flatMap((status) =>
          statusTokens.map((token) => {
            const value = normalizeOklch(draft[theme][status][token])
            if (value === null)
              throw new Error(`Invalid OKLCH value for ${theme} ${status} ${token}`)
            return `  ${cssVariable(status, token)}: ${value};`
          }),
        ),
      ]
      return `${selector} {\n${declarations.join("\n")}\n}`
    })
    .join("\n\n")
}

function tailwindColor(
  family: (typeof tailwindFamilies)[number],
  shade: (typeof tailwindShades)[number],
) {
  const value = tailwindColors[family][shade]
  const normalized = normalizeOklch(value)
  if (normalized === null) throw new Error(`Tailwind ${family}-${shade} is not an OKLCH color`)
  return normalized
}

function tailwindFixedColor(name: (typeof tailwindFixedColors)[number]) {
  const value = hexToOklch(tailwindColors[name])
  if (value === null) throw new Error(`Tailwind ${name} is not a supported color`)
  return value
}

function TailwindSwatch({
  name,
  value,
  onChange,
}: {
  readonly name: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      feedback={false}
      aria-label={`Tailwind ${name}`}
      title={`${name} · ${value}`}
      className="size-5 rounded-full border-black/10 p-0 shadow-xs transition-transform hover:scale-110 dark:border-white/15"
      style={{ backgroundColor: value }}
      onClick={() => onChange(value)}
    />
  )
}

function TailwindPalette({
  label,
  onChange,
}: {
  readonly label: string
  readonly onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="xs" />}>Tailwind</PopoverTrigger>
      <PopoverContent align="start" className="w-[min(38rem,calc(100vw-2rem))] gap-3 p-0">
        <PopoverHeader className="px-4 pt-4">
          <PopoverTitle>Tailwind palette</PopoverTitle>
          <PopoverDescription>
            Choose a color from the pinned Tailwind palette for {label}.
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid grid-cols-[3.75rem_repeat(11,1.25rem)] items-center gap-1 px-4 text-center">
          <span />
          {tailwindShades.map((shade) => (
            <span key={shade} className="font-mono text-[8px] leading-none text-muted-foreground">
              {shade}
            </span>
          ))}
        </div>
        <ScrollArea className="h-64 sm:h-80">
          <div className="space-y-1 px-4 pb-4">
            <div className="grid grid-cols-[3.75rem_repeat(11,1.25rem)] items-center gap-1">
              <Text as="span" role="caption" className="truncate capitalize">
                fixed
              </Text>
              {tailwindFixedColors.map((name) => (
                <TailwindSwatch
                  key={name}
                  name={name}
                  value={tailwindFixedColor(name)}
                  onChange={(value) => {
                    onChange(value)
                    setOpen(false)
                  }}
                />
              ))}
            </div>
            {tailwindFamilies.map((family) => (
              <div
                key={family}
                className="grid grid-cols-[3.75rem_repeat(11,1.25rem)] items-center gap-1"
              >
                <Text as="span" role="caption" className="truncate capitalize">
                  {family}
                </Text>
                {tailwindShades.map((shade) => {
                  const value = tailwindColor(family, shade)
                  return (
                    <TailwindSwatch
                      key={shade}
                      name={`${family}-${shade}`}
                      value={value}
                      onChange={(nextValue) => {
                        onChange(nextValue)
                        setOpen(false)
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const [inputValue, setInputValue] = useState(value)
  const normalizedInput = normalizeOklch(inputValue)
  const invalid = normalizedInput === null

  useEffect(() => {
    setInputValue(value)
  }, [value])

  const commit = () => {
    if (normalizedInput === null) return
    setInputValue(normalizedInput)
    onChange(normalizedInput)
  }

  return (
    <Field data-invalid={invalid} className="min-w-64 gap-1.5">
      <FieldLabel className="sr-only" htmlFor={`${label.replaceAll(" ", "-")}-oklch`}>
        {label} in OKLCH
      </FieldLabel>
      <Input
        id={`${label.replaceAll(" ", "-")}-oklch`}
        aria-invalid={invalid}
        aria-label={`${label} OKLCH`}
        className="font-mono text-xs"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit()
        }}
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            aria-label={`${label} visual picker`}
            type="color"
            value={oklchToHex(value)}
            onChange={(event) => {
              const oklch = hexToOklch(event.target.value)
              if (oklch !== null) onChange(oklch)
            }}
          />
          <Text as="span" role="caption" className="text-muted-foreground">
            Picker
          </Text>
        </label>
        <TailwindPalette label={label} onChange={onChange} />
      </div>
      {invalid && <FieldError>Use a solid color such as oklch(0.637 0.237 25.331).</FieldError>}
    </Field>
  )
}

function PrimaryEditor({
  draft,
  onChange,
}: {
  readonly draft: PrimaryDraft
  readonly onChange: (draft: PrimaryDraft) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <Heading as="h3" role="card-title">
          Primary
        </Heading>
        <Text role="body-small" className="text-muted-foreground">
          Draft the shadcn primary locally. Static theme defaults remain unchanged.
        </Text>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-xl border-collapse text-left">
          <caption className="sr-only">Editable light and dark primary colors</caption>
          <thead>
            <tr className="border-b">
              <th className="p-3">Theme</th>
              <th className="p-3">Primary</th>
              <th className="p-3">Contrast</th>
            </tr>
          </thead>
          <tbody>
            {(["light", "dark"] as const).map((theme) => {
              const ratio = contrastRatio(primaryInk[theme], draft[theme])
              return (
                <tr key={theme} className="border-b last:border-0">
                  <th className="p-3 capitalize">{theme}</th>
                  <td className="p-3">
                    <ColorControl
                      label={`${theme} primary`}
                      value={draft[theme]}
                      onChange={(value) => onChange({ ...draft, [theme]: value })}
                    />
                  </td>
                  <td className="p-3">
                    <Badge variant={ratio >= 4.5 ? "secondary" : "destructive"}>
                      {ratio.toFixed(2)}:1 {ratio >= 4.5 ? "AA" : "Fail"}
                    </Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
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
  const headingId = useId()

  return (
    <section className="space-y-5" aria-labelledby={headingId}>
      <div className="space-y-1">
        <Heading id={headingId} as="h2" role="section-title">
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
  primaryDraft,
  onChange,
  onPrimaryChange,
  onReset,
}: {
  readonly draft: StatusDraft
  readonly primaryDraft: PrimaryDraft
  readonly onChange: (draft: StatusDraft) => void
  readonly onPrimaryChange: (draft: PrimaryDraft) => void
  readonly onReset: () => void
}) {
  const css = draftToCss(draft, primaryDraft)
  const updateColor = (theme: ThemeName, status: StatusName, token: StatusToken, value: string) => {
    onChange({
      ...draft,
      [theme]: {
        ...draft[theme],
        [status]: {
          ...draft[theme][status],
          [token]: value,
        },
      },
    })
  }

  return (
    <div className="space-y-8">
      <PrimaryEditor draft={primaryDraft} onChange={onPrimaryChange} />
      <div className="space-y-3">
        <div>
          <Heading as="h3" role="card-title">
            Status families
          </Heading>
          <Text role="body-small" className="text-muted-foreground">
            Edit the repository-owned semantic families for both themes.
          </Text>
        </div>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[84rem] border-collapse text-left">
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
                          <ColorControl
                            label={`${theme} ${status} ${token}`}
                            value={values[token]}
                            onChange={(value) => updateColor(theme, status, token, value)}
                          />
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
      </div>
      <Text role="caption" className="text-muted-foreground">
        Primary and status drafts, Tailwind selections, and copied CSS are normalized and stored as
        OKLCH.
      </Text>
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
  const [primaryDraft, setPrimaryDraft] = useState<PrimaryDraft>(readPrimaryDraft)
  const systemPrefersReducedMotion = useMemo(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  )

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.classList.toggle("reduce-motion", reducedMotion)
    document.documentElement.style.colorScheme = theme
    applyDraft(theme, draft, primaryDraft)
  }, [draft, primaryDraft, reducedMotion, theme])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft))
  }, [draft])

  useEffect(() => {
    localStorage.setItem(primaryStorageKey, JSON.stringify(primaryDraft))
  }, [primaryDraft])

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
            title="Theme colors"
            description="Draft primary and status colors locally, inspect WCAG contrast, and copy candidate static CSS."
          >
            <StatusEditor
              draft={draft}
              primaryDraft={primaryDraft}
              onChange={setDraft}
              onPrimaryChange={setPrimaryDraft}
              onReset={() => {
                localStorage.removeItem(storageKey)
                localStorage.removeItem(legacyStorageKey)
                localStorage.removeItem(primaryStorageKey)
                setDraft(defaultStatusDraft)
                setPrimaryDraft(defaultPrimaryDraft)
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
