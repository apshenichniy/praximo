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
export function PersonAvatar({
  name,
  photoSrc,
  className,
  fallbackClassName,
}: {
  readonly name: string
  /** Absent whenever there is no photo to serve, which is the common case. */
  readonly photoSrc?: string
  /** Caller layout — the size this surface wants the disc at, and nothing else. */
  readonly className?: string
  readonly fallbackClassName?: string
}) {
  return (
    <Avatar className={className}>
      <AvatarFallback className={fallbackClassName}>{initials(name)}</AvatarFallback>
      {photoSrc === undefined ? null : (
        <img
          src={photoSrc}
          alt=""
          className={cn("absolute inset-0 size-full rounded-full object-cover")}
        />
      )}
    </Avatar>
  )
}
