import { corsHeaders, json } from "../src/worker/http";
import type { Env } from "../src/worker/env";
import { handleConfig, handleEvaluate, handleProductDetail } from "../src/worker/api";
import { handleScheduled } from "../src/worker/scheduled";
import { handleRedirect } from "../src/worker/redirect";
import { handleDevSeed } from "../src/worker/dev-seed";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const isApi = pathname.startsWith("/api/");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (isApi) {
      if (pathname === "/api/health" || pathname === "/api/health/") {
        return json({ ok: true, service: "kuraberu-diagnosis", ts: new Date().toISOString() });
      }
      if (pathname === "/api/dev/seed" || pathname === "/api/dev/seed/") {
        // ローカル開発/e2e専用（本番ではDEV_SEED未設定のため403）
        if (env.DEV_SEED !== "1") {
          return json({ error: "forbidden" }, { status: 403 });
        }
        if (request.method !== "POST") {
          return json({ error: "method_not_allowed" }, { status: 405 });
        }
        return handleDevSeed(env);
      }
      if (pathname === "/api/config" || pathname === "/api/config/") {
        return handleConfig();
      }
      if (pathname === "/api/diagnosis/evaluate" || pathname === "/api/diagnosis/evaluate/") {
        if (request.method !== "POST") {
          return json({ error: "method_not_allowed" }, { status: 405 });
        }
        const body = await request.json().catch(() => null);
        return handleEvaluate(env, body);
      }
      const productMatch = pathname.match(/^\/api\/products\/([^/]+)\/?$/);
      if (productMatch && productMatch[1]) {
        return handleProductDetail(env, decodeURIComponent(productMatch[1]));
      }
      return json({ error: "not_found", path: pathname }, { status: 404 });
    }

    const redirectMatch = pathname.match(/^\/go\/([^/]+)\/([^/]+)\/?$/);
    if (redirectMatch && redirectMatch[1] && redirectMatch[2]) {
      return handleRedirect(env, request, redirectMatch[1], redirectMatch[2]);
    }

    return json({ error: "not_found", path: pathname }, { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;
