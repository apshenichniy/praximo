import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// A plain TanStack Start config. It intentionally carries no Cloudflare plugin:
// this app is deployed by Alchemy's `Cloudflare.Website.Vite` (alchemy.run.ts),
// which injects its own Cloudflare Vite plugin and targets workerd for the
// deploy build. Adding one here would need a wrangler config the repo doesn't
// keep (Alchemy owns all infra) and would break `vite dev`. Local dev runs the
// standard TanStack Start node server; `alchemy dev` gives a workerd runtime.
/** Tests beside the routes they cover, as `apps/coach/vite.config.ts` explains. */
const routerConfig = { routeFileIgnorePattern: "\\.test\\.tsx?$" } as const

export default defineConfig({
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
