import { handleRequest } from "../src/worker/handler";
import type { Env } from "../src/worker/env";

interface PagesEnv extends Env {
  ASSETS: Fetcher;
}

/**
 * Pages advanced mode のエントリポイント。
 * ビルド時に esbuild で dist/_worker.js へバンドルされ、
 * Pages が出力ディレクトリ直下の _worker.js を advanced mode として扱う。
 * API・リダイレクトを処理し、それ以外のリクエストは静的アセット（SPA）へフォールバックする。
 */
export default {
  async fetch(request: Request, env: PagesEnv): Promise<Response> {
    const response = await handleRequest(request, env);
    if (response) return response;

    // 静的アセットを試す。存在しないパス（例: /rice-cooker などのクライアント
    // ルーティングパス）は SPA フォールバックとして index.html を返す。
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }
    return assetResponse;
  },
} satisfies ExportedHandler<PagesEnv>;
