import { Avatar, AvatarFallback } from "./ui/avatar.tsx"
import { initials } from "../lib/initials.ts"
import { cn } from "../lib/utils.ts"

/**
 * A person's face: their photo where the platform has one, their initials where it
 * does not (#231).
 *
 * Shared because three surfaces draw it — the coach's roster, a client's own route,
 * and the Acceptance Page's badge — and the rule that matters is the same on all
 * three: **the initials are not a placeholder.** Nobody is ever asked to upload a
 * picture, so for most people the monogram *is* the design, and it has to render
 * first and stay put.
 *
 * **A plain `<img>` rather than `AvatarImage`, deliberately.** The primitive tracks
 * loading state in the browser and so renders nothing at all on the server — which
 * would leave the Acceptance Page, whose whole point is that a client meets a
 * finished page rather than a bundle, with no photo until hydration. The `<img>` is
 * in the markup instead, layered over the fallback: the initials paint immediately
 * and the photo covers them the moment it arrives.
 *
 * `alt=""` because the disc is decorative — the name is always beside it, so a
 * screen reader gains nothing from "photo of …", and a browser given an empty alt
 * renders nothing for an image that fails to load, leaving the initials underneath
 * showing through.
 */

/**
 * The three discs the product actually has, and the **only** place their colours and
 * type scale are written.
 *
 * `docs/agents/ui-development.md` keeps product typography and colour out of
 * `components/ui/**` and off a primitive's `className` — "`className` on a primitive
 * is for caller layout. It must not override the primitive's colors or typography."
 * A composite forwarding an opaque class string onto `AvatarFallback` would be that
 * rule broken once per call site, so the variants live here, where Praximo-owned
 * composition belongs, and a caller picks one by name.
 */
const discs = {
  /** A roster row: small, and it must not shrink when the name beside it is long. */
  row: {
    root: "size-10 shrink-0",
    fallback: "text-xs leading-normal font-semibold",
  },
  /** A client's own route, where the disc is the page's header. */
  page: {
    root: "size-16",
    fallback: "text-xl leading-tight font-semibold",
  },
  /**
   * The Acceptance Page's coach badge — the one disc with a ring and the brand
   * tint, because it is the only one that has to read as *whose* page this is.
   */
  badge: {
    root: "ring-background outline-primary/45 size-[60px] ring-[3px] outline-[1.5px]",
    fallback: "bg-secondary text-secondary-foreground text-xl font-[620]",
  },
} as const

export type PersonAvatarSize = keyof typeof discs

export function PersonAvatar({
  name,
  photoSrc,
  size,
  className,
}: {
  readonly name: string
  /** Absent whenever there is no photo to serve, which is the common case. */
  readonly photoSrc?: string
  readonly size: PersonAvatarSize
  /** Caller layout only — where the disc sits, never how it looks. */
  readonly className?: string
}) {
  const disc = discs[size]

  return (
    <Avatar className={cn(disc.root, className)}>
      <AvatarFallback className={disc.fallback}>{initials(name)}</AvatarFallback>
      {photoSrc === undefined ? null : (
        <img
          src={photoSrc}
          alt=""
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      )}
    </Avatar>
  )
}
