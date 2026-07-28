import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// A test-only config, deliberately free of the TanStack Start / Cloudflare
// plugins: unit tests exercise route options and pure handlers in Node, not a
// workerd build. It only needs the `@/*` alias; Vitest's oxc transform handles
// the automatic JSX runtime the render test relies on.
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
