import { createFileRoute } from "@tanstack/react-router"

/**
 * The dev-stack health contract (#46), now for the fourth Worker (#191): a
 * server-only route proving the deployed Worker booted. The payload and handler
 * are factored out so the contract is unit-testable without spinning up the
 * server runtime.
 */
export const healthPayload = () => ({ app: "client", status: "ok" }) as const

export const healthGet = () => Response.json(healthPayload())

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: healthGet,
    },
  },
})
