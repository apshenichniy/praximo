import type { APIRoute } from "astro"

export const prerender = true

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ app: "www", status: "ok" }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  })
