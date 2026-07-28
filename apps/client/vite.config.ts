import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The same plain TanStack Start config the product apps carry, and for the same
// reason: this app is deployed by Alchemy's `Cloudflare.Website.Vite`
// (alchemy.run.ts), which injects its own Cloudflare Vite plugin and targets
// workerd for the deploy build. Adding one here would need a wrangler config the
// repo doesn't keep (Alchemy owns all infra) and would break `vite dev`.
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
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
