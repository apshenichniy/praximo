import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * Tests live **beside the routes they cover**, and the generator has to be told
 * so.
 *
 * Without this it walks every file under `routes/` and warns, on each build and
 * each deploy, that `$clientId_.avatar.test.ts` exports no `Route`. The warning
 * is correct and the exclusion it describes is what we want — it is the *noise*
 * that is the problem, because a warning printed on every green build is one
 * nobody reads when it finally means something.
 *
 * A pattern rather than the `-` filename prefix the warning suggests: that
 * prefix would rename `$clientId_.avatar.test.ts` to `-$clientId_.avatar.test.ts`
 * and break the name-to-subject link colocation exists for. A rule also covers
 * the next such test, which a rename does not.
 *
 * The string is compiled with `new RegExp`, so the backslashes are the pattern's
 * rather than the literal's.
 */
const routerConfig = { routeFileIgnorePattern: "\\.test\\.tsx?$" } as const

const developmentOpenPath = (): string | false => {
  const botId = process.env.DEV_COACH_TELEGRAM_BOT_ID?.trim()
  if (!botId) return false
  if (!/^\d+$/.test(botId)) {
    throw new Error("DEV_COACH_TELEGRAM_BOT_ID must be a Telegram bot id")
  }
  return `/?b=${botId}`
}

// A plain TanStack Start config. It intentionally carries no Cloudflare plugin:
// this app is deployed by Alchemy's `Cloudflare.Website.Vite` (alchemy.run.ts),
// which injects its own Cloudflare Vite plugin and targets workerd for the
// deploy build. Adding one here would need a wrangler config the repo doesn't
// keep (Alchemy owns all infra) and would break `vite dev`. Local dev runs the
// standard TanStack Start node server; `alchemy dev` gives a workerd runtime.
export default defineConfig({
  server: {
    open: developmentOpenPath(),
  },
  build: {
    rolldownOptions: {
      external: ["cloudflare:workers"],
    },
  },
  optimizeDeps: {
    exclude: ["cloudflare:workers"],
  },
  resolve: { tsconfigPaths: true },
  ssr: {
    external: ["cloudflare:workers"],
  },
  plugins: [tailwindcss(), tanstackStart({ router: routerConfig }), viteReact()],
})
