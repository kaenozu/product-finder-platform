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
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<PagesEnv>;
