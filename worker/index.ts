import { corsHeaders, json } from "../src/worker/http";
import type { Env } from "../src/worker/env";
import { handleConfig, handleEvaluate, handleProductDetail } from "../src/worker/api";
import { handleScheduled } from "../src/worker/scheduled";
import { handleRedirect } from "../src/worker/redirect";
import { handleDevSeed } from "../src/worker/dev-seed";

const MAX_JSON_BODY_BYTES = 32 * 1024;

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

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
        return json({ ok: true, service: "product-finder-platform", ts: new Date().toISOString() });
      }
      if (pathname === "/api/dev/seed" || pathname === "/api/dev/seed/") {
        // ローカル開発/e2e専用。設定ミスで公開環境にDEV_SEEDが入っても実行しない。
        const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (env.DEV_SEED !== "1" || !isLoopback) {
          return json({ error: "forbidden" }, { status: 403 });
        }
        if (request.method !== "POST") {
          return json({ error: "method_not_allowed" }, { status: 405 });
        }
        return handleDevSeed(env);
      }
      if (pathname === "/api/config" || pathname === "/api/config/") {
        return handleConfig(request);
      }
      if (pathname === "/api/diagnosis/evaluate" || pathname === "/api/diagnosis/evaluate/") {
        if (request.method !== "POST") {
          return json({ error: "method_not_allowed" }, { status: 405 });
        }
        const declaredLength = Number(request.headers.get("content-length") ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
          return json({ error: "payload_too_large" }, { status: 413 });
        }
        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > MAX_JSON_BODY_BYTES) {
          return json({ error: "payload_too_large" }, { status: 413 });
        }
        let body: unknown = null;
        try {
          body = JSON.parse(rawBody) as unknown;
        } catch {
          // handleEvaluateの共通invalid_request応答へ渡す
        }
        return handleEvaluate(env, body);
      }
      const productMatch = pathname.match(/^\/api\/products\/([^/]+)\/?$/);
      if (productMatch && productMatch[1]) {
        const productId = decodePathSegment(productMatch[1]);
        if (productId === null) return json({ error: "invalid_path_encoding" }, { status: 400 });
        return handleProductDetail(env, productId);
      }
      return json({ error: "not_found", path: pathname }, { status: 404 });
    }

    const redirectMatch = pathname.match(/^\/go\/([^/]+)\/([^/]+)\/?$/);
    if (redirectMatch && redirectMatch[1] && redirectMatch[2]) {
      const providerKey = decodePathSegment(redirectMatch[1]);
      const token = decodePathSegment(redirectMatch[2]);
      if (providerKey === null || token === null) {
        return json({ error: "invalid_path_encoding" }, { status: 400 });
      }
      return handleRedirect(env, request, providerKey, token);
    }

    return json({ error: "not_found", path: pathname }, { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;
