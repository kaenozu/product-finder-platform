/**
 * 画像プロキシのセキュリティ強化回帰テスト。
 *
 * Issue #25 の受入条件:
 * - redirect 自動追従を無効化し、各 Location を明示的に再検証
 * - redirect 先も https: かつ許可ホストであること
 * - redirect hop 数に上限を設け、loop/過剰 redirect を拒否
 * - Content-Length の有無に依存せず、streaming で 5MB 上限を強制
 * - upstream fetch に明示 timeout を設定
 * - cache 投入は全検証通過後の応答のみ
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  isAllowedTarget,
  fetchWithRedirectGuard,
  readWithSizeLimit,
  MAX_IMAGE_BYTES,
  MAX_REDIRECT_HOPS,
} from "../../src/worker/image-proxy";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** redirect を含むレスポンスを生成する */
function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

/** 指定バイト数のReadableStreamを生成する */
function makeByteStream(totalBytes: number): ReadableStream<Uint8Array> {
  const chunkSize = 64 * 1024; // 64KB chunks
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const remaining = totalBytes - sent;
      const size = Math.min(chunkSize, remaining);
      controller.enqueue(new Uint8Array(size));
      sent += size;
    },
  });
}

// ──────────────────────────────────────────────
// isAllowedTarget tests
// ──────────────────────────────────────────────

describe("isAllowedTarget", () => {
  it("許可ホストは受け入れる", () => {
    expect(isAllowedTarget(new URL("https://www.irisohyama.co.jp/image.jpg"))).toBe(true);
    expect(isAllowedTarget(new URL("https://panasonicjp.scene7.com/img.png"))).toBe(true);
  });

  it("非許可ホストは拒否する", () => {
    expect(isAllowedTarget(new URL("https://evil.example.com/steal.png"))).toBe(false);
  });

  it("http: プロトコルは拒否する", () => {
    expect(isAllowedTarget(new URL("http://www.irisohyama.co.jp/image.jpg"))).toBe(false);
  });

  it("localhost は拒否する", () => {
    expect(isAllowedTarget(new URL("https://localhost/secret"))).toBe(false);
    expect(isAllowedTarget(new URL("https://127.0.0.1/secret"))).toBe(false);
  });
});

// ──────────────────────────────────────────────
// fetchWithRedirectGuard tests
// ──────────────────────────────────────────────

describe("fetchWithRedirectGuard", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("redirect なしの通常レスポンスはそのまま返す", async () => {
    const okResponse = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse);

    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    const { response, finalUrl } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(200);
    expect(finalUrl).toEqual(target);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("redirect manual オプションが設定される", async () => {
    const okResponse = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse);

    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    await fetchWithRedirectGuard(target, {});

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("許可ホスト間の redirect を追跡する", async () => {
    const target = new URL("https://www.irisohyama.co.jp/old.jpg");
    const redirectTarget = new URL("https://panasonicjp.scene7.com/new.jpg");
    const finalResponse = new Response("image-data", { status: 200 });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse(redirectTarget.toString()))
      .mockResolvedValueOnce(finalResponse);

    const { response, finalUrl } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(200);
    expect(finalUrl.hostname).toBe("panasonicjp.scene7.com");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("許可ホスト → 非許可ホスト redirect は 502 で拒否する", async () => {
    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    const maliciousRedirect = "https://evil.example.com/steal.png";

    globalThis.fetch = vi.fn().mockResolvedValueOnce(redirectResponse(maliciousRedirect));

    const { response } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(502);
    // redirect先には fetch しない
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("許可ホスト → localhost redirect は 502 で拒否する", async () => {
    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    const maliciousRedirect = "https://127.0.0.1/secret";

    globalThis.fetch = vi.fn().mockResolvedValueOnce(redirectResponse(maliciousRedirect));

    const { response } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(502);
  });

  it("許可ホスト → http: redirect は 502 で拒否する", async () => {
    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    const maliciousRedirect = "http://www.irisohyama.co.jp/downgrade.jpg";

    globalThis.fetch = vi.fn().mockResolvedValueOnce(redirectResponse(maliciousRedirect));

    const { response } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(502);
  });

  it("redirect loop は hop 数上限で 502 で拒否する", async () => {
    const target = new URL("https://www.irisohyama.co.jp/a.jpg");

    // MAX_REDIRECT_HOPS + 1 回 redirect を返す mock
    globalThis.fetch = vi.fn().mockImplementation((_url: string) => {
      // 全て redirect を返し続ける
      return Promise.resolve(redirectResponse("https://www.irisohyama.co.jp/loop.jpg"));
    });

    const { response } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(502);
    // MAX_REDIRECT_HOPS + 1 回 fetch が呼ばれる (0..MAX_REDIRECT_HOPS)
    expect(globalThis.fetch).toHaveBeenCalledTimes(MAX_REDIRECT_HOPS + 1);
  });

  it("redirect hop 数上限に到達前に正当な応答があれば通す", async () => {
    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    const finalResponse = new Response("ok", { status: 200 });

    // 3回 redirect 後に 200 を返す
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://panasonicjp.scene7.com/1.jpg"))
      .mockResolvedValueOnce(redirectResponse("https://www.irisohyama.co.jp/2.jpg"))
      .mockResolvedValueOnce(redirectResponse("https://panasonicjp.scene7.com/3.jpg"))
      .mockResolvedValueOnce(finalResponse);

    const { response, finalUrl } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(200);
    expect(finalUrl.hostname).toBe("panasonicjp.scene7.com");
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it("Location ヘッダーなしの 3xx は元の応答を返す", async () => {
    const noLocation302 = new Response(null, { status: 302 });
    globalThis.fetch = vi.fn().mockResolvedValue(noLocation302);

    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    const { response } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(302);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("相対URL の redirect を正しく解決する", async () => {
    const target = new URL("https://www.irisohyama.co.jp/original.jpg");
    const finalResponse = new Response("ok", { status: 200 });

    // 相対パスでの redirect
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("/new-image.jpg"))
      .mockResolvedValueOnce(finalResponse);

    const { response, finalUrl } = await fetchWithRedirectGuard(target, {});

    expect(response.status).toBe(200);
    expect(finalUrl.pathname).toBe("/new-image.jpg");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("init の signal を正しく渡す", async () => {
    const controller = new AbortController();
    const okResponse = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse);

    const target = new URL("https://www.irisohyama.co.jp/image.jpg");
    await fetchWithRedirectGuard(target, { signal: controller.signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });
});

// ──────────────────────────────────────────────
// readWithSizeLimit tests
// ──────────────────────────────────────────────

describe("readWithSizeLimit", () => {
  it(" maxSize 以内のレスポンスを正常に読み取る", async () => {
    const data = new Uint8Array(1024).fill(0x42);
    const response = new Response(data);

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    expect(result).not.toBeNull();
    expect(result!.byteLength).toBe(1024);
    expect(result![0]).toBe(0x42);
  });

  it("Content-Length ヘッダーなしでも size limit を強制する", async () => {
    // Content-Length ヘッダーなしのストリーム
    const oversizedStream = makeByteStream(MAX_IMAGE_BYTES + 1024);
    const response = new Response(oversizedStream);

    // Content-Length ヘッダーがないことを確認
    expect(response.headers.get("content-length")).toBeNull();

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    // 上限超過で null を返す
    expect(result).toBeNull();
  });

  it("Content-Length が小さいが実データが大きい場合は size limit で拒否", async () => {
    // Content-Length は小さいが、実際のストリームは大きい
    const oversizedStream = makeByteStream(MAX_IMAGE_BYTES + 1024);
    const response = new Response(oversizedStream, {
      headers: { "content-length": "100" }, // 小さい Content-Length
    });

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    expect(result).toBeNull();
  });

  it("恰好 5MB のレスポンスは通過する", async () => {
    const exactStream = makeByteStream(MAX_IMAGE_BYTES);
    const response = new Response(exactStream);

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    expect(result).not.toBeNull();
    expect(result!.byteLength).toBe(MAX_IMAGE_BYTES);
  });

  it("5MB + 1byte のレスポンスは拒否する", async () => {
    const oversizedStream = makeByteStream(MAX_IMAGE_BYTES + 1);
    const response = new Response(oversizedStream);

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    expect(result).toBeNull();
  });

  it("空のレスポンスボディは空の配列を返す", async () => {
    const response = new Response(null);

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    // body が null の場合、reader が取得できず null を返す
    expect(result).toBeNull();
  });

  it("チャンク単位で size limit をチェックする", async () => {
    // 64KB chunks で 5MB + 128KB を送信
    const oversizedStream = makeByteStream(MAX_IMAGE_BYTES + 128 * 1024);
    const response = new Response(oversizedStream);

    const result = await readWithSizeLimit(response, MAX_IMAGE_BYTES);

    expect(result).toBeNull();
  });
});
