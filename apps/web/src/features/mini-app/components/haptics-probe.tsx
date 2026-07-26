import { useState } from "react"

import { Button } from "@/components/ui/button.tsx"
import { hapticSupport, impactHaptic, notifyHaptic, selectionHaptic } from "../haptics.ts"

/**
 * **Temporary** (#186): why a phone is not buzzing.
 *
 * Haptics fail silently by design — a host without them is a no-op — which is
 * exactly wrong when the question is "does this host have them". Three
 * questions the device can answer and a laptop cannot: what the host calls
 * itself, whether it exposes `HapticFeedback` at all, and whether each of the
 * three kinds is felt when fired one at a time. The last one separates "our code
 * never runs" from "iOS is ignoring us" — Low Power Mode and the System Haptics
 * switch both silence the Taptic Engine without telling anybody.
 *
 * Delete once the answer is in. It lives on the Main Mini App screen because
 * that screen is already the service entrance.
 */
export function HapticsProbe() {
  const [fired, setFired] = useState<string>()
  const support = hapticSupport()

  const probe = (name: string, run: () => void) => () => {
    run()
    setFired(name)
  }

  return (
    <section className="border-border/60 mt-10 rounded-2xl border border-dashed p-4">
      <p className="text-muted-foreground text-caption font-semibold tracking-wide uppercase">
        Haptics probe (#186)
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-footnote">
        <dt className="text-muted-foreground">host</dt>
        <dd className="tabular-nums">{support.host}</dd>
        <dt className="text-muted-foreground">platform</dt>
        <dd className="tabular-nums">{support.platform}</dd>
        <dt className="text-muted-foreground">version</dt>
        <dd className="tabular-nums">{support.version}</dd>
        <dt className="text-muted-foreground">HapticFeedback</dt>
        <dd className={support.available ? "text-emerald-300" : "text-rose-300"}>
          {support.available ? "present" : "missing"}
        </dd>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={probe("selection", selectionHaptic)}>
          selection
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={probe("impact medium", () => impactHaptic("medium"))}
        >
          impact
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={probe("notification success", () => notifyHaptic("success"))}
        >
          notification
        </Button>
      </div>

      {fired === undefined ? null : (
        <p className="text-muted-foreground mt-3 text-footnote">fired: {fired}</p>
      )}
    </section>
  )
}
