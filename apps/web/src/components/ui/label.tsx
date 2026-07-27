import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        // A label outranks the control it names (#201). At `font-medium` it carried
        // exactly the weight of the toggle chips under it, so «Coach’s language»
        // read as part of the row rather than as its heading. Weight is the lever
        // the type spec nominates: emphasis comes from weight, not from size or
        // opacity.
        "flex items-center gap-2 text-body leading-none font-semibold select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
