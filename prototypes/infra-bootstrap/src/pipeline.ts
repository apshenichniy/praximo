import { WorkflowEntrypoint } from "cloudflare:workers";
export class SessionPipeline extends WorkflowEntrypoint<unknown, unknown> {
  async run(): Promise<void> {}
}
export default {
  async fetch(_req: Request, _env: unknown): Promise<Response> {
    return new Response("pipeline ok");
  },
  async scheduled(_c: unknown, _env: unknown): Promise<void> {},
};
