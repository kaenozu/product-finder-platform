import { SECURITY_HEADERS } from "./security-headers";

/**
 * 公開読み取りAPI（config/categories/evaluate/products）が任意オリジンから呼ばれる前提のため
 * allow-origin: * を許容する。書き込み系エンドポイントは /go（リダイレクト）と
 * ループバック限定の dev-seed のみであり、CSRFの対象にならない。
 * 将来認証付き書き込みAPIを追加する場合はここを見直すこと。
 */
export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...SECURITY_HEADERS,
  };
}
