export default {
  async fetch(_req: Request, _env: unknown): Promise<Response> {
    return new Response("web ok");
  },
};
