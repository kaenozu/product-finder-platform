import { json } from "../src/worker/http";
import type { Env } from "../src/worker/env";
import { handleRequest } from "../src/worker/handler";
import { handleScheduled } from "../src/worker/scheduled";
import { withSecurityHeaders } from "../src/worker/security-headers";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await handleRequest(request, env);
    if (response) return withSecurityHeaders(response);
    const url = new URL(request.url);
    return withSecurityHeaders(json({ error: "not_found", path: url.pathname }, { status: 404 }));
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;
